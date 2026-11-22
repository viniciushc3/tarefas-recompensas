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
                'dias', 'precisa_aprovacao', 'precisa_foto', 'conta_mesada', 'ativa',
                'criada_em'],
  Ocorrencias: ['id', 'data', 'tarefa_id', 'titulo', 'icone', 'pontos', 'tipo', 'periodo',
                'conta_mesada', 'precisa_aprovacao', 'precisa_foto', 'foto',
                'status', 'marcada_em', 'decidida_em'],
  Extrato:     ['id', 'quando', 'tipo', 'gastavel', 'cofrinho', 'motivo', 'ref'],
  Recompensas: ['id', 'titulo', 'icone', 'tipo', 'bolso', 'custo', 'minutos', 'ativa'],
  Resgates:    ['id', 'quando', 'recompensa_id', 'titulo', 'custo', 'bolso', 'minutos',
                'status', 'decidido_em'],
  Faixas:      ['min_pct', 'valor', 'rotulo'],
  Semanas:     ['semana', 'elegiveis', 'aprovadas', 'pct', 'valor', 'status']
};

/**
 * Versão deste arquivo. Aparece no diagnóstico e na resposta do app.
 * Serve para saber, sem adivinhação, qual código está realmente rodando.
 */
var VERSAO = '2026-11-22.5';

/**
 * Tamanho da foto. Medido com uma foto de celular de 3000x4000:
 * baixa 58 KB, media 113 KB, alta 230 KB.
 *
 * Baixa é o padrão porque a foto existe para responder "a cama está
 * arrumada?", e 480x640 responde isso de sobra. O tamanho pesa duas vezes:
 * no envio dela e de novo quando você abre a fila para olhar.
 */
var QUALIDADES = {
  baixa: { lado: 640, q: 0.45 },
  media: { lado: 900, q: 0.55 },
  alta:  { lado: 1200, q: 0.70 }
};

/** Qual status "ganha" quando a mesma tarefa-dia aparece repetida. */
var PESO_STATUS = { aprovada: 5, marcada: 4, recusada: 3, pendente: 2, expirada: 1 };

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
 * Colunas que o Google Sheets converte sozinho em data.
 *
 * Escrever "2026-11-23" numa célula faz a planilha guardar um valor de data, e
 * na leitura volta um objeto Date — String(date) vira "Mon Nov 23 2026 ..." e
 * nunca é igual a "2026-11-23". Tudo que compara dia por igualdade quebra em
 * silêncio. Então toda leitura passa por aqui e vira texto de novo.
 *
 * 'dias' entra na lista porque, em tarefa avulsa, ele guarda uma data.
 */
var COLUNAS_DATA = {
  Ocorrencias: { data: 'dia', marcada_em: 'instante', decidida_em: 'instante' },
  Extrato:     { quando: 'instante' },
  Resgates:    { quando: 'instante', decidido_em: 'instante' },
  Tarefas:     { criada_em: 'dia', dias: 'dia' },
  Semanas:     { semana: 'dia' }
};

function comoTexto(valor, tipo) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, ss().getSpreadsheetTimeZone(),
      tipo === 'instante' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

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
/**
 * Cache por execução.
 *
 * Cada getValues() é uma ida ao servidor do Sheets, de 30 a 150ms. Uma
 * requisição lia a mesma aba três vezes; agora lê uma. É de onde vem a maior
 * parte da lentidão.
 */
var _cache = {};

function ler(nome) {
  if (_cache[nome]) return _cache[nome];
  var s = aba(nome);
  var v = s.getDataRange().getValues();
  if (v.length < 2) return [];
  var cab = v[0].map(function (c) { return String(c).trim(); });

  // Coluna nova entra sozinha, sem depender de ninguém rodar instalar().
  //
  // Quando acrescentei precisa_foto e foto, quem não rodou instalar() ficou
  // com a aba antiga: a geração escrevia sem as colunas, a leitura devolvia
  // vazio, e nenhuma tarefa pedia foto — em silêncio, que é o pior jeito de
  // falhar.
  var esperadas = ABAS[nome] || [];
  var util = cab.slice();
  while (util.length && util[util.length - 1] === '') util.pop();
  var faltando = esperadas.filter(function (c) { return cab.indexOf(c) < 0; });
  if (faltando.length) {
    s.getRange(1, util.length + 1, 1, faltando.length)
      .setValues([faltando]).setFontWeight('bold');
    cab = util.concat(faltando);
    delete _cabecalhos[nome];
  }
  var datas = COLUNAS_DATA[nome] || {};
  var saida = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = {};
    for (var j = 0; j < cab.length; j++) {
      o[cab[j]] = datas[cab[j]] ? comoTexto(v[i][j], datas[cab[j]]) : v[i][j];
    }
    o._linha = i + 1;
    saida.push(o);
  }
  _cache[nome] = saida;
  return saida;
}

/**
 * Cabeçalho real da aba, não o que ABAS diz que deveria ser.
 *
 * Importa porque a planilha de alguém pode ter sido criada com uma versão
 * anterior, sem as colunas que eu acrescentei depois. Escrever pela posição
 * de ABAS nesse caso joga valor na coluna errada, silenciosamente.
 */
var _cabecalhos = {};

function cabecalho(nome) {
  if (_cabecalhos[nome]) return _cabecalhos[nome];
  var s = aba(nome);
  var largura = s.getLastColumn();
  var cols = largura > 0
    ? s.getRange(1, 1, 1, largura).getValues()[0].map(function (c) { return String(c).trim(); })
    : [];
  while (cols.length && cols[cols.length - 1] === '') cols.pop();
  _cabecalhos[nome] = cols.length ? cols : ABAS[nome].slice();
  return _cabecalhos[nome];
}

