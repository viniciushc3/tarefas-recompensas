/**
 * Tarefas e Recompensas — API da planilha.
 *
 * Cole este arquivo no editor de script da planilha (Extensões > Apps Script),
 * rode instalar() uma vez, e publique como app da web
 * ("Executar como: eu", "Quem pode acessar: qualquer pessoa").
 *
 * A URL publicada fica dentro do HTML, que é público. A proteção é o CÓDIGO DE
 * ACESSO de cada pessoa: sem ele a URL não faz nada. E o código define o papel,
 * conferido aqui no servidor — é isso que impede ela de aprovar a própria
 * tarefa, por mais que mexa no app.
 */

// ------------------------------------------------------------------ colunas
var ABAS = {
  Config:      ['chave', 'valor'],
  Tarefas:     ['id', 'titulo', 'icone', 'tipo', 'pontos', 'periodo', 'recorrencia',
                'dias', 'precisa_aprovacao', 'conta_mesada', 'ativa', 'criada_em'],
  Ocorrencias: ['id', 'data', 'tarefa_id', 'titulo', 'icone', 'pontos', 'tipo', 'periodo',
                'conta_mesada', 'precisa_aprovacao', 'status', 'marcada_em', 'decidida_em'],
  Extrato:     ['id', 'quando', 'tipo', 'gastavel', 'cofrinho', 'motivo', 'ref'],
  Recompensas: ['id', 'titulo', 'icone', 'tipo', 'bolso', 'custo', 'minutos', 'ativa'],
  Resgates:    ['id', 'quando', 'recompensa_id', 'titulo', 'custo', 'bolso', 'minutos',
                'status', 'decidido_em'],
  Faixas:      ['min_pct', 'valor', 'rotulo'],
  Semanas:     ['semana', 'elegiveis', 'aprovadas', 'pct', 'valor', 'status']
};

// =====================================================================
// REGRAS PURAS
// Sem SpreadsheetApp aqui: é o que os testes em testes/regras.test.js
// conseguem exercitar fora do Apps Script.
// =====================================================================

/** Divide um ganho entre saldo gastável e cofrinho. O resto vai para o gastável. */
function dividir(pontos, taxaCofrinho) {
  var cofrinho = Math.floor(pontos * taxaCofrinho);
  return { gastavel: pontos - cofrinho, cofrinho: cofrinho };
}

function somarDias(iso, dias) {
  var p = iso.split('-');
  var t = Date.UTC(+p[0], +p[1] - 1, +p[2]) + dias * 86400000;
  var d = new Date(t);
  return d.toISOString().slice(0, 10);
}

function diferencaEmDias(de, para) {
  var a = de.split('-'), b = para.split('-');
  return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
}

/** Dia da semana: 0=domingo .. 6=sábado. */
function diaDaSemana(iso) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}

/** Segunda-feira da semana de uma data. */
function inicioDaSemana(iso) {
  var dow = diaDaSemana(iso);
  return somarDias(iso, dow === 0 ? -6 : 1 - dow);
}

/** A tarefa acontece neste dia? */
function tarefaCaiNoDia(tarefa, iso) {
  var dow = diaDaSemana(iso);
  switch (tarefa.recorrencia) {
    case 'diaria':   return true;
    case 'semana':   return dow >= 1 && dow <= 5;
    case 'fimdesemana': return dow === 0 || dow === 6;
    case 'dias':     return String(tarefa.dias || '').split(',').indexOf(String(dow)) >= 0;
    case 'avulsa':   return String(tarefa.dias || '') === iso;
    default:         return false;
  }
}

/** Um dia está completo quando tem tarefa que conta e todas foram aprovadas. */
function diaCompleto(ocorrenciasDoDia) {
  var elegiveis = ocorrenciasDoDia.filter(function (o) { return o.conta_mesada; });
  if (!elegiveis.length) return false;
  return elegiveis.every(function (o) { return o.status === 'aprovada'; });
}

/**
 * Dias completos consecutivos. Começa de ontem quando hoje ainda não fechou:
 * às 9h da manhã o dia naturalmente não está completo, e zerar o streak nessa
 * hora puniria ela por acordar.
 */
function calcularStreak(ocorrencias, hoje) {
  var porDia = {};
  ocorrencias.forEach(function (o) {
    (porDia[o.data] = porDia[o.data] || []).push(o);
  });

  var dia = diaCompleto(porDia[hoje] || []) ? hoje : somarDias(hoje, -1);
  var total = 0;
  while (porDia[dia]) {
    if (!diaCompleto(porDia[dia])) break;
    total++;
    dia = somarDias(dia, -1);
  }
  return total;
}

/** Mesmo cálculo do fechamento, para a tela mostrar antes de fechar. */
function resumoDaSemana(ocorrencias, semana) {
  var naSemana = ocorrencias.filter(function (o) {
    var d = diferencaEmDias(semana, o.data);
    return d >= 0 && d < 7 && o.conta_mesada;
  });
  var aprovadas = naSemana.filter(function (o) { return o.status === 'aprovada'; }).length;
  var emAberto = naSemana.filter(function (o) {
    return o.status === 'pendente' || o.status === 'marcada';
  }).length;
  return {
    elegiveis: naSemana.length,
    aprovadas: aprovadas,
    emAberto: emAberto,
    pct: naSemana.length ? Math.round((100 * aprovadas) / naSemana.length) : 0
  };
}

/** Maior faixa de mesada atingida por um percentual. */
function faixaAlcancada(faixas, pct) {
  var ordenadas = faixas.slice().sort(function (a, b) { return b.min_pct - a.min_pct; });
  for (var i = 0; i < ordenadas.length; i++) {
    if (ordenadas[i].min_pct <= pct) return ordenadas[i];
  }
  return null;
}