function anexar(nome, objeto) {
  var cols = cabecalho(nome);
  aba(nome).appendRow(cols.map(function (c) {
    return objeto[c] === undefined || objeto[c] === null ? '' : objeto[c];
  }));
  delete _cache[nome];
}

function escrever(nome, linha, campo, valor) {
  var col = cabecalho(nome).indexOf(campo) + 1;
  if (col < 1) {
    throw new Error('a aba ' + nome + ' não tem a coluna ' + campo + ' — rode instalar()');
  }
  aba(nome).getRange(linha, col).setValue(valor);

  // Mantém o cache coerente em vez de jogá-lo fora: a próxima leitura não
  // precisa de outra ida ao servidor.
  var linhas = _cache[nome];
  if (linhas) {
    for (var i = 0; i < linhas.length; i++) {
      if (linhas[i]._linha === linha) { linhas[i][campo] = valor; break; }
    }
  }
}

/**
 * Grava vários campos de uma linha numa única ida ao servidor.
 *
 * Salvar uma tarefa mexia em 11 colunas, uma chamada por coluna. Agora é uma.
 * Recebe a própria linha devolvida por ler(), então nem precisa reler antes.
 */
function escreverLinha(nome, registro, campos) {
  var cols = cabecalho(nome);
  Object.keys(campos).forEach(function (c) { registro[c] = campos[c]; });
  var valores = cols.map(function (c) {
    return registro[c] === undefined || registro[c] === null ? '' : registro[c];
  });
  aba(nome).getRange(registro._linha, 1, 1, cols.length).setValues([valores]);
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
    qualidadeFoto: QUALIDADES[String(c.qualidade_foto || '').trim()] ? String(c.qualidade_foto).trim() : 'baixa',
    nomePai: c.nome_pai || 'Pai',
    nomeFilha: c.nome_filha || 'Filha',
    emojiFilha: c.emoji_filha || '🦄'
  };
}

function gravarConfig(chave, valor) {
  var linha = ler('Config').filter(function (c) { return c.chave === chave; })[0];
  if (linha) escrever('Config', linha._linha, 'valor', valor);
  else anexar('Config', { chave: chave, valor: valor });
}

function lerConfig(chave) {
  var linha = ler('Config').filter(function (c) { return c.chave === chave; })[0];
  return linha ? String(linha.valor || '') : '';
}

/** Obriga a próxima requisição a gerar o dia de novo. */
function marcarGeracaoVencida() { gravarConfig('ultima_geracao', ''); }

function hojeLocal(cfg) {
  return Utilities.formatDate(new Date(), cfg.fuso, 'yyyy-MM-dd');
}

function agora(cfg) {
  return Utilities.formatDate(new Date(), cfg.fuso, 'yyyy-MM-dd HH:mm');
}

/**
 * Identificador único.
 *
 * A versão anterior era milissegundo + um aleatório de 1296 valores. Parece
 * bastante até lembrar que instalar() cria 19 linhas e garantirDias() até 165,
 * tudo no mesmo milissegundo: a chance de duas baterem é alta. E colisão aqui
 * é silenciosa e feia — duas tarefas com o mesmo id fazem a segunda nunca
 * gerar ocorrência, e duas ocorrências iguais fazem marcar uma marcar a outra.
 *
 * O contador garante unicidade dentro de uma execução; o tempo e o aleatório
 * cuidam de execuções diferentes.
 */
var _sequencia = 0;

function novoId(prefixo) {
  _sequencia++;
  return prefixo + '-' + Date.now().toString(36) +
    '-' + _sequencia.toString(36) +
    Math.floor(Math.random() * 1679616).toString(36);
}

/** O código de acesso define quem está falando. Sem código, nada acontece. */
function quem(codigo, cfg) {
  // Sem diferenciar maiúscula de minúscula: o código pode ser uma senha
  // simples escolhida à mão na aba Config, e ninguém quer errar por causa
  // do teclado do celular.
  var dado = String(codigo || '').trim().toLowerCase();
  if (!dado) throw new Error('codigo');
  var pai = String(cfg.codigoPai || '').trim().toLowerCase();
  var filha = String(cfg.codigoFilha || '').trim().toLowerCase();
  if (pai && dado === pai) return { papel: 'pai', nome: cfg.nomePai };
  if (filha && dado === filha) return { papel: 'filha', nome: cfg.nomeFilha };
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

    var novos = {};
    if (falta('id'))                novos.id = novoId('tf');
    // Sem isto, a tarefa nova nasceria com ocorrências nos 14 dias anteriores,
    // todas expiradas, e derrubaria o percentual da semana dela.
    if (falta('criada_em'))         novos.criada_em = hoje;
    if (falta('tipo'))              novos.tipo = 'extra';
    if (falta('pontos'))            novos.pontos = 0;
    if (falta('periodo'))           novos.periodo = 'qualquer';
    if (falta('recorrencia'))       novos.recorrencia = 'diaria';
    if (falta('precisa_aprovacao')) novos.precisa_aprovacao = 'nao';
    // Foto sem conferência não faz sentido: alguém tem de olhar a foto.
    if (falta('precisa_foto'))      novos.precisa_foto = 'nao';
    if (booleano(t.precisa_foto) || novos.precisa_foto === 'sim') {
      if (!booleano(t.precisa_aprovacao)) novos.precisa_aprovacao = 'sim';
    }
    // Em branco significaria "não conta para a mesada", que não é o que
    // alguém quer dizer ao deixar a célula vazia.
    if (falta('conta_mesada'))      novos.conta_mesada = 'sim';
    if (falta('ativa'))             novos.ativa = 'sim';

    if (Object.keys(novos).length) {
      escreverLinha('Tarefas', t, novos);
      marcarGeracaoVencida();   // tarefa nova: o dia precisa ser gerado
    }
  });

  ler('Recompensas').forEach(function (r) {
    if (!String(r.titulo || '').trim()) return;
    var falta = function (campo) { return String(r[campo] === 0 ? '0' : (r[campo] || '')).trim() === ''; };

    var novos = {};
    if (falta('id'))      novos.id = novoId('rc');
    if (falta('tipo'))    novos.tipo = 'privilegio';
    // Meta grande sai só do cofrinho: é isso que impede gastar a poupança em tela.
    if (falta('bolso'))   novos.bolso = r.tipo === 'meta' ? 'cofrinho' : 'gastavel';
    if (falta('minutos')) novos.minutos = 0;
    if (falta('ativa'))   novos.ativa = 'sim';

    if (Object.keys(novos).length) escreverLinha('Recompensas', r, novos);
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

  // Antes de escrever qualquer coisa: se o script mudou de versão, repõe as
  // validações. Barato (uma leitura de Config, que já está em cache) e evita
  // depender de alguém abrir o editor para rodar instalar().
  if (lerConfig('validacoes') !== VERSAO) repararValidacoes();

  normalizar(cfg);
  var tarefas = ler('Tarefas').filter(function (t) {
    return booleano(t.ativa) && String(t.id || '').trim() !== '';
  });
  // Sempre, mesmo quando o dia já foi gerado: o que ainda está pendente tem
  // de refletir a tarefa como ela é agora. Não custa leitura extra, porque a
  // aba de ocorrências é lida de qualquer jeito para montar a tela.
  alinharPendentes(cfg, tarefas, hoje);

  // Gerar o dia custa um varrimento de 15 dias. Não precisa acontecer a cada
  // toque: uma vez por dia basta, ou quando o conjunto de tarefas muda.
  var assinatura = hoje + '|' + tarefas.length;
  if (lerConfig('ultima_geracao') === assinatura) return 0;

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
      novas.push({
        id: novoId('oc'), data: dia, tarefa_id: t.id, titulo: t.titulo, icone: t.icone,
        pontos: Number(t.pontos) || 0, tipo: t.tipo, periodo: t.periodo || 'qualquer',
        conta_mesada: booleano(t.conta_mesada) ? 'sim' : 'nao',
        precisa_aprovacao: booleano(t.precisa_aprovacao) ? 'sim' : 'nao',
        precisa_foto: booleano(t.precisa_foto) ? 'sim' : 'nao',
        foto: '',
        status: 'pendente', marcada_em: '', decidida_em: ''
      });
      existentes[t.id + '|' + dia] = true;
    });
  }
  if (novas.length) {
    var s = aba('Ocorrencias');
    // Pelo cabeçalho real, não pela ordem de ABAS: planilha criada por versão
    // anterior pode ter as colunas em outra ordem.
    var cols = cabecalho('Ocorrencias');
    s.getRange(s.getLastRow() + 1, 1, novas.length, cols.length).setValues(
      novas.map(function (o) {
        return cols.map(function (c) { return o[c] === undefined ? '' : o[c]; });
      }));
    // Escrita em bloco não passa por anexar(): sem isto, a própria resposta
    // sairia com a lista velha e as tarefas novas não apareceriam.
    delete _cache['Ocorrencias'];
  }

  expirarVencidas(cfg, hoje);
  gravarConfig('ultima_geracao', assinatura);
  return novas.length;
}

/**
 * Põe as ocorrências pendentes de hoje em diante de acordo com a tarefa.
 *
 * Retrato protege histórico, não o que ainda não aconteceu. E conserta o caso
 * em que a ocorrência nasceu numa planilha que ainda não tinha a coluna: sem
 * isto, uma tarefa que passou a pedir foto só passaria a pedir amanhã.
 *
 * Só escreve quando algo mudou de verdade — no dia a dia não escreve nada.
 */
function alinharPendentes(cfg, tarefas, hoje) {
  var porId = {};
  tarefas.forEach(function (t) { porId[String(t.id)] = t; });

  var alterados = 0;
  ler('Ocorrencias').forEach(function (o) {
    if (o.status !== 'pendente' || String(o.data) < hoje) return;
    var t = porId[String(o.tarefa_id)];
    if (!t) return;

    var esperado = {
      titulo: t.titulo,
      icone: t.icone,
      pontos: Number(t.pontos) || 0,
      tipo: t.tipo,
      periodo: t.periodo || 'qualquer',
      conta_mesada: booleano(t.conta_mesada) ? 'sim' : 'nao',
      precisa_aprovacao: booleano(t.precisa_aprovacao) ? 'sim' : 'nao',
      precisa_foto: booleano(t.precisa_foto) ? 'sim' : 'nao'
    };

    var diferente = Object.keys(esperado).some(function (c) {
      return String(o[c] === 0 ? '0' : (o[c] || '')) !== String(esperado[c]);
    });
    if (!diferente) return;

    escreverLinha('Ocorrencias', o, esperado);
    alterados++;
  });
  return alterados;
}

/**
 * Expira o que passou da janela. Expirada conta como NÃO feita na mesada,
 * que é o comportamento correto.
 *
 * Grava a coluna inteira de uma vez: antes era uma chamada por linha, e numa
 * planilha com semanas de histórico isso sozinho levava segundos.
 */