function proximaFaixa(faixas, pct) {
  var ordenadas = faixas.slice().sort(function (a, b) { return a.min_pct - b.min_pct; });
  for (var i = 0; i < ordenadas.length; i++) {
    if (ordenadas[i].min_pct > pct) return ordenadas[i];
  }
  return null;
}

/**
 * Quantas tarefas faltam para alcançar um percentual, contando o que ainda
 * está em aberto. null = já não dá nesta semana.
 */
function tarefasParaAlcancar(resumo, metaPct) {
  if (!resumo.elegiveis) return null;
  var precisa = Math.ceil((metaPct * resumo.elegiveis) / 100) - resumo.aprovadas;
  if (precisa <= 0) return 0;
  return precisa <= resumo.emAberto ? precisa : null;
}

/** Tarifa mais barata de tela no catálogo, para traduzir pontos em minutos. */
function pontosPorMinuto(recompensas) {
  var taxas = recompensas
    .filter(function (r) { return r.tipo === 'tela' && Number(r.minutos) > 0; })
    .map(function (r) { return Number(r.custo) / Number(r.minutos); });
  return taxas.length ? Math.min.apply(null, taxas) : 0;
}

function saldoDe(extrato) {
  var g = 0, c = 0;
  extrato.forEach(function (e) { g += Number(e.gastavel) || 0; c += Number(e.cofrinho) || 0; });
  return { gastavel: g, cofrinho: c };
}

// =====================================================================
// PLANILHA
// =====================================================================

function ss() { return SpreadsheetApp.getActive(); }

/**
 * Procura a aba percorrendo getSheets() em vez de usar getSheetByName().
 * São 8 abas, o custo é irrelevante, e getSheetByName() se mostrou capaz de
 * falhar em planilha recém-criada ("Planilha 0 não encontrada").
 */
function procurarAba(planilha, nome) {
  var todas = planilha.getSheets();
  for (var i = 0; i < todas.length; i++) {
    if (todas[i].getName() === nome) return todas[i];
  }
  return null;
}

function aba(nome) {
  var s = procurarAba(ss(), nome);
  if (!s) throw new Error('a aba ' + nome + ' não existe — rode instalar()');
  return s;
}

/** Lê uma aba como lista de objetos, usando a primeira linha como cabeçalho. */
function ler(nome) {
  var s = aba(nome);
  var v = s.getDataRange().getValues();
  if (v.length < 2) return [];
  var cab = v[0];
  var saida = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = {};
    for (var j = 0; j < cab.length; j++) o[cab[j]] = v[i][j];
    o._linha = i + 1;
    saida.push(o);
  }
  return saida;
}

function anexar(nome, objeto) {
  var cols = ABAS[nome];
  aba(nome).appendRow(cols.map(function (c) {
    return objeto[c] === undefined || objeto[c] === null ? '' : objeto[c];
  }));
}

function escrever(nome, linha, campo, valor) {
  var col = ABAS[nome].indexOf(campo) + 1;
  aba(nome).getRange(linha, col).setValue(valor);
}

function booleano(v) {
  return v === true || v === 'sim' || v === 'TRUE' || v === 1 || v === '1';
}

function config() {
  var c = {};
  ler('Config').forEach(function (l) { c[l.chave] = l.valor; });
  return {
    fuso: c.fuso || 'America/Sao_Paulo',
    taxaCofrinho: Number(c.taxa_cofrinho || 0.3),
    janelaAtraso: Number(c.janela_atraso || 2),
    tetoTela: Number(c.teto_tela_min || 40),
    codigoPai: String(c.codigo_pai || ''),
    codigoFilha: String(c.codigo_filha || ''),
    nomePai: c.nome_pai || 'Pai',
    nomeFilha: c.nome_filha || 'Filha',
    emojiFilha: c.emoji_filha || '🦄'
  };
}

function hojeLocal(cfg) {
  return Utilities.formatDate(new Date(), cfg.fuso, 'yyyy-MM-dd');
}

function agora(cfg) {
  return Utilities.formatDate(new Date(), cfg.fuso, 'yyyy-MM-dd HH:mm');
}