function expirarVencidas(cfg, hoje) {
  var limite = somarDias(hoje, -cfg.janelaAtraso);
  var alvos = ler('Ocorrencias').filter(function (o) {
    return o.status === 'pendente' && String(o.data) < limite;
  });
  if (!alvos.length) return 0;

  var coluna = cabecalho('Ocorrencias').indexOf('status') + 1;
  var primeira = alvos[0]._linha;
  var ultima = alvos[alvos.length - 1]._linha;
  var faixa = aba('Ocorrencias').getRange(primeira, coluna, ultima - primeira + 1, 1);
  var valores = faixa.getValues();

  alvos.forEach(function (o) {
    valores[o._linha - primeira][0] = 'expirada';
    o.status = 'expirada';          // mantém o cache coerente
  });
  faixa.setValues(valores);
  return alvos.length;
}

// --------------------------------------------------------------- estado
function montarEstado(pessoa, cfg) {
  var hoje = hojeLocal(cfg);

  // Janela curta e sem repetidas.
  //
  // A tela precisa de ~30 dias (o streak) e mais nada. Mandar o histórico
  // inteiro engorda a resposta, e o celular dela grava isso no armazenamento
  // local a cada toque — com planilha bagunçada vira meio segundo de trava
  // por clique. A limpeza aqui também protege de uma planilha que ainda não
  // passou pelo consertar().
  var limiteJanela = somarDias(hoje, -35);
  var melhores = {};
  ler('Ocorrencias').forEach(function (o) {
    var data = String(o.data);
    if (data < limiteJanela || data > hoje) return;
    var chave = o.tarefa_id + '|' + data;
    var peso = PESO_STATUS[String(o.status).trim()] || 0;
    if (!melhores[chave] || peso > melhores[chave]._peso) {
      o._peso = peso;
      melhores[chave] = o;
    }
  });

  var ocorrencias = Object.keys(melhores).map(function (k) { return melhores[k]; })
    .map(function (o) {
    return {
      id: o.id, data: String(o.data), titulo: o.titulo, icone: o.icone,
      pontos: Number(o.pontos) || 0, tipo: o.tipo,
      periodo: o.periodo || 'qualquer',
      conta_mesada: booleano(o.conta_mesada),
      precisa_aprovacao: booleano(o.precisa_aprovacao),
      precisa_foto: booleano(o.precisa_foto),
      // só o identificador; a imagem é buscada quando alguém vai olhar
      foto: String(o.foto || ''),
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
  // A mesada só aparece na tela do pai. Ler Faixas e Semanas no celular dela
  // seriam duas idas ao servidor para montar algo que ela nunca vê.
  var ePai = pessoa.papel === 'pai';
  var faixas = ePai ? ler('Faixas').map(function (f) {
    return { min_pct: Number(f.min_pct) || 0, valor: Number(f.valor) || 0, rotulo: f.rotulo };
  }) : [];

  var semana = inicioDaSemana(hoje);
  var resumo = resumoDaSemana(ocorrencias, semana);

  return {
    versao: VERSAO,
    papel: pessoa.papel,
    nome: pessoa.nome,
    // O painel de administração é a própria planilha: tarefas, preços e faixas
    // se editam lá, não numa tela que eu teria de construir e você manter.
    planilha: ePai ? ss().getUrl() : '',
    // Para o pai montar o link de acesso dela. Ele já tem acesso a tudo,
    // então saber o código dela não abre nada novo.
    codigoFilha: ePai ? String(cfg.codigoFilha || '') : '',
    hoje: hoje,
    semana: semana,
    cfg: {
      janelaAtraso: cfg.janelaAtraso, tetoTela: cfg.tetoTela,
      taxaCofrinho: cfg.taxaCofrinho, nomeFilha: cfg.nomeFilha, emojiFilha: cfg.emojiFilha,
      foto: QUALIDADES[cfg.qualidadeFoto] || QUALIDADES.baixa,
      qualidadeFoto: cfg.qualidadeFoto
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
    ocorrencias: ocorrencias,
    recompensas: recompensas,
    // Para a tela de edição: tudo, inclusive desativado. Só para o pai — a
    // filha não precisa ver o que está fora da loja.
    tarefas: ePai ? ler('Tarefas').map(function (t) {
      return {
        id: t.id, titulo: t.titulo, icone: t.icone, tipo: t.tipo,
        pontos: Number(t.pontos) || 0, periodo: t.periodo || 'qualquer',
        recorrencia: t.recorrencia || 'diaria', dias: String(t.dias || ''),
        precisa_aprovacao: booleano(t.precisa_aprovacao),
        precisa_foto: booleano(t.precisa_foto),
        conta_mesada: booleano(t.conta_mesada),
        ativa: booleano(t.ativa)
      };
    }) : [],
    catalogo: ePai ? ler('Recompensas').map(function (r) {
      return {
        id: r.id, titulo: r.titulo, icone: r.icone, tipo: r.tipo,
        bolso: r.bolso, custo: Number(r.custo) || 0,
        minutos: Number(r.minutos) || 0, ativa: booleano(r.ativa)
      };
    }) : [],
    resgates: resgates.slice(-40),
    extrato: extrato.slice(-80).reverse(),
    semanas: !ePai ? [] : ler('Semanas').map(function (s) {
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
  // Trava de crédito duplo: uma ocorrência paga no máximo uma vez por vez.
  //
  // Conta ganhos menos estornos em vez de "existe ganho": sem isso, desmarcar
  // e marcar de novo deixaria a tarefa sem pagar, porque o ganho antigo ainda
  // está no extrato (que só cresce, nunca apaga).
  var saldoDaOcorrencia = 0;
  ler('Extrato').forEach(function (e) {
    if (String(e.ref) !== String(oc.id)) return;
    if (e.tipo === 'ganho') saldoDaOcorrencia++;
    if (e.tipo === 'estorno') saldoDaOcorrencia--;
  });
  if (saldoDaOcorrencia > 0) return;
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

  if (booleano(oc.precisa_foto) && !String(oc.foto || '').trim()) {
    throw new Error('essa tarefa precisa de foto');
  }

  var novo = booleano(oc.precisa_aprovacao) ? 'marcada' : 'aprovada';
  escreverLinha('Ocorrencias', oc, {
    status: novo,
    marcada_em: agora(cfg),
    decidida_em: novo === 'aprovada' ? agora(cfg) : oc.decidida_em
  });
  if (novo === 'aprovada') creditar(cfg, oc);
  return { status: novo };
}

/**
 * Desfaz uma marcação.
 *
 * Toque errado é garantido com criança, e sem isto a tela simplesmente não
 * responde — foi o que aconteceu. Marcar e desmarcar são os dois sentidos do
 * mesmo gesto, então nenhum dos dois pede confirmação: cada um desfaz o outro.
 */
function acaoDesmarcar(pessoa, cfg, dados) {
  var hoje = hojeLocal(cfg);
  var oc = ler('Ocorrencias').filter(function (o) { return o.id === dados.id; })[0];
  if (!oc) throw new Error('tarefa não encontrada');
  if (oc.status !== 'aprovada' && oc.status !== 'marcada') {
    throw new Error('essa tarefa não está marcada');
  }
  var data = String(oc.data);
  if (data < somarDias(hoje, -cfg.janelaAtraso)) {
    throw new Error('passou do prazo para mexer nessa tarefa');
  }

  // Devolve os pontos que esta ocorrência pagou, se pagou.
  var pagos = { gastavel: 0, cofrinho: 0 };
  ler('Extrato').forEach(function (e) {
    if (String(e.ref) !== String(oc.id)) return;
    if (e.tipo === 'ganho') {
      pagos.gastavel += Number(e.gastavel) || 0;
      pagos.cofrinho += Number(e.cofrinho) || 0;
    }
    if (e.tipo === 'estorno') {
      pagos.gastavel += Number(e.gastavel) || 0;
      pagos.cofrinho += Number(e.cofrinho) || 0;
    }
  });

  if (pagos.gastavel || pagos.cofrinho) {
    // Saldo negativo confunde: se ela já gastou, o desfazer não cabe mais.
    var saldo = saldoDe(ler('Extrato'));
    if (saldo.gastavel - pagos.gastavel < 0 || saldo.cofrinho - pagos.cofrinho < 0) {
      throw new Error('você já gastou esses pontos');
    }
    lancar(cfg, 'estorno', -pagos.gastavel, -pagos.cofrinho,
      'Desmarcou: ' + oc.titulo, oc.id);
  }

  escreverLinha('Ocorrencias', oc, { status: 'pendente', marcada_em: '', decidida_em: '' });
  return { status: 'pendente' };
}

function acaoDecidir(pessoa, cfg, dados) {
  exigirPai(pessoa);
  var oc = ler('Ocorrencias').filter(function (o) { return o.id === dados.id; })[0];
  if (!oc) throw new Error('tarefa não encontrada');
  if (oc.status !== 'marcada') throw new Error('nada a decidir: está ' + oc.status);

  escreverLinha('Ocorrencias', oc, {
    status: dados.aprovar ? 'aprovada' : 'recusada',
    decidida_em: agora(cfg)
  });
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

  escreverLinha('Resgates', rg, {
    status: dados.aprovar ? 'aprovado' : 'recusado',
    decidido_em: agora(cfg)
  });
  if (!dados.aprovar) devolver(cfg, rg, 'Recusado');
  return { status: dados.aprovar ? 'aprovado' : 'recusado' };
}

/** Ela desiste enquanto você não decidiu; os pontos voltam. */
function acaoCancelar(pessoa, cfg, dados) {
  var rg = ler('Resgates').filter(function (x) { return x.id === dados.id; })[0];
  if (!rg) throw new Error('resgate não encontrado');
  if (rg.status !== 'pedido') throw new Error('esse resgate já está ' + rg.status);

  escreverLinha('Resgates', rg, { status: 'cancelado', decidido_em: agora(cfg) });
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
    escreverLinha('Semanas', existente, {
      elegiveis: resumo.elegiveis, aprovadas: resumo.aprovadas,
      pct: resumo.pct, valor: valor, status: 'fechada'
    });
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

// ------------------------------------------------------------- fotos
/**
 * Pasta das fotos, no Drive de quem publicou o script.
 *
 * Fica SEM compartilhamento. O app não usa a URL do Drive: pede a imagem a
 * este mesmo script, que só responde a quem tem código. São fotos do quarto
 * de uma criança — link público, ainda que impossível de adivinhar, não é
 * coisa que eu queira criar sem você pedir.
 */
function pastaDasFotos() {
  var id = lerConfig('pasta_fotos');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* apagada: cria outra */ }
  }
  var pasta = DriveApp.createFolder('Tarefas e Recompensas — fotos');
  gravarConfig('pasta_fotos', pasta.getId());
  return pasta;
}

function acaoEnviarFoto(pessoa, cfg, dados) {
  var oc = ler('Ocorrencias').filter(function (o) { return o.id === dados.id; })[0];
  if (!oc) throw new Error('tarefa não encontrada');

  var base64 = String(dados.dados || '');
  if (!base64) throw new Error('foto vazia');
  // ~4/3 do tamanho do arquivo. 8 MB de base64 já é foto grande demais.
  if (base64.length > 8000000) throw new Error('foto grande demais');

  var mime = dados.mime === 'image/png' ? 'image/png' : 'image/jpeg';
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime,
    'tarefa-' + oc.id + (mime === 'image/png' ? '.png' : '.jpg'));

  var arquivo = pastaDasFotos().createFile(blob);
  escreverLinha('Ocorrencias', oc, { foto: arquivo.getId() });
  return { foto: arquivo.getId() };
}

/**
 * Devolve a imagem em base64.
 *
 * A conferência de que o identificador pertence a uma ocorrência desta
 * planilha não é burocracia: sem ela, quem tivesse um código poderia pedir
 * QUALQUER arquivo do seu Drive, já que o script roda como você.
 */
function acaoFoto(pessoa, cfg, dados) {
  var id = String(dados.foto || '').trim();
  if (!id) throw new Error('foto não informada');

  var nossa = ler('Ocorrencias').some(function (o) { return String(o.foto || '') === id; });
  if (!nossa) throw new Error('foto não encontrada');

  var blob = DriveApp.getFileById(id).getBlob();
  return {
    mime: blob.getContentType(),
    dados: Utilities.base64Encode(blob.getBytes())
  };
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
    // Foto implica aprovação: alguém tem de olhar a foto.
    precisa_aprovacao: simNao(t.precisa_aprovacao || t.precisa_foto),
    precisa_foto: simNao(t.precisa_foto),
    conta_mesada: simNao(t.conta_mesada !== false),
    ativa: simNao(t.ativa !== false)
  };

  var existente = String(t.id || '').trim()
    ? ler('Tarefas').filter(function (x) { return String(x.id) === String(t.id); })[0]
    : null;

  if (existente) {
    escreverLinha('Tarefas', existente, campos);
    if (campos.ativa === 'nao') {
      removerPendentesFuturas(cfg, existente.id);
    } else {
      atualizarPendentes(cfg, existente.id, campos);
    }
    marcarGeracaoVencida();   // mudou tarefa: o dia precisa ser gerado de novo
    return { id: existente.id, novo: false };
  }

  campos.id = novoId('tf');
  // Nasce hoje: sem isto, a tarefa nova geraria ocorrências atrasadas nos dias
  // anteriores, todas expiradas, derrubando a semana dela.
  campos.criada_em = hojeLocal(cfg);
  anexar('Tarefas', campos);
  return { id: campos.id, novo: true };
}

/**
 * Leva a mudança da tarefa para as ocorrências que ainda não aconteceram.
 *
 * O retrato guardado na ocorrência existe para proteger o HISTÓRICO: mudar o
 * preço hoje não pode reescrever o que ela ganhou ontem. Mas aplicar isso ao
 * que ainda está pendente deixa a mudança sem efeito no dia — você liga a
 * foto numa tarefa e nada acontece até amanhã, que foi o que aconteceu.
 */
function atualizarPendentes(cfg, tarefaId, campos) {
  var hoje = hojeLocal(cfg);
  ler('Ocorrencias').forEach(function (o) {
    if (String(o.tarefa_id) !== String(tarefaId)) return;
    if (o.status !== 'pendente') return;     // decidida guarda o que valia
    if (String(o.data) < hoje) return;       // dia passado não muda
    escreverLinha('Ocorrencias', o, {
      titulo: campos.titulo,
      icone: campos.icone,
      pontos: campos.pontos,
      tipo: campos.tipo,
      periodo: campos.periodo,
      conta_mesada: campos.conta_mesada,
      precisa_aprovacao: campos.precisa_aprovacao,
      precisa_foto: campos.precisa_foto
    });
  });
}

/**
 * Tarefa desativada some do dia dela na hora.
 *
 * Só apaga ocorrência pendente de hoje em diante: nada aconteceu nelas, então
 * não há histórico a perder. Deixá-las lá faria a tarefa que você acabou de
 * tirar continuar pesando no percentual da semana.
 */
function removerPendentesFuturas(cfg, tarefaId) {
  var hoje = hojeLocal(cfg);
  var linhas = ler('Ocorrencias')
    .filter(function (o) {
      return String(o.tarefa_id) === String(tarefaId) &&
             o.status === 'pendente' && String(o.data) >= hoje;
    })
    .map(function (o) { return o._linha; })
    .sort(function (a, b) { return b - a; });   // de baixo para cima

  var s = aba('Ocorrencias');
  linhas.forEach(function (linha) { s.deleteRows(linha, 1); });
  if (linhas.length) delete _cache['Ocorrencias'];
  return linhas.length;
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
    escreverLinha('Recompensas', existente, campos);
    return { id: existente.id, novo: false };
  }

  campos.id = novoId('rc');
  anexar('Recompensas', campos);
  return { id: campos.id, novo: true };
}

var ACOES = {
  marcar: acaoMarcar,
  desmarcar: acaoDesmarcar,
  enviarFoto: acaoEnviarFoto,
  foto: acaoFoto,
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
  var acoes = entrada.acoes || [];

  // Pedido só de imagem: devolve a imagem e mais nada.
  //
  // Montar a tela inteira custa seis a oito leituras da planilha. Fazer isso
  // para buscar uma foto é o que deixava a foto demorando a aparecer.
  var soFoto = acoes.length > 0 && acoes.every(function (a) { return a.acao === 'foto'; });
  if (soFoto) {
    return {
      versao: VERSAO,
      somenteFoto: true,
      resultados: acoes.map(function (a) {
        try { return { ref: a.ref, ok: true, dados: acaoFoto(pessoa, cfg, a) }; }
        catch (err) { return { ref: a.ref, ok: false, erro: String(err.message || err) }; }
      })
    };
  }

  // A página manda uma lista de ações pendentes de uma vez (ela pode ter
  // marcado três tarefas offline). Cada uma responde separadamente, para um
  // erro de regra numa não derrubar as outras.
  var resultados = [];
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
  // Cada requisição começa com a planilha "fria". No Apps Script cada chamada
  // já é uma execução nova, mas deixar explícito evita que o cache sobreviva
  // a algo e sirva dado velho.
  _cache = {};
  _cabecalhos = {};
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

  // Antes de qualquer escrita: tira validação de onde quer que esteja.
  Object.keys(ABAS).forEach(function (nome) {
    var s = existentes[nome];
    if (s) s.getRange(2, 1, 1000, 30).clearDataValidations();
  });

  Object.keys(ABAS).forEach(function (nome) {
    var s = existentes[nome];
    if (!s) {
      s = planilha.insertSheet(nome);
      existentes[nome] = s;
    }
    if (s.getLastRow() === 0) {
      s.getRange(1, 1, 1, ABAS[nome].length).setValues([ABAS[nome]]).setFontWeight('bold');
      s.setFrozenRows(1);
      return;
    }

    // Aba criada por uma versão anterior: acrescenta as colunas que faltam.
    // Sempre no fim, nunca reordenando — mexer na ordem deslocaria os dados
    // que já estão lá.
    var largura = s.getLastColumn();
    var atual = largura > 0
      ? s.getRange(1, 1, 1, largura).getValues()[0].map(function (c) { return String(c).trim(); })
      : [];
    while (atual.length && atual[atual.length - 1] === '') atual.pop();

    var faltando = ABAS[nome].filter(function (c) { return atual.indexOf(c) < 0; });
    if (faltando.length) {
      s.getRange(1, atual.length + 1, 1, faltando.length)
        .setValues([faltando]).setFontWeight('bold');
    }
  });

  _cabecalhos = {};   // os cabeçalhos mudaram

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
     ['qualidade_foto', 'baixa'],
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

  // Depois de semear o Config: gravar isto antes faria o bloco que cria as
  // senhas enxergar um Config "já preenchido" e pular — ninguém entraria.
  gravarConfig('validacoes', VERSAO);

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
  // o último campo é a foto: resolve o "mas eu fiz!" quando você não está em casa
  var extras = [
    ['Pôr a mesa', '🍽️', 20, 'noite', 'diaria', '', 'nao', 'nao'],
    ['Tirar a mesa', '🧽', 20, 'noite', 'diaria', '', 'nao', 'nao'],
    ['Tirar o lixo', '🗑️', 20, 'noite', 'diaria', '', 'nao', 'nao'],
    ['Lavar a louça', '🫧', 30, 'noite', 'diaria', '', 'sim', 'nao'],
    ['Regar as plantas', '🪴', 15, 'manha', 'dias', '1,3,5', 'nao', 'nao'],
    ['Organizar o quarto', '🧹', 40, 'qualquer', 'fimdesemana', '', 'sim', 'sim']
  ];
  extras.forEach(function (t) {
    anexar('Tarefas', {
      id: novoId('tf'), titulo: t[0], icone: t[1], tipo: 'extra', pontos: t[2],
      periodo: t[3], recorrencia: t[4], dias: t[5],
      precisa_aprovacao: t[6], precisa_foto: t[7],
      conta_mesada: 'sim', ativa: 'sim', criada_em: hoje
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
function abasPorNome() {
  var mapa = {};
  ss().getSheets().forEach(function (s) { mapa[s.getName()] = s; });
  return mapa;
}

/**
 * Tira toda validação das abas e repõe as listas certas.
 *
 * Roda sozinha quando a versão do script muda, sem depender de ninguém
 * lembrar de abrir o editor. Uma regra deixada na coluna errada por uma
 * versão anterior impede o script de gravar, e o erro aparece num ponto que
 * não tem nada a ver com a causa — foi o que travou o app duas vezes.
 */
function repararValidacoes() {
  var abas = abasPorNome();
  Object.keys(ABAS).forEach(function (nome) {
    var s = abas[nome];
    if (s) s.getRange(2, 1, 1000, 30).clearDataValidations();
  });
  listasSuspensas(abas);
  gravarConfig('validacoes', VERSAO);
}

function listasSuspensas(existentes) {
  var opcoes = {
    Tarefas: {
      tipo: ['basica', 'extra'],
      periodo: ['manha', 'tarde', 'noite', 'qualquer'],
      recorrencia: ['diaria', 'semana', 'fimdesemana', 'dias', 'avulsa'],
      precisa_aprovacao: ['sim', 'nao'],
      precisa_foto: ['sim', 'nao'],
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

    // Pelo cabeçalho REAL, não pela ordem de ABAS.
    //
    // Numa planilha criada por uma versão anterior as colunas estão em outra
    // ordem, e usar a ordem ideal punha a lista de "sim, nao" em cima da
    // coluna de data — depois disso o script não conseguia mais escrever a
    // data ali, e instalar() morria.
    var cols = cabecalho(nomeAba);
    if (!cols.length) return;

    // Limpa antes de aplicar: senão uma validação posta no lugar errado por
    // uma versão anterior fica lá para sempre.
    s.getRange(2, 1, 500, cols.length).clearDataValidations();

    Object.keys(opcoes[nomeAba]).forEach(function (campo) {
      var coluna = cols.indexOf(campo) + 1;
      if (coluna < 1) return;
      // setAllowInvalid(TRUE) de propósito.
      //
      // Com false, a planilha RECUSA a escrita e o script morre — foi o que
      // aconteceu quando uma regra caiu na coluna errada, e o erro apareceu
      // longe da causa. Com true a lista suspensa continua aparecendo para
      // quem edita à mão, um valor estranho ganha um aviso, e o script nunca
      // é bloqueado por causa de uma regra de interface.
      var regra = SpreadsheetApp.newDataValidation()
        .requireValueInList(opcoes[nomeAba][campo], true)
        .setAllowInvalid(true)
        .build();
      s.getRange(2, coluna, 500, 1).setDataValidation(regra);
    });
  });
}

/**
 * Remove ocorrências repetidas da mesma tarefa no mesmo dia.
 *
 * Existiu um período em que a data voltava da planilha como valor de data, e
 * não como texto: a chave anti-duplicata nunca batia e cada abertura do app
 * gerava o dia inteiro de novo. Isto limpa a bagunça sem perder o que foi
 * feito — entre as repetidas, fica a mais adiantada.
 */
function consertar() {
  // Primeiro os ids: o resto da função tem saídas antecipadas, e id repetido
  // é justamente o problema que faz uma tarefa sumir da tela dela.
  var idsTrocados = renomearIdsRepetidos();
  var sufixo = idsTrocados
    ? ' ' + idsTrocados + ' tarefa(s) com id repetido receberam id novo.' : '';

  var s = aba('Ocorrencias');
  var v = s.getDataRange().getValues();
  if (v.length < 2) return 'Nada a consertar: não há ocorrências.' + sufixo;

  var cab = v[0].map(function (c) { return String(c).trim(); });
  var iData = cab.indexOf('data');
  var iTarefa = cab.indexOf('tarefa_id');
  var iStatus = cab.indexOf('status');
  if (iData < 0 || iTarefa < 0 || iStatus < 0) {
    return 'A aba Ocorrencias está sem as colunas esperadas — rode instalar().';
  }

  var melhores = {};
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var chave = String(v[i][iTarefa]) + '|' + comoTexto(v[i][iData], 'dia');
    var peso = PESO_STATUS[String(v[i][iStatus]).trim()] || 0;
    if (!melhores[chave] || peso > melhores[chave].peso) {
      melhores[chave] = { peso: peso, linha: v[i] };
    }
  }

  var ficam = Object.keys(melhores).map(function (k) { return melhores[k].linha; });
  var removidas = (v.length - 1) - ficam.length;
  if (removidas <= 0) return 'Nada repetido: ' + ficam.length + ' ocorrências.' + sufixo;

  s.deleteRows(2, v.length - 1);
  delete _cache['Ocorrencias'];
  if (ficam.length) {
    s.getRange(2, 1, ficam.length, cab.length).setValues(ficam.map(function (l) {
      var linha = l.slice(0, cab.length);
      while (linha.length < cab.length) linha.push('');
      return linha;
    }));
  }

  var msg = removidas + ' repetidas removidas. Sobraram ' + ficam.length + '.' + sufixo;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/**
 * Dá id novo a tarefas que compartilham id.
 *
 * O gerador antigo de ids colidia, e duas tarefas com o mesmo id faziam a
 * segunda nunca gerar ocorrência — ela simplesmente não aparecia para ela.
 * As ocorrências antigas continuam apontando para a primeira; o histórico
 * fica um pouco impreciso, mas a tarefa volta a funcionar.
 */
function renomearIdsRepetidos() {
  var vistos = {};
  var trocados = 0;
  ler('Tarefas').forEach(function (t) {
    var id = String(t.id || '').trim();
    if (!id) return;
    if (vistos[id]) {
      escrever('Tarefas', t._linha, 'id', novoId('tf'));
      trocados++;
    } else {
      vistos[id] = true;
    }
  });
  if (trocados) marcarGeracaoVencida();
  return trocados;
}

/**
 * Rode isto se instalar() falhar: diz exatamente o que o script está enxergando.
 * O resultado aparece no registro de execução (Ctrl+Enter no editor).
 */
function diagnostico() {
  var linhas = ['Versão do script: ' + VERSAO];
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

    if (!faltando.length) {
      var ocs = ler('Ocorrencias');
      var vistas = {};
      var repetidas = 0;
      ocs.forEach(function (o) {
        var chave = o.tarefa_id + '|' + o.data;
        if (vistas[chave]) repetidas++; else vistas[chave] = true;
      });
      linhas.push('Ocorrências: ' + ocs.length +
        (repetidas ? ' (' + repetidas + ' repetidas — rode Consertar)' : ' (sem repetidas)'));

      var idsTarefa = ler('Tarefas').map(function (t) { return String(t.id); });
      var idsUnicos = {};
      var colididos = 0;
      idsTarefa.forEach(function (id) {
        if (idsUnicos[id]) colididos++; else idsUnicos[id] = true;
      });
      if (colididos) {
        linhas.push(colididos + ' tarefa(s) com id repetido — rode Consertar. ' +
          'Tarefa com id repetido não aparece para ela.');
      }
      var hoje = hojeLocal(config());
      var deHoje = ocs.filter(function (o) { return o.data === hoje; }).length;
      linhas.push('De hoje (' + hoje + '): ' + deHoje +
        (deHoje ? '' : ' — é por isso que não aparece nada para ela'));
    }
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
      .addItem('Consertar ocorrências repetidas', 'consertar')
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