function novoId(prefixo) {
  return prefixo + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

/** O código de acesso define quem está falando. Sem código, nada acontece. */
function quem(codigo, cfg) {
  codigo = String(codigo || '').trim();
  if (!codigo) throw new Error('codigo');
  if (cfg.codigoPai && codigo === cfg.codigoPai) return { papel: 'pai', nome: cfg.nomePai };
  if (cfg.codigoFilha && codigo === cfg.codigoFilha) return { papel: 'filha', nome: cfg.nomeFilha };
  throw new Error('codigo');
}

function exigirPai(pessoa) {
  if (pessoa.papel !== 'pai') throw new Error('só o responsável pode fazer isso');
}

// ------------------------------------------------------- linhas novas
/**
 * Completa o que falta nas linhas digitadas à mão.
 *
 * A planilha é o painel de administração, então você vai criar tarefas
 * escrevendo uma linha nova. Exigir que você invente um id único e preencha
 * todas as colunas seria péssimo: aqui basta o título. O resto o script
 * preenche na primeira vez que o app abrir.
 */
function normalizar(cfg) {
  var hoje = hojeLocal(cfg);

  ler('Tarefas').forEach(function (t) {
    if (!String(t.titulo || '').trim()) return;   // linha em branco: ignora
    var falta = function (campo) { return String(t[campo] === 0 ? '0' : (t[campo] || '')).trim() === ''; };

    if (falta('id'))                escrever('Tarefas', t._linha, 'id', novoId('tf'));
    // Sem isto, a tarefa nova nasceria com ocorrências nos 14 dias anteriores,
    // todas expiradas, e derrubaria o percentual da semana dela.
    if (falta('criada_em'))         escrever('Tarefas', t._linha, 'criada_em', hoje);
    if (falta('tipo'))              escrever('Tarefas', t._linha, 'tipo', 'extra');
    if (falta('pontos'))            escrever('Tarefas', t._linha, 'pontos', 0);
    if (falta('periodo'))           escrever('Tarefas', t._linha, 'periodo', 'qualquer');
    if (falta('recorrencia'))       escrever('Tarefas', t._linha, 'recorrencia', 'diaria');
    if (falta('precisa_aprovacao')) escrever('Tarefas', t._linha, 'precisa_aprovacao', 'nao');
    // Em branco significaria "não conta para a mesada", que não é o que
    // alguém quer dizer ao deixar a célula vazia.
    if (falta('conta_mesada'))      escrever('Tarefas', t._linha, 'conta_mesada', 'sim');
    if (falta('ativa'))             escrever('Tarefas', t._linha, 'ativa', 'sim');
  });

  ler('Recompensas').forEach(function (r) {
    if (!String(r.titulo || '').trim()) return;
    var falta = function (campo) { return String(r[campo] === 0 ? '0' : (r[campo] || '')).trim() === ''; };

    if (falta('id'))      escrever('Recompensas', r._linha, 'id', novoId('rc'));
    if (falta('tipo'))    escrever('Recompensas', r._linha, 'tipo', 'privilegio');
    // Meta grande sai só do cofrinho: é isso que impede gastar a poupança em tela.
    if (falta('bolso'))   escrever('Recompensas', r._linha, 'bolso',
                                   r.tipo === 'meta' ? 'cofrinho' : 'gastavel');
    if (falta('minutos')) escrever('Recompensas', r._linha, 'minutos', 0);
    if (falta('ativa'))   escrever('Recompensas', r._linha, 'ativa', 'sim');
  });
}

// --------------------------------------------------- geração e expiração
/**
 * Gera as ocorrências de um intervalo de dias, não só de hoje.
 *
 * Isso importa: se ela não abrir o app por cinco dias, aqueles dias nunca
 * teriam ocorrência, o denominador da mesada ficaria menor e o percentual
 * sairia INFLADO — ela receberia mesada cheia por uma semana que não cumpriu.
 * Gerando para trás, o dia que ela não abriu nasce pendente e expira como
 * não feito.
 */
function garantirDias(cfg, diasParaTras) {
  var hoje = hojeLocal(cfg);
  normalizar(cfg);
  var tarefas = ler('Tarefas').filter(function (t) {
    return booleano(t.ativa) && String(t.id || '').trim() !== '';
  });
  var existentes = {};
  ler('Ocorrencias').forEach(function (o) { existentes[o.tarefa_id + '|' + o.data] = true; });

  var novas = [];
  for (var i = diasParaTras; i >= 0; i--) {
    var dia = somarDias(hoje, -i);
    tarefas.forEach(function (t) {
      if (!tarefaCaiNoDia(t, dia)) return;
      // Nunca gerar para antes de a tarefa existir. Sem isto, no dia em que
      // você instala, os 14 dias anteriores nascem e expiram como não feitos,
      // e a primeira semana dela apareceria como 11% cumprida — parecendo
      // fracasso antes de ela ter tido chance de fazer qualquer coisa.
      if (t.criada_em && dia < String(t.criada_em)) return;
      if (existentes[t.id + '|' + dia]) return;
      novas.push([
        novoId('oc'), dia, t.id, t.titulo, t.icone, Number(t.pontos) || 0, t.tipo,
        t.periodo || 'qualquer',
        booleano(t.conta_mesada) ? 'sim' : 'nao',
        booleano(t.precisa_aprovacao) ? 'sim' : 'nao',
        'pendente', '', ''
      ]);
      existentes[t.id + '|' + dia] = true;
    });
  }
  if (novas.length) {
    var s = aba('Ocorrencias');
    s.getRange(s.getLastRow() + 1, 1, novas.length, ABAS.Ocorrencias.length).setValues(novas);
  }

  // Expira o que passou da janela. Expirada conta como NÃO feita na mesada,
  // que é o comportamento correto.
  var limite = somarDias(hoje, -cfg.janelaAtraso);
  ler('Ocorrencias').forEach(function (o) {
    if (o.status === 'pendente' && String(o.data) < limite) {
      escrever('Ocorrencias', o._linha, 'status', 'expirada');
    }
  });
  return novas.length;
}

// --------------------------------------------------------------- estado
function montarEstado(pessoa, cfg) {
  var hoje = hojeLocal(cfg);
  var ocorrencias = ler('Ocorrencias').map(function (o) {
    return {
      id: o.id, data: String(o.data), titulo: o.titulo, icone: o.icone,
      pontos: Number(o.pontos) || 0, tipo: o.tipo,
      periodo: o.periodo || 'qualquer',
      conta_mesada: booleano(o.conta_mesada),
      precisa_aprovacao: booleano(o.precisa_aprovacao),
      status: o.status,
      // a tela da fila usa isto para mostrar o que ela fez por trás de um resgate
      decidida_em: String(o.decidida_em || '')
    };
  });
  var extrato = ler('Extrato').map(function (e) {
    return {
      id: e.id, quando: String(e.quando), tipo: e.tipo,
      gastavel: Number(e.gastavel) || 0, cofrinho: Number(e.cofrinho) || 0,
      motivo: e.motivo
    };
  });
  var recompensas = ler('Recompensas').filter(function (r) { return booleano(r.ativa); })
    .map(function (r) {
      return {
        id: r.id, titulo: r.titulo, icone: r.icone, tipo: r.tipo, bolso: r.bolso,
        custo: Number(r.custo) || 0, minutos: Number(r.minutos) || 0
      };
    });
  var resgates = ler('Resgates').map(function (r) {
    return {
      id: r.id, quando: String(r.quando), titulo: r.titulo, custo: Number(r.custo) || 0,
      bolso: r.bolso, minutos: Number(r.minutos) || 0, status: r.status
    };
  });
  var faixas = ler('Faixas').map(function (f) {
    return { min_pct: Number(f.min_pct) || 0, valor: Number(f.valor) || 0, rotulo: f.rotulo };
  });

  var semana = inicioDaSemana(hoje);
  var resumo = resumoDaSemana(ocorrencias, semana);

  return {
    papel: pessoa.papel,
    nome: pessoa.nome,
    // O painel de administração é a própria planilha: tarefas, preços e faixas
    // se editam lá, não numa tela que eu teria de construir e você manter.
    planilha: pessoa.papel === 'pai' ? ss().getUrl() : '',
    hoje: hoje,
    semana: semana,
    cfg: {
      janelaAtraso: cfg.janelaAtraso, tetoTela: cfg.tetoTela,
      taxaCofrinho: cfg.taxaCofrinho, nomeFilha: cfg.nomeFilha, emojiFilha: cfg.emojiFilha
    },
    saldo: saldoDe(extrato),
    streak: calcularStreak(ocorrencias, hoje),
    porMinuto: pontosPorMinuto(recompensas),
    resumoSemana: resumo,
    faixa: faixaAlcancada(faixas, resumo.pct),
    proxima: proximaFaixa(faixas, resumo.pct),
    faltamParaProxima: (function () {
      var p = proximaFaixa(faixas, resumo.pct);
      return p ? tarefasParaAlcancar(resumo, p.min_pct) : null;
    })(),
    faixas: faixas,
    // Só o que a tela usa: a janela de atraso para ela, tudo recente para você.
    ocorrencias: ocorrencias.filter(function (o) {
      return diferencaEmDias(o.data, hoje) <= 40;
    }),
    recompensas: recompensas,
    // Para a tela de edição: tudo, inclusive desativado. Só para o pai — a
    // filha não precisa ver o que está fora da loja.
    tarefas: pessoa.papel === 'pai' ? ler('Tarefas').map(function (t) {
      return {
        id: t.id, titulo: t.titulo, icone: t.icone, tipo: t.tipo,
        pontos: Number(t.pontos) || 0, periodo: t.periodo || 'qualquer',
        recorrencia: t.recorrencia || 'diaria', dias: String(t.dias || ''),
        precisa_aprovacao: booleano(t.precisa_aprovacao),
        conta_mesada: booleano(t.conta_mesada),
        ativa: booleano(t.ativa)
      };
    }) : [],
    catalogo: pessoa.papel === 'pai' ? ler('Recompensas').map(function (r) {
      return {
        id: r.id, titulo: r.titulo, icone: r.icone, tipo: r.tipo,
        bolso: r.bolso, custo: Number(r.custo) || 0,
        minutos: Number(r.minutos) || 0, ativa: booleano(r.ativa)
      };
    }) : [],
    resgates: resgates.slice(-40),
    extrato: extrato.slice(-80).reverse(),
    semanas: ler('Semanas').map(function (s) {
      return {
        semana: String(s.semana), elegiveis: Number(s.elegiveis) || 0,
        aprovadas: Number(s.aprovadas) || 0, pct: Number(s.pct) || 0,
        valor: Number(s.valor) || 0, status: s.status
      };
    }).slice(-12).reverse()
  };
}

// =====================================================================
// AÇÕES
// =====================================================================

function lancar(cfg, tipo, gastavel, cofrinho, motivo, ref) {
  anexar('Extrato', {
    id: novoId('ex'), quando: agora(cfg), tipo: tipo,
    gastavel: gastavel, cofrinho: cofrinho, motivo: motivo, ref: ref || ''
  });
}

/** Credita uma ocorrência aprovada, aplicando a divisão do cofrinho. */
function creditar(cfg, oc) {
  var pontos = Number(oc.pontos) || 0;
  if (pontos <= 0) return;  // tarefa básica: conta para a mesada, não paga
  // Trava de crédito duplo: uma ocorrência paga no máximo uma vez.
  var jaPago = ler('Extrato').some(function (e) {
    return e.tipo === 'ganho' && String(e.ref) === String(oc.id);
  });
  if (jaPago) return;
  var d = dividir(pontos, cfg.taxaCofrinho);
  lancar(cfg, 'ganho', d.gastavel, d.cofrinho, oc.titulo, oc.id);
}

function acaoMarcar(pessoa, cfg, dados) {
  var hoje = hojeLocal(cfg);
  var oc = ler('Ocorrencias').filter(function (o) { return o.id === dados.id; })[0];
  if (!oc) throw new Error('tarefa não encontrada');
  if (oc.status !== 'pendente' && oc.status !== 'recusada') {
    throw new Error('essa tarefa já está ' + oc.status);
  }
  var data = String(oc.data);
  if (data > hoje) throw new Error('ainda não é o dia dessa tarefa');
  if (data < somarDias(hoje, -cfg.janelaAtraso)) throw new Error('passou do prazo para marcar');

  var novo = booleano(oc.precisa_aprovacao) ? 'marcada' : 'aprovada';
  escrever('Ocorrencias', oc._linha, 'status', novo);
  escrever('Ocorrencias', oc._linha, 'marcada_em', agora(cfg));
  if (novo === 'aprovada') {
    escrever('Ocorrencias', oc._linha, 'decidida_em', agora(cfg));
    creditar(cfg, oc);
  }
  return { status: novo };
}

function acaoDecidir(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var oc = ler('Ocorrencias').filter(function (o) { return o.id === dados.id; })[0];
  if (!oc) throw new Error('tarefa não encontrada');
  if (oc.status !== 'marcada') throw new Error('nada a decidir: está ' + oc.status);

  escrever('Ocorrencias', oc._linha, 'status', dados.aprovar ? 'aprovada' : 'recusada');
  escrever('Ocorrencias', oc._linha, 'decidida_em', agora(cfg));
  if (dados.aprovar) creditar(cfg, oc);
  return { status: dados.aprovar ? 'aprovada' : 'recusada' };
}

/**
 * Resgate com reserva: debita no pedido e devolve na recusa.
 * Evita o caso chato de "aprovado mas sem saldo" quando ela pede duas coisas
 * ao mesmo tempo.
 */
function acaoPedir(pessoa, cfg, dados) {
  var r = ler('Recompensas').filter(function (x) { return x.id === dados.id; })[0];
  if (!r || !booleano(r.ativa)) throw new Error('recompensa indisponível');

  var custo = Number(r.custo) || 0;
  var saldo = saldoDe(ler('Extrato'));
  var bolso = r.bolso === 'cofrinho' ? 'cofrinho' : 'gastavel';
  var disponivel = bolso === 'cofrinho' ? saldo.cofrinho : saldo.gastavel;
  if (disponivel < custo) {
    throw new Error('faltam ' + (custo - disponivel) + ' pontos' +
      (bolso === 'cofrinho' ? ' no cofrinho' : ''));
  }

  var id = novoId('rg');
  anexar('Resgates', {
    id: id, quando: agora(cfg), recompensa_id: r.id, titulo: r.titulo,
    custo: custo, bolso: bolso, minutos: Number(r.minutos) || 0,
    status: 'pedido', decidido_em: ''
  });
  lancar(cfg, 'gasto',
    bolso === 'gastavel' ? -custo : 0,
    bolso === 'cofrinho' ? -custo : 0,
    r.titulo, id);
  return { id: id };
}

function devolver(cfg, rg, motivo) {
  var custo = Number(rg.custo) || 0;
  lancar(cfg, 'devolucao',
    rg.bolso === 'gastavel' ? custo : 0,
    rg.bolso === 'cofrinho' ? custo : 0,
    motivo + ': ' + rg.titulo, rg.id);
}

function acaoDecidirResgate(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var rg = ler('Resgates').filter(function (x) { return x.id === dados.id; })[0];
  if (!rg) throw new Error('resgate não encontrado');
  if (rg.status !== 'pedido') throw new Error('esse resgate já está ' + rg.status);

  escrever('Resgates', rg._linha, 'status', dados.aprovar ? 'aprovado' : 'recusado');
  escrever('Resgates', rg._linha, 'decidido_em', agora(cfg));
  if (!dados.aprovar) devolver(cfg, rg, 'Recusado');
  return { status: dados.aprovar ? 'aprovado' : 'recusado' };
}

/** Ela desiste enquanto você não decidiu; os pontos voltam. */
function acaoCancelar(pessoa, cfg, dados) {
  var rg = ler('Resgates').filter(function (x) { return x.id === dados.id; })[0];
  if (!rg) throw new Error('resgate não encontrado');
  if (rg.status !== 'pedido') throw new Error('esse resgate já está ' + rg.status);

  escrever('Resgates', rg._linha, 'status', 'cancelado');
  escrever('Resgates', rg._linha, 'decidido_em', agora(cfg));
  devolver(cfg, rg, 'Cancelado');
  return { status: 'cancelado' };
}

/** Você liberou a tela de fato. */
function acaoEntregue(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var rg = ler('Resgates').filter(function (x) { return x.id === dados.id; })[0];
  if (!rg) throw new Error('resgate não encontrado');
  if (rg.status !== 'aprovado') throw new Error('esse resgate não está aprovado');
  escrever('Resgates', rg._linha, 'status', 'entregue');
  return { status: 'entregue' };
}

/** Correção manual: lançamento novo, nunca edição do histórico. */
function acaoAjustar(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var g = Number(dados.gastavel) || 0;
  var c = Number(dados.cofrinho) || 0;
  if (!g && !c) throw new Error('ajuste vazio');
  if (!String(dados.motivo || '').trim()) throw new Error('ajuste precisa de motivo');
  lancar(cfg, 'ajuste', g, c, String(dados.motivo).trim(), '');
  return { ok: true };
}

function acaoFecharSemana(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var semana = dados.semana || inicioDaSemana(hojeLocal(cfg));
  var ocorrencias = ler('Ocorrencias').map(function (o) {
    return { data: String(o.data), status: o.status, conta_mesada: booleano(o.conta_mesada) };
  });
  var resumo = resumoDaSemana(ocorrencias, semana);
  var faixas = ler('Faixas').map(function (f) {
    return { min_pct: Number(f.min_pct) || 0, valor: Number(f.valor) || 0, rotulo: f.rotulo };
  });
  var faixa = faixaAlcancada(faixas, resumo.pct);
  var valor = faixa ? faixa.valor : 0;

  var existente = ler('Semanas').filter(function (s) { return String(s.semana) === semana; })[0];
  if (existente) {
    if (existente.status === 'paga') throw new Error('essa semana já foi paga');
    escrever('Semanas', existente._linha, 'elegiveis', resumo.elegiveis);
    escrever('Semanas', existente._linha, 'aprovadas', resumo.aprovadas);
    escrever('Semanas', existente._linha, 'pct', resumo.pct);
    escrever('Semanas', existente._linha, 'valor', valor);
    escrever('Semanas', existente._linha, 'status', 'fechada');
  } else {
    anexar('Semanas', {
      semana: semana, elegiveis: resumo.elegiveis, aprovadas: resumo.aprovadas,
      pct: resumo.pct, valor: valor, status: 'fechada'
    });
  }
  return { pct: resumo.pct, valor: valor };
}

function acaoPagarSemana(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var s = ler('Semanas').filter(function (x) { return String(x.semana) === dados.semana; })[0];
  if (!s) throw new Error('semana não fechada');
  escrever('Semanas', s._linha, 'status', 'paga');
  return { ok: true };
}

// ------------------------------------------------- editar pelo app
var PERIODOS_VALIDOS = ['manha', 'tarde', 'noite', 'qualquer'];
var RECORRENCIAS_VALIDAS = ['diaria', 'semana', 'fimdesemana', 'dias', 'avulsa'];

function simNao(v) { return v ? 'sim' : 'nao'; }

function acaoSalvarTarefa(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var t = dados.tarefa || {};

  var titulo = String(t.titulo || '').trim();
  if (!titulo) throw new Error('a tarefa precisa de um nome');

  var tipo = t.tipo === 'basica' ? 'basica' : 'extra';
  var pontos = Math.max(0, Math.round(Number(t.pontos) || 0));
  var periodo = PERIODOS_VALIDOS.indexOf(t.periodo) >= 0 ? t.periodo : 'qualquer';
  var recorrencia = RECORRENCIAS_VALIDAS.indexOf(t.recorrencia) >= 0 ? t.recorrencia : 'diaria';
  var dias = String(t.dias || '').trim();

  if (recorrencia === 'dias' && !dias) throw new Error('escolha pelo menos um dia da semana');
  if (recorrencia === 'avulsa' && !/^\d{4}-\d{2}-\d{2}$/.test(dias)) {
    throw new Error('tarefa avulsa precisa de uma data (AAAA-MM-DD)');
  }

  // Foto implicaria aprovação; aqui o equivalente é: o que precisa de conferência
  // vai para a fila. Mantemos a escolha livre.
  var campos = {
    titulo: titulo,
    icone: String(t.icone || '').trim(),
    tipo: tipo,
    pontos: pontos,
    periodo: periodo,
    recorrencia: recorrencia,
    dias: dias,
    precisa_aprovacao: simNao(t.precisa_aprovacao),
    conta_mesada: simNao(t.conta_mesada !== false),
    ativa: simNao(t.ativa !== false)
  };

  var existente = String(t.id || '').trim()
    ? ler('Tarefas').filter(function (x) { return String(x.id) === String(t.id); })[0]
    : null;

  if (existente) {
    Object.keys(campos).forEach(function (c) {
      escrever('Tarefas', existente._linha, c, campos[c]);
    });
    return { id: existente.id, novo: false };
  }

  campos.id = novoId('tf');
  // Nasce hoje: sem isto, a tarefa nova geraria ocorrências atrasadas nos dias
  // anteriores, todas expiradas, derrubando a semana dela.
  campos.criada_em = hojeLocal(cfg);
  anexar('Tarefas', campos);
  return { id: campos.id, novo: true };
}

function acaoSalvarRecompensa(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var r = dados.recompensa || {};

  var titulo = String(r.titulo || '').trim();
  if (!titulo) throw new Error('a recompensa precisa de um nome');

  var custo = Math.round(Number(r.custo) || 0);
  if (custo <= 0) throw new Error('o custo precisa ser maior que zero');

  var tipo = ['tela', 'privilegio', 'meta'].indexOf(r.tipo) >= 0 ? r.tipo : 'privilegio';
  var minutos = tipo === 'tela' ? Math.max(0, Math.round(Number(r.minutos) || 0)) : 0;
  if (tipo === 'tela' && !minutos) throw new Error('diga quantos minutos de tela isso vale');

  var campos = {
    titulo: titulo,
    icone: String(r.icone || '').trim(),
    tipo: tipo,
    // Meta grande só sai do cofrinho: é isso que impede gastar a poupança em tela.
    bolso: tipo === 'meta' ? 'cofrinho' : (r.bolso === 'cofrinho' ? 'cofrinho' : 'gastavel'),
    custo: custo,
    minutos: minutos,
    ativa: simNao(r.ativa !== false)
  };

  var existente = String(r.id || '').trim()
    ? ler('Recompensas').filter(function (x) { return String(x.id) === String(r.id); })[0]
    : null;

  if (existente) {
    Object.keys(campos).forEach(function (c) {
      escrever('Recompensas', existente._linha, c, campos[c]);
    });
    return { id: existente.id, novo: false };
  }

  campos.id = novoId('rc');
  anexar('Recompensas', campos);
  return { id: campos.id, novo: true };
}

var ACOES = {
  marcar: acaoMarcar,
  salvarTarefa: acaoSalvarTarefa,
  salvarRecompensa: acaoSalvarRecompensa,
  decidir: acaoDecidir,
  pedir: acaoPedir,
  decidirResgate: acaoDecidirResgate,
  cancelar: acaoCancelar,
  entregue: acaoEntregue,
  ajustar: acaoAjustar,
  fecharSemana: acaoFecharSemana,
  pagarSemana: acaoPagarSemana
};

// =====================================================================
// ENTRADA HTTP
// =====================================================================

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Uma requisição por vez. Com duas pessoas é raro colidir, mas duas escritas
 * simultâneas na mesma aba embaralhariam linhas.
 */
function comTrava(fn) {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) throw new Error('planilha ocupada, tente de novo');
  try { return fn(); } finally { trava.releaseLock(); }
}

function tratar(entrada) {
  var cfg = config();
  var pessoa = quem(entrada.codigo, cfg);

  // A página manda uma lista de ações pendentes de uma vez (ela pode ter
  // marcado três tarefas offline). Cada uma responde separadamente, para um
  // erro de regra numa não derrubar as outras.
  var resultados = [];
  var acoes = entrada.acoes || [];
  for (var i = 0; i < acoes.length; i++) {
    var a = acoes[i];
    var fn = ACOES[a.acao];
    if (!fn) { resultados.push({ ref: a.ref, ok: false, erro: 'ação desconhecida' }); continue; }
    try {
      resultados.push({ ref: a.ref, ok: true, dados: fn(pessoa, cfg, a) });
    } catch (err) {
      resultados.push({ ref: a.ref, ok: false, erro: String(err.message || err) });
    }
  }

  garantirDias(cfg, 14);
  var estado = montarEstado(pessoa, cfg);
  estado.resultados = resultados;
  return estado;
}

function responder(entrada) {
  try {
    return json(comTrava(function () {
      var r = tratar(entrada);
      r.ok = true;
      return r;
    }));
  } catch (err) {
    var msg = String(err.message || err);
    return json({ ok: false, erro: msg });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  return responder({ codigo: p.codigo, acoes: [] });
}

// O HTML manda text/plain de propósito: evita a verificação CORS prévia,
// que o Apps Script não responde.
function doPost(e) {
  var corpo = {};
  try { corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json({ ok: false, erro: 'corpo inválido' }); }
  return responder(corpo);
}

// =====================================================================
// INSTALAÇÃO
// Rode instalar() uma vez, pelo editor de script.
// =====================================================================

function instalar() {
  var planilha = ss();
  if (!planilha) {
    throw new Error(
      'Este script não está preso a nenhuma planilha. Ele precisa ser criado de ' +
      'dentro dela: abra a planilha e vá em Extensões > Apps Script. Um script ' +
      'criado direto em script.google.com não enxerga planilha nenhuma.');
  }

  // Monta o índice uma vez só, a partir da lista real de abas.
  var existentes = {};
  planilha.getSheets().forEach(function (s) { existentes[s.getName()] = s; });

  Object.keys(ABAS).forEach(function (nome) {
    var s = existentes[nome];
    if (!s) {
      s = planilha.insertSheet(nome);
      existentes[nome] = s;
    }
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold');
      s.setFrozenRows(1);
    }
  });

  listasSuspensas(existentes);

  // Remove a aba padrão vazia, se sobrou. Só se estiver realmente vazia:
  // apagar aba com conteúdo de alguém seria péssimo.
  ['Sheet1', 'Página1', 'Planilha1'].forEach(function (nome) {
    var padrao = existentes[nome];
    if (padrao && padrao.getLastRow() === 0 && planilha.getSheets().length > 1) {
      planilha.deleteSheet(padrao);
      delete existentes[nome];
    }
  });

  if (ler('Config').length === 0) {
    var codigoPai = novoCodigo();
    var codigoFilha = novoCodigo();
    [['fuso', 'America/Sao_Paulo'],
     ['taxa_cofrinho', 0.3],
     ['janela_atraso', 2],
     ['teto_tela_min', 40],
     ['nome_pai', 'Pai'],
     ['nome_filha', 'Filha'],
     ['emoji_filha', '🦄'],
     ['codigo_pai', codigoPai],
     ['codigo_filha', codigoFilha]
    ].forEach(function (par) { anexar('Config', { chave: par[0], valor: par[1] }); });
  }

  if (ler('Faixas').length === 0) {
    // R$ 12,50/semana = os R$ 50/mês que ela já recebe, a partir de 70%.
    // O piso NUNCA é zero: se ela puder zerar, para de tentar no meio da semana.
    [[0, 5, 'Piso'], [50, 8.5, 'Metade do caminho'],
     [70, 12.5, 'O normal (R$ 50/mês)'], [85, 15, 'Acima do combinado']
    ].forEach(function (f) {
      anexar('Faixas', { min_pct: f[0], valor: f[1], rotulo: f[2] });
    });
  }

  if (ler('Tarefas').length === 0) semearTarefas();
  if (ler('Recompensas').length === 0) semearRecompensas();

  garantirDias(config(), 0);

  var c = config();
  var msg = 'Pronto.\n\nCódigo do pai:   ' + c.codigoPai +
            '\nCódigo da filha: ' + c.codigoFilha +
            '\n\nPublique como app da web e use esses códigos no site.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/**
 * Código de acesso. 8 caracteres de um alfabeto de 32 dão ~1,1 trilhão de
 * combinações: como o endereço do app fica num site público, o código é a
 * única barreira, e 6 caracteres seriam pouco.
 * Sem I, O, 0 e 1, para ninguém errar ao digitar.
 */
function novoCodigo() {
  var letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += letras.charAt(Math.floor(Math.random() * letras.length));
  return s;
}

function semearTarefas() {
  // BÁSICAS: dever. Não pagam pontos, mas contam para a mesada e para o streak.
  // É o que evita a criança que pergunta "quanto eu ganho pra isso?" antes de
  // escovar os dentes.
  var basicas = [
    ['Escovar os dentes (manhã)', '🪥', 'manha', 'diaria', ''],
    ['Arrumar a cama', '🛏️', 'manha', 'diaria', ''],
    ['Mochila pronta', '🎒', 'noite', 'semana', ''],
    ['Lição de casa', '📚', 'tarde', 'semana', ''],
    ['Escovar os dentes (noite)', '🪥', 'noite', 'diaria', '']
  ];
  var hoje = hojeLocal(config());
  basicas.forEach(function (t) {
    anexar('Tarefas', {
      id: novoId('tf'), titulo: t[0], icone: t[1], tipo: 'basica', pontos: 0,
      periodo: t[2], recorrencia: t[3], dias: t[4],
      precisa_aprovacao: 'nao', conta_mesada: 'sim', ativa: 'sim', criada_em: hoje
    });
  });

  // EXTRAS: pagam pontos. Calibradas para ~90-105 pontos num dia útil, ou seja
  // ~63-74 gastáveis -> 32 a 37 min de tela, dentro do teto de 40.
  var extras = [
    ['Pôr a mesa', '🍽️', 20, 'noite', 'diaria', '', 'nao'],
    ['Tirar a mesa', '🧽', 20, 'noite', 'diaria', '', 'nao'],
    ['Tirar o lixo', '🗑️', 20, 'noite', 'diaria', '', 'nao'],
    ['Lavar a louça', '🫧', 30, 'noite', 'diaria', '', 'sim'],
    ['Regar as plantas', '🪴', 15, 'manha', 'dias', '1,3,5', 'nao'],
    ['Organizar o quarto', '🧹', 40, 'qualquer', 'fimdesemana', '', 'sim']
  ];
  extras.forEach(function (t) {
    anexar('Tarefas', {
      id: novoId('tf'), titulo: t[0], icone: t[1], tipo: 'extra', pontos: t[2],
      periodo: t[3], recorrencia: t[4], dias: t[5],
      precisa_aprovacao: t[6], conta_mesada: 'sim', ativa: 'sim', criada_em: hoje
    });
  });
}

function semearRecompensas() {
  // Preços derivados do teto de 40 min/dia, nunca o contrário.
  var itens = [
    ['15 min de tela', '📱', 'tela', 'gastavel', 30, 15],
    ['30 min de tela', '📱', 'tela', 'gastavel', 60, 30],
    ['1 hora de tela (sábado)', '🎮', 'tela', 'gastavel', 130, 60],
    ['Escolher o filme da sexta', '🍿', 'privilegio', 'gastavel', 80, 0],
    ['Escolher o jantar', '🍕', 'privilegio', 'gastavel', 90, 0],
    ['Dormir 30 min mais tarde', '🌙', 'privilegio', 'gastavel', 150, 0],
    ['Pular uma tarefa (uma vez)', '🎟️', 'privilegio', 'gastavel', 120, 0],
    // Meta grande: SÓ do cofrinho. É isso que impede gastar a poupança em tela.
    // A ~28 pontos/dia, 4000 dão uns 4 meses e meio. ESCOLHA O ITEM COM ELA.
    ['Meta grande (troque pelo combinado)', '🚲', 'meta', 'cofrinho', 4000, 0]
  ];
  itens.forEach(function (r) {
    anexar('Recompensas', {
      id: novoId('rc'), titulo: r[0], icone: r[1], tipo: r[2], bolso: r[3],
      custo: r[4], minutos: r[5], ativa: 'sim'
    });
  });
}

/**
 * Transforma as colunas de escolha em listas suspensas.
 *
 * A planilha é o painel: você vai digitar linhas à mão, e "diária" com acento
 * ou "Semana" com maiúscula fariam a tarefa simplesmente não aparecer. Com
 * lista suspensa não tem como errar.
 */
function listasSuspensas(existentes) {
  var opcoes = {
    Tarefas: {
      tipo: ['basica', 'extra'],
      periodo: ['manha', 'tarde', 'noite', 'qualquer'],
      recorrencia: ['diaria', 'semana', 'fimdesemana', 'dias', 'avulsa'],
      precisa_aprovacao: ['sim', 'nao'],
      conta_mesada: ['sim', 'nao'],
      ativa: ['sim', 'nao']
    },
    Recompensas: {
      tipo: ['tela', 'privilegio', 'meta'],
      bolso: ['gastavel', 'cofrinho'],
      ativa: ['sim', 'nao']
    }
  };

  Object.keys(opcoes).forEach(function (nomeAba) {
    var s = existentes[nomeAba];
    if (!s) return;
    Object.keys(opcoes[nomeAba]).forEach(function (campo) {
      var coluna = ABAS[nomeAba].indexOf(campo) + 1;
      if (coluna < 1) return;
      var regra = SpreadsheetApp.newDataValidation()
        .requireValueInList(opcoes[nomeAba][campo], true)
        .setAllowInvalid(false)
        .build();
      s.getRange(2, coluna, 500, 1).setDataValidation(regra);
    });
  });
}

/**
 * Rode isto se instalar() falhar: diz exatamente o que o script está enxergando.
 * O resultado aparece no registro de execução (Ctrl+Enter no editor).
 */
function diagnostico() {
  var linhas = [];
  var planilha = null;
  try { planilha = SpreadsheetApp.getActive(); } catch (e) {
    linhas.push('getActive() deu erro: ' + e.message);
  }

  if (!planilha) {
    linhas.push('SpreadsheetApp.getActive() devolveu vazio.');
    linhas.push('O script não está preso a uma planilha. Crie-o por');
    linhas.push('Extensões > Apps Script de dentro da planilha.');
  } else {
    linhas.push('Planilha: ' + planilha.getName());
    linhas.push('Endereço: ' + planilha.getUrl());
    var nomes = planilha.getSheets().map(function (s) {
      return s.getName() + ' (' + s.getLastRow() + ' linhas)';
    });
    linhas.push('Abas (' + nomes.length + '): ' + (nomes.join(', ') || 'nenhuma'));
    var faltando = Object.keys(ABAS).filter(function (n) {
      return !procurarAba(planilha, n);
    });
    linhas.push(faltando.length ? 'Faltam: ' + faltando.join(', ') : 'Todas as abas existem.');
  }

  var texto = linhas.join('\n');
  Logger.log(texto);
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) {}
  return texto;
}

/** Atalho no menu da planilha, para não precisar abrir o editor. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Tarefas')
      .addItem('Instalar / conferir abas', 'instalar')
      .addItem('Gerar dias de hoje', 'gerarAgora')
      .addItem('Ver códigos de acesso', 'verCodigos')
      .addItem('Diagnóstico', 'diagnostico')
      .addToUi();
  } catch (e) {}
}

function gerarAgora() {
  var n = garantirDias(config(), 14);
  SpreadsheetApp.getUi().alert(n + ' tarefa(s) gerada(s).');
}

function verCodigos() {
  var c = config();
  SpreadsheetApp.getUi().alert('Pai: ' + c.codigoPai + '\nFilha: ' + c.codigoFilha);
}
