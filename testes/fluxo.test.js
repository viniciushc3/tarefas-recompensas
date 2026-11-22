// Fluxo completo contra o Codigo.gs real, com planilha em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente } = require('./apps-script-falso');

function montar() {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  return { api, cfg, hoje: api.hojeLocal(cfg) };
}

function estado(api, codigo, acoes = []) {
  const r = api.chamar({ codigo, acoes });
  assert.equal(r.ok, true, 'resposta não ok: ' + r.erro);
  return r;
}

test('instalar() cria todas as abas e semeia o conteúdo', () => {
  const { api, cfg } = montar();
  Object.keys(api.ABAS).forEach(nome => {
    assert.ok(api._ambiente._abas.has(nome), 'falta a aba ' + nome);
  });
  assert.equal(api.ler('Tarefas').length, 11);
  assert.equal(api.ler('Recompensas').length, 8);
  assert.equal(api.ler('Faixas').length, 4);
  assert.match(cfg.codigoPai, /^[A-Z2-9]{8}$/);
  assert.match(cfg.codigoFilha, /^[A-Z2-9]{8}$/);
  assert.notEqual(cfg.codigoPai, cfg.codigoFilha, 'os dois códigos não podem ser iguais');
});

test('instalar() duas vezes não duplica nada', () => {
  const { api } = montar();
  api.instalar();
  assert.equal(api.ler('Tarefas').length, 11);
  assert.equal(api.ler('Faixas').length, 4);
});

test('sem código, nada acontece', () => {
  const { api } = montar();
  assert.equal(api.chamar({ codigo: '', acoes: [] }).erro, 'codigo');
  assert.equal(api.chamar({ codigo: 'XXXXXX', acoes: [] }).erro, 'codigo');
});

test('o papel vem do código, conferido no servidor', () => {
  const { api, cfg } = montar();
  assert.equal(estado(api, cfg.codigoPai).papel, 'pai');
  assert.equal(estado(api, cfg.codigoFilha).papel, 'filha');
});

test('geração do dia é idempotente', () => {
  const { api, cfg, hoje } = montar();
  estado(api, cfg.codigoFilha);
  const antes = api.ler('Ocorrencias').length;
  estado(api, cfg.codigoFilha);
  assert.equal(api.ler('Ocorrencias').length, antes, 'gerou de novo');
  assert.ok(antes > 0);
  assert.ok(api.ler('Ocorrencias').every(o => String(o.data) <= hoje));
});

test('tarefa básica aprova direto e não lança pontos', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const basica = e.ocorrencias.find(o => o.data === e.hoje && o.pontos === 0);
  const r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: basica.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.equal(r.resultados[0].dados.status, 'aprovada');
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 }, 'dever não paga pontos');
});

test('extra sem aprovação credita 70/30 na hora', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const extra = e.ocorrencias.find(o =>
    o.data === e.hoje && o.pontos === 20 && !o.precisa_aprovacao);
  const r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: extra.id, ref: 0 }]);
  assert.equal(r.resultados[0].dados.status, 'aprovada');
  assert.deepEqual(r.saldo, { gastavel: 14, cofrinho: 6 }, '20 pontos -> 14 + 6');
});

test('extra com aprovação espera, e só credita depois do pai', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const comAprovacao = e.ocorrencias.find(o =>
    o.data === e.hoje && o.precisa_aprovacao && o.pontos === 30);

  let r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: comAprovacao.id, ref: 0 }]);
  assert.equal(r.resultados[0].dados.status, 'marcada');
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 }, 'não pode creditar antes');

  r = estado(api, cfg.codigoPai, [{ acao: 'decidir', id: comAprovacao.id, aprovar: true, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.deepEqual(r.saldo, { gastavel: 21, cofrinho: 9 }, '30 pontos -> 21 + 9');
});

test('a filha não aprova nada', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.precisa_aprovacao);
  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);

  const r = estado(api, cfg.codigoFilha, [{ acao: 'decidir', id: oc.id, aprovar: true, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /responsável/);
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 }, 'não creditou');
});

test('a filha não ajusta pontos nem fecha semana', () => {
  const { api, cfg } = montar();
  const r = estado(api, cfg.codigoFilha, [
    { acao: 'ajustar', gastavel: 9999, cofrinho: 0, motivo: 'hehe', ref: 0 },
    { acao: 'fecharSemana', ref: 1 },
    { acao: 'pagarSemana', semana: '2026-01-05', ref: 2 },
  ]);
  r.resultados.forEach(x => {
    assert.equal(x.ok, false);
    assert.match(x.erro, /responsável/);
  });
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 });
});

test('aprovar duas vezes não paga duas vezes', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.precisa_aprovacao && o.pontos === 30);
  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  estado(api, cfg.codigoPai, [{ acao: 'decidir', id: oc.id, aprovar: true, ref: 0 }]);

  const r = estado(api, cfg.codigoPai, [{ acao: 'decidir', id: oc.id, aprovar: true, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false, 'deveria recusar a segunda decisão');
  assert.deepEqual(r.saldo, { gastavel: 21, cofrinho: 9 }, 'saldo dobrou');
  const ganhos = api.ler('Extrato').filter(x => x.tipo === 'ganho' && x.ref === oc.id);
  assert.equal(ganhos.length, 1, 'lançou duas vezes');
});

test('marcar a mesma tarefa duas vezes é recusado', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.pontos === 20 && !o.precisa_aprovacao);
  // A página offline pode enfileirar a mesma ação duas vezes.
  const r = estado(api, cfg.codigoFilha, [
    { acao: 'marcar', id: oc.id, ref: 0 },
    { acao: 'marcar', id: oc.id, ref: 1 },
  ]);
  assert.equal(r.resultados[0].ok, true);
  assert.equal(r.resultados[1].ok, false, 'a segunda deveria falhar');
  assert.deepEqual(r.saldo, { gastavel: 14, cofrinho: 6 }, 'creditou duas vezes');
});

test('resgate reserva na hora e devolve na recusa', () => {
  const { api, cfg } = montar();
  let e = estado(api, cfg.codigoFilha);
  // junta pontos: marca todas as extras sem aprovação de hoje
  const extras = e.ocorrencias.filter(o =>
    o.data === e.hoje && o.pontos > 0 && !o.precisa_aprovacao);
  e = estado(api, cfg.codigoFilha, extras.map((o, i) => ({ acao: 'marcar', id: o.id, ref: i })));
  const antes = e.saldo.gastavel;
  assert.ok(antes >= 30, 'precisa de saldo para o teste, tem ' + antes);

  const tela = e.recompensas.find(r => r.custo === 30 && r.tipo === 'tela');
  e = estado(api, cfg.codigoFilha, [{ acao: 'pedir', id: tela.id, ref: 0 }]);
  assert.equal(e.resultados[0].ok, true, e.resultados[0].erro);
  assert.equal(e.saldo.gastavel, antes - 30, 'a reserva não debitou');

  const rg = e.resgates.find(r => r.status === 'pedido');
  e = estado(api, cfg.codigoPai, [{ acao: 'decidirResgate', id: rg.id, aprovar: false, ref: 0 }]);
  assert.equal(e.saldo.gastavel, antes, 'não devolveu os pontos');
});

test('resgate sem saldo é recusado com a diferença na mensagem', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const meta = e.recompensas.find(r => r.tipo === 'meta');
  const r = estado(api, cfg.codigoFilha, [{ acao: 'pedir', id: meta.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /faltam 4000 pontos no cofrinho/);
});

test('entregar só vale depois de aprovar', () => {
  const { api, cfg } = montar();
  let e = estado(api, cfg.codigoFilha);
  const extras = e.ocorrencias.filter(o => o.data === e.hoje && o.pontos > 0 && !o.precisa_aprovacao);
  e = estado(api, cfg.codigoFilha, extras.map((o, i) => ({ acao: 'marcar', id: o.id, ref: i })));
  const tela = e.recompensas.find(r => r.custo === 30);
  e = estado(api, cfg.codigoFilha, [{ acao: 'pedir', id: tela.id, ref: 0 }]);
  const rg = e.resgates.find(r => r.status === 'pedido');

  let r = estado(api, cfg.codigoPai, [{ acao: 'entregue', id: rg.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false, 'entregou sem aprovar');

  estado(api, cfg.codigoPai, [{ acao: 'decidirResgate', id: rg.id, aprovar: true, ref: 0 }]);
  r = estado(api, cfg.codigoPai, [{ acao: 'entregue', id: rg.id, ref: 0 }]);
  assert.equal(r.resultados[0].dados.status, 'entregue');
});

test('ajuste exige motivo e entra como lançamento novo', () => {
  const { api, cfg } = montar();
  let r = estado(api, cfg.codigoPai, [
    { acao: 'ajustar', gastavel: 10, cofrinho: 0, motivo: '   ', ref: 0 },
    { acao: 'ajustar', gastavel: 0, cofrinho: 0, motivo: 'nada', ref: 1 },
  ]);
  assert.match(r.resultados[0].erro, /motivo/);
  assert.match(r.resultados[1].erro, /vazio/);

  r = estado(api, cfg.codigoPai, [
    { acao: 'ajustar', gastavel: -5, cofrinho: 3, motivo: 'Corrigindo lançamento', ref: 0 },
  ]);
  assert.equal(r.resultados[0].ok, true);
  assert.deepEqual(r.saldo, { gastavel: -5, cofrinho: 3 });
  assert.equal(api.ler('Extrato').filter(e => e.tipo === 'ajuste').length, 1);
});

test('fechar a semana usa a faixa certa e o piso nunca é zero', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const r = estado(api, cfg.codigoPai, [{ acao: 'fecharSemana', semana: e.semana, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.ok(r.resultados[0].dados.valor >= 5, 'piso da mesada não aplicado');
  assert.equal(api.ler('Semanas').length, 1);

  // recalcular não duplica a linha
  estado(api, cfg.codigoPai, [{ acao: 'fecharSemana', semana: e.semana, ref: 0 }]);
  assert.equal(api.ler('Semanas').length, 1);
});

test('semana paga não é recalculada', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  estado(api, cfg.codigoPai, [{ acao: 'fecharSemana', semana: e.semana, ref: 0 }]);
  estado(api, cfg.codigoPai, [{ acao: 'pagarSemana', semana: e.semana, ref: 0 }]);

  const r = estado(api, cfg.codigoPai, [{ acao: 'fecharSemana', semana: e.semana, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /já foi paga/);
});

test('tarefa de dia futuro não é marcável', () => {
  const { api, cfg, hoje } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === hoje);
  // empurra a ocorrência para amanhã direto na planilha
  const linha = api.ler('Ocorrencias').find(x => x.id === oc.id);
  api.escrever('Ocorrencias', linha._linha, 'data', api.somarDias(hoje, 1));

  const r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /ainda não é o dia/);
});

test('ação desconhecida não derruba as outras', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.pontos === 20 && !o.precisa_aprovacao);
  const r = estado(api, cfg.codigoFilha, [
    { acao: 'apagarTudo', ref: 0 },
    { acao: 'marcar', id: oc.id, ref: 1 },
  ]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /desconhecida/);
  assert.equal(r.resultados[1].ok, true, 'a ação válida deveria ter passado');
});

test('a filha não recebe o link da planilha', () => {
  const { api, cfg } = montar();
  assert.equal(estado(api, cfg.codigoFilha).planilha, '');
  assert.match(estado(api, cfg.codigoPai).planilha, /spreadsheets/);
});

test('instalar não inventa dias anteriores à planilha', () => {
  const { api, cfg, hoje } = montar();
  estado(api, cfg.codigoFilha);   // dispara o catch-up de 14 dias
  const ocs = api.ler('Ocorrencias');
  assert.ok(ocs.length > 0);
  // Tudo de hoje: nada de dias antes de a tarefa existir.
  assert.deepEqual([...new Set(ocs.map(o => String(o.data)))], [hoje]);
  assert.equal(ocs.filter(o => o.status === 'expirada').length, 0);
});

test('a primeira semana não começa parecendo fracasso', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  // Nada feito ainda, mas o denominador é só o dia de hoje — não 14 dias
  // retroativos que ela nunca teve chance de cumprir.
  assert.ok(e.resumoSemana.elegiveis <= 11,
    'denominador inflado: ' + e.resumoSemana.elegiveis);
  assert.equal(e.resumoSemana.aprovadas, 0);
  assert.equal(e.resumoSemana.emAberto, e.resumoSemana.elegiveis);
});

test('instalar funciona mesmo com getSheetByName quebrado', () => {
  // Regressão: em produção, numa planilha recém-criada, getSheetByName()
  // estourou "Planilha 0 não encontrada" e instalar() morria na primeira aba.
  // A planilha de mentira faz esse método sempre estourar; se o código voltar
  // a usá-lo, este teste cai.
  const api = criarAmbiente();
  assert.throws(() => api._ambiente.SpreadsheetApp.getActive().getSheetByName('Config'),
    /Planilha 0 não encontrada/, 'a planilha falsa deveria estourar');
  api.instalar();
  Object.keys(api.ABAS).forEach(nome => {
    assert.ok(api._ambiente._abas.has(nome), 'falta a aba ' + nome);
  });
});

test('instalar remove a aba padrão vazia e não toca em aba com conteúdo', () => {
  const api = criarAmbiente();
  api.instalar();
  assert.equal(api._ambiente._abas.has('Página1'), false, 'a aba padrão vazia deveria sumir');

  const outra = criarAmbiente();
  outra._ambiente._abas.get('Página1').appendRow(['anotação importante']);
  outra.instalar();
  assert.equal(outra._ambiente._abas.has('Página1'), true,
    'não pode apagar aba com conteúdo');
});

test('diagnóstico lista o que o script enxerga', () => {
  const api = criarAmbiente();
  const antes = api.diagnostico();
  assert.match(antes, /Planilha sem título/);
  assert.match(antes, /Faltam: /, 'antes de instalar, deveria listar o que falta');
  api.instalar();
  assert.match(api.diagnostico(), /Todas as abas existem/);
});

test('linha digitada à mão só precisa do título', () => {
  const { api, cfg, hoje } = montar();
  // Como você criaria uma tarefa: escrever o título e fechar a planilha.
  api.anexar('Tarefas', { titulo: 'Passear com o cachorro', icone: '🐕', pontos: 25 });

  estado(api, cfg.codigoFilha);   // abrir o app normaliza e gera

  const nova = api.ler('Tarefas').find(t => t.titulo === 'Passear com o cachorro');
  assert.ok(String(nova.id).startsWith('tf-'), 'não gerou id');
  assert.equal(String(nova.criada_em), hoje, 'criada_em deveria ser hoje');
  assert.equal(nova.tipo, 'extra');
  assert.equal(nova.recorrencia, 'diaria');
  assert.equal(nova.conta_mesada, 'sim', 'em branco não pode virar "fora da mesada"');
  assert.equal(nova.ativa, 'sim');

  const ocs = api.ler('Ocorrencias').filter(o => o.titulo === 'Passear com o cachorro');
  assert.equal(ocs.length, 1, 'deveria gerar só hoje, não os 14 dias anteriores');
  assert.equal(String(ocs[0].data), hoje);
  assert.equal(Number(ocs[0].pontos), 25);
});

test('tarefa nova sem id não colide com outra sem id', () => {
  const { api, cfg } = montar();
  api.anexar('Tarefas', { titulo: 'Varrer a área', pontos: 10 });
  api.anexar('Tarefas', { titulo: 'Dobrar a roupa', pontos: 10 });
  estado(api, cfg.codigoFilha);

  const ids = api.ler('Tarefas').map(t => String(t.id));
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  const titulos = api.ler('Ocorrencias').map(o => o.titulo);
  assert.ok(titulos.includes('Varrer a área'));
  assert.ok(titulos.includes('Dobrar a roupa'));
});

test('recompensa digitada à mão também se completa', () => {
  const { api, cfg } = montar();
  api.anexar('Recompensas', { titulo: 'Sorvete no domingo', icone: '🍦', custo: 200 });
  const e = estado(api, cfg.codigoFilha);

  const nova = api.ler('Recompensas').find(r => r.titulo === 'Sorvete no domingo');
  assert.ok(String(nova.id).startsWith('rc-'));
  assert.equal(nova.tipo, 'privilegio');
  assert.equal(nova.bolso, 'gastavel');
  assert.ok(e.recompensas.some(r => r.titulo === 'Sorvete no domingo'),
    'deveria aparecer na loja dela');
});

test('instalar põe listas suspensas nas colunas de escolha', () => {
  const { api } = montar();
  const tarefas = api._ambiente._abas.get('Tarefas');
  const campos = api.ABAS.Tarefas;
  const colunasComLista = tarefas._validacoes.map(v => campos[v.c - 1]);
  ['tipo', 'periodo', 'recorrencia', 'precisa_aprovacao', 'conta_mesada', 'ativa']
    .forEach(c => assert.ok(colunasComLista.includes(c), 'falta lista em ' + c));
  const recorrencia = tarefas._validacoes.find(v => campos[v.c - 1] === 'recorrencia');
  assert.deepEqual(recorrencia.regra.valores,
    ['diaria', 'semana', 'fimdesemana', 'dias', 'avulsa']);
});

// ----------------------------------------------------- editar pelo app
test('o pai cria tarefa pelo app e ela nasce hoje', () => {
  const { api, cfg, hoje } = montar();
  const r = estado(api, cfg.codigoPai, [{
    acao: 'salvarTarefa', ref: 0,
    tarefa: { titulo: 'Passear com o cachorro', icone: '🐕', tipo: 'extra', pontos: 25,
              periodo: 'tarde', recorrencia: 'diaria', precisa_aprovacao: false,
              conta_mesada: true, ativa: true },
  }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.equal(r.resultados[0].dados.novo, true);

  const t = api.ler('Tarefas').find(x => x.titulo === 'Passear com o cachorro');
  assert.equal(String(t.criada_em), hoje, 'tem de nascer hoje, não retroativa');
  assert.equal(t.periodo, 'tarde');

  const ocs = api.ler('Ocorrencias').filter(o => o.titulo === 'Passear com o cachorro');
  assert.equal(ocs.length, 1);
  assert.equal(String(ocs[0].data), hoje);
});

test('editar tarefa não duplica nem reescreve o histórico', () => {
  const { api, cfg } = montar();
  let e = estado(api, cfg.codigoPai);
  const antes = api.ler('Tarefas').length;
  const alvo = e.tarefas.find(t => t.titulo === 'Tirar o lixo');

  // marca hoje pelos 20 pontos originais
  const oc = e.ocorrencias.find(o => o.titulo === 'Tirar o lixo' && o.data === e.hoje);
  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);

  // agora muda o preço
  e = estado(api, cfg.codigoPai, [{
    acao: 'salvarTarefa', ref: 0,
    tarefa: { ...alvo, titulo: 'Tirar o lixo e reciclar', pontos: 35 },
  }]);
  assert.equal(e.resultados[0].dados.novo, false);
  assert.equal(api.ler('Tarefas').length, antes, 'duplicou a tarefa');

  const guardada = api.ler('Ocorrencias').find(o => o.id === oc.id);
  assert.equal(guardada.titulo, 'Tirar o lixo', 'o snapshot de ontem mudou');
  assert.equal(Number(guardada.pontos), 20, 'o preço do histórico mudou');
  assert.deepEqual(e.saldo, { gastavel: 14, cofrinho: 6 }, 'o crédito já dado mudou');
});

test('a filha não cria nem edita nada', () => {
  const { api, cfg } = montar();
  const antes = api.ler('Tarefas').length;
  const r = estado(api, cfg.codigoFilha, [
    { acao: 'salvarTarefa', tarefa: { titulo: 'Ganhar 1000 pontos', pontos: 1000 }, ref: 0 },
    { acao: 'salvarRecompensa', recompensa: { titulo: 'Tela infinita', custo: 1 }, ref: 1 },
  ]);
  r.resultados.forEach(x => {
    assert.equal(x.ok, false);
    assert.match(x.erro, /responsável/);
  });
  assert.equal(api.ler('Tarefas').length, antes);
});

test('a filha não recebe as listas de edição', () => {
  const { api, cfg } = montar();
  const dela = estado(api, cfg.codigoFilha);
  assert.deepEqual(dela.tarefas, []);
  assert.deepEqual(dela.catalogo, []);
  assert.ok(estado(api, cfg.codigoPai).tarefas.length > 0);
});

test('validações do formulário também valem no servidor', () => {
  const { api, cfg } = montar();
  const r = estado(api, cfg.codigoPai, [
    { acao: 'salvarTarefa', tarefa: { titulo: '   ' }, ref: 0 },
    { acao: 'salvarTarefa', tarefa: { titulo: 'X', recorrencia: 'dias', dias: '' }, ref: 1 },
    { acao: 'salvarTarefa', tarefa: { titulo: 'X', recorrencia: 'avulsa', dias: 'amanhã' }, ref: 2 },
    { acao: 'salvarRecompensa', recompensa: { titulo: 'X', custo: 0 }, ref: 3 },
    { acao: 'salvarRecompensa', recompensa: { titulo: 'X', custo: 10, tipo: 'tela', minutos: 0 }, ref: 4 },
  ]);
  assert.match(r.resultados[0].erro, /nome/);
  assert.match(r.resultados[1].erro, /dia da semana/);
  assert.match(r.resultados[2].erro, /AAAA-MM-DD/);
  assert.match(r.resultados[3].erro, /maior que zero/);
  assert.match(r.resultados[4].erro, /minutos/);
});

test('meta grande é forçada para o cofrinho', () => {
  const { api, cfg } = montar();
  // mesmo pedindo gastável de propósito
  estado(api, cfg.codigoPai, [{
    acao: 'salvarRecompensa', ref: 0,
    recompensa: { titulo: 'Patinete', tipo: 'meta', bolso: 'gastavel', custo: 3000 },
  }]);
  const r = api.ler('Recompensas').find(x => x.titulo === 'Patinete');
  assert.equal(r.bolso, 'cofrinho', 'meta não pode sair do saldo gastável');
});

test('desativar tarefa para de gerar mas mantém o histórico', () => {
  const { api, cfg } = montar();
  let e = estado(api, cfg.codigoPai);
  const alvo = e.tarefas.find(t => t.titulo === 'Pôr a mesa');
  const antes = api.ler('Ocorrencias').filter(o => o.titulo === 'Pôr a mesa').length;
  assert.ok(antes > 0);

  estado(api, cfg.codigoPai, [{
    acao: 'salvarTarefa', tarefa: { ...alvo, ativa: false }, ref: 0,
  }]);
  const depois = api.ler('Ocorrencias').filter(o => o.titulo === 'Pôr a mesa').length;
  assert.equal(depois, antes, 'o histórico sumiu');

  e = estado(api, cfg.codigoPai);
  assert.equal(e.tarefas.find(t => t.id === alvo.id).ativa, false);
});

// ------------------------------------------------- os dois bugs de produção
test('a planilha guarda data como Date, e o código lida com isso', () => {
  const { api, cfg, hoje } = montar();
  estado(api, cfg.codigoFilha);

  // A célula crua é mesmo um Date — se um dia o Sheets parar de converter,
  // este teste avisa que a defesa virou desnecessária.
  const aba = api._ambiente._abas.get('Ocorrencias');
  const colData = api.ABAS.Ocorrencias.indexOf('data');
  assert.ok(aba._linhas[1][colData] instanceof Date,
    'a planilha falsa deveria estar guardando Date');

  // E mesmo assim a leitura devolve texto comparável.
  const o = api.ler('Ocorrencias')[0];
  assert.equal(typeof o.data, 'string');
  assert.match(o.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(o.data, hoje, 'o dia voltou trocado');

  // E o estado que vai para a tela também.
  const e = estado(api, cfg.codigoFilha);
  assert.ok(e.ocorrencias.length > 0);
  assert.ok(e.ocorrencias.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.data)),
    'alguma ocorrência foi para a tela com data que não é texto');
  assert.ok(e.ocorrencias.some(x => x.data === e.hoje),
    'nenhuma tarefa de hoje — é exatamente o sintoma de "não aparece nada para ela"');
});

test('planilha criada por versão antiga ganha as colunas que faltam', () => {
  const { criarAmbiente } = require('./apps-script-falso');
  const api = criarAmbiente();
  const planilha = api._ambiente.SpreadsheetApp.getActive();

  // Como era antes: Ocorrencias sem 'periodo', Tarefas sem 'criada_em'.
  const antigoOc = api.ABAS.Ocorrencias.filter(c => c !== 'periodo');
  const antigoTf = api.ABAS.Tarefas.filter(c => c !== 'criada_em');
  planilha.insertSheet('Ocorrencias')
    .getRange(1, 1, 1, antigoOc.length).setValues([antigoOc]);
  planilha.insertSheet('Tarefas')
    .getRange(1, 1, 1, antigoTf.length).setValues([antigoTf]);

  api.instalar();

  const cab = n => api._ambiente._abas.get(n)._linhas[0].map(String);
  assert.ok(cab('Ocorrencias').includes('periodo'), 'não acrescentou periodo');
  assert.ok(cab('Tarefas').includes('criada_em'), 'não acrescentou criada_em');
  // As colunas antigas não podem ter mudado de lugar: os dados ficariam tortos.
  assert.deepEqual(cab('Ocorrencias').slice(0, antigoOc.length), antigoOc);
  assert.deepEqual(cab('Tarefas').slice(0, antigoTf.length), antigoTf);

  // E depois do conserto tudo funciona.
  const cfg = api.config();
  const e = estado(api, cfg.codigoFilha);
  assert.ok(e.ocorrencias.some(o => o.data === e.hoje), 'continuou sem tarefas de hoje');
  assert.ok(e.ocorrencias.every(o => o.periodo), 'ocorrência sem periodo');
});

test('escrever usa o cabeçalho real, não a ordem de ABAS', () => {
  const { criarAmbiente } = require('./apps-script-falso');
  const api = criarAmbiente();
  const planilha = api._ambiente.SpreadsheetApp.getActive();
  // Cabeçalho na ordem trocada, como ficaria depois de um conserto.
  const trocado = api.ABAS.Tarefas.filter(c => c !== 'criada_em').concat('criada_em');
  planilha.insertSheet('Tarefas').getRange(1, 1, 1, trocado.length).setValues([trocado]);
  api.instalar();

  const cfg = api.config();
  const antes = api.ler('Tarefas')[0];
  api.escrever('Tarefas', antes._linha, 'pontos', 77);
  const depois = api.ler('Tarefas')[0];
  assert.equal(Number(depois.pontos), 77, 'escreveu na coluna errada');
  assert.equal(depois.titulo, antes.titulo, 'atropelou outra coluna');
});

test('consertar() limpa ocorrências repetidas e guarda a mais adiantada', () => {
  const { api, cfg, hoje } = montar();
  estado(api, cfg.codigoFilha);
  const originais = api.ler('Ocorrencias');
  assert.ok(originais.length > 0);

  // Reproduz a bagunça: o gerador rodando de novo sem reconhecer o que já existe.
  const uma = originais[0];
  for (let i = 0; i < 3; i++) {
    api.anexar('Ocorrencias', {
      id: 'dup-' + i, data: hoje, tarefa_id: uma.tarefa_id, titulo: uma.titulo,
      icone: uma.icone, pontos: uma.pontos, tipo: uma.tipo, periodo: uma.periodo,
      conta_mesada: 'sim', precisa_aprovacao: 'nao', status: 'pendente',
    });
  }
  // uma das cópias está aprovada: é essa que tem de sobreviver
  const copias = api.ler('Ocorrencias').filter(o => o.tarefa_id === uma.tarefa_id);
  api.escrever('Ocorrencias', copias[copias.length - 1]._linha, 'status', 'aprovada');

  assert.match(api.diagnostico(), /repetidas — rode Consertar/);
  const msg = api.consertar();
  assert.match(msg, /3 repetidas removidas/);

  const depois = api.ler('Ocorrencias').filter(o => o.tarefa_id === uma.tarefa_id);
  assert.equal(depois.length, 1, 'sobrou mais de uma');
  assert.equal(depois[0].status, 'aprovada', 'jogou fora a que estava feita');
  assert.equal(api.ler('Ocorrencias').length, originais.length);
  assert.match(api.diagnostico(), /sem repetidas/);
});

test('diagnóstico aponta o dia vazio, que é o sintoma reclamado', () => {
  const { api, cfg } = montar();
  estado(api, cfg.codigoFilha);
  assert.match(api.diagnostico(), /De hoje \(\d{4}-\d{2}-\d{2}\): [1-9]/);
});

// ----------------------------------------------------------- desmarcar
function marcarTudoDeHoje(api, cfg) {
  const e = estado(api, cfg.codigoFilha);
  const alvos = e.ocorrencias.filter(o => o.data === e.hoje && o.status === 'pendente');
  return estado(api, cfg.codigoFilha, alvos.map((o, i) => ({ acao: 'marcar', id: o.id, ref: i })));
}

test('desmarcar devolve exatamente os pontos que a tarefa pagou', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.pontos === 20 && !o.precisa_aprovacao);

  let r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  assert.deepEqual(r.saldo, { gastavel: 14, cofrinho: 6 });

  r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 }, 'não devolveu');
  assert.equal(r.ocorrencias.find(o => o.id === oc.id).status, 'pendente');
});

test('remarcar depois de desmarcar paga de novo', () => {
  // A trava de crédito duplo olhava "existe ganho?". Como o extrato só cresce,
  // o ganho estornado continuava lá e a segunda marcação não pagaria nada.
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.pontos === 20 && !o.precisa_aprovacao);

  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: oc.id, ref: 0 }]);
  const r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);

  assert.deepEqual(r.saldo, { gastavel: 14, cofrinho: 6 }, 'a remarcação não pagou');
  // E não pagou duas vezes.
  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  assert.deepEqual(estado(api, cfg.codigoFilha).saldo, { gastavel: 14, cofrinho: 6 });
});

test('desmarcar tarefa que espera aprovação não mexe em saldo', () => {
  const { api, cfg } = montar();
  const e = estado(api, cfg.codigoFilha);
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.precisa_aprovacao);

  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  const r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.deepEqual(r.saldo, { gastavel: 0, cofrinho: 0 });
  assert.equal(r.ocorrencias.find(o => o.id === oc.id).status, 'pendente');
  // e some da fila do pai
  assert.equal(estado(api, cfg.codigoPai).ocorrencias
    .filter(o => o.status === 'marcada').length, 0);
});

test('não dá para desmarcar pontos que já foram gastos', () => {
  const { api, cfg } = montar();
  let e = marcarTudoDeHoje(api, cfg);
  const gastavelAntes = e.saldo.gastavel;
  assert.ok(gastavelAntes >= 30);

  const tela = e.recompensas.find(r => r.custo === 30 && r.tipo === 'tela');
  e = estado(api, cfg.codigoFilha, [{ acao: 'pedir', id: tela.id, ref: 0 }]);

  // tenta desfazer tarefas até o saldo não cobrir mais
  const feitas = e.ocorrencias.filter(o => o.status === 'aprovada' && o.pontos > 0);
  let recusou = false;
  feitas.forEach((o, i) => {
    const r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: o.id, ref: i }]);
    if (!r.resultados[0].ok) {
      assert.match(r.resultados[0].erro, /já gastou/);
      recusou = true;
    }
  });
  assert.ok(recusou, 'deixou o saldo ficar negativo');
  assert.ok(estado(api, cfg.codigoFilha).saldo.gastavel >= 0, 'saldo negativo');
});

test('desmarcar o que não está marcado, ou fora do prazo, é recusado', () => {
  const { api, cfg, hoje } = montar();
  const e = estado(api, cfg.codigoFilha);
  const pendente = e.ocorrencias.find(o => o.status === 'pendente');

  let r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: pendente.id, ref: 0 }]);
  assert.match(r.resultados[0].erro, /não está marcada/);

  // marca e joga para fora da janela
  estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: pendente.id, ref: 0 }]);
  const linha = api.ler('Ocorrencias').find(x => x.id === pendente.id);
  api.escrever('Ocorrencias', linha._linha, 'data', api.somarDias(hoje, -5));

  r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: pendente.id, ref: 0 }]);
  assert.match(r.resultados[0].erro, /prazo/);
});

test('desmarcar tira do percentual da semana', () => {
  const { api, cfg } = montar();
  const antes = estado(api, cfg.codigoFilha).resumoSemana;
  const e = marcarTudoDeHoje(api, cfg);
  assert.ok(e.resumoSemana.aprovadas > antes.aprovadas);

  const feita = e.ocorrencias.find(o => o.status === 'aprovada' && o.conta_mesada);
  const r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: feita.id, ref: 0 }]);
  assert.equal(r.resumoSemana.aprovadas, e.resumoSemana.aprovadas - 1);
});

test('ids não colidem, nem gerados em rajada', () => {
  // Regressão: o id era milissegundo + aleatório de 1296 valores. instalar()
  // cria 19 linhas e garantirDias() até 165, tudo no mesmo milissegundo, e
  // duas colidiam. O sintoma era uma tarefa que simplesmente nunca aparecia.
  const { api, cfg } = montar();
  estado(api, cfg.codigoFilha);

  const confere = (rotulo, ids) => {
    assert.equal(new Set(ids).size, ids.length,
      rotulo + ': ' + (ids.length - new Set(ids).size) + ' id(s) repetido(s)');
  };
  confere('Tarefas', api.ler('Tarefas').map(t => String(t.id)));
  confere('Recompensas', api.ler('Recompensas').map(r => String(r.id)));
  confere('Ocorrencias', api.ler('Ocorrencias').map(o => String(o.id)));

  // E toda tarefa ativa de hoje virou exatamente uma ocorrência.
  const e = estado(api, cfg.codigoFilha);
  const porTarefa = {};
  e.ocorrencias.filter(o => o.data === e.hoje).forEach(o => {
    porTarefa[o.titulo] = (porTarefa[o.titulo] || 0) + 1;
  });
  Object.keys(porTarefa).forEach(t => assert.equal(porTarefa[t], 1, t + ' duplicou'));
});

test('mil ids seguidos são todos diferentes', () => {
  const api = criarAmbiente();
  api.instalar();
  const ids = [];
  for (let i = 0; i < 1000; i++) ids.push(api.novoId('x'));
  assert.equal(new Set(ids).size, 1000);
});

test('consertar devolve id próprio a tarefa que perdeu o dela', () => {
  const { api, cfg } = montar();
  const tarefas = api.ler('Tarefas');
  // Força a colisão que o gerador antigo produzia.
  api.escrever('Tarefas', tarefas[1]._linha, 'id', String(tarefas[0].id));

  assert.match(api.diagnostico(), /id repetido/);
  assert.match(api.consertar(), /id repetido receberam id novo/);

  const ids = api.ler('Tarefas').map(t => String(t.id));
  assert.equal(new Set(ids).size, ids.length);

  // E a tarefa que estava invisível volta a gerar ocorrência.
  const e = estado(api, cfg.codigoFilha);
  const titulo = tarefas[1].titulo;
  assert.ok(e.ocorrencias.some(o => o.titulo === titulo && o.data === e.hoje),
    'a tarefa continuou sem aparecer: ' + titulo);
});

// --------------------------------------------------------------- fotos
const UMA_FOTO = Buffer.from('foto de mentira').toString('base64');

function tarefaComFoto(api, cfg) {
  const e = estado(api, cfg.codigoPai);
  return e.ocorrencias.find(o => o.data === e.hoje && o.precisa_foto);
}

test('tarefa que pede foto não é marcada sem foto', () => {
  const { api, cfg } = montar();
  const oc = tarefaComFoto(api, cfg);
  assert.ok(oc, 'o conteúdo inicial deveria ter uma tarefa com foto');

  const r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /precisa de foto/);
});

test('enviar a foto e marcar, na mesma ida', () => {
  const { api, cfg } = montar();
  const oc = tarefaComFoto(api, cfg);

  const r = estado(api, cfg.codigoFilha, [
    { acao: 'enviarFoto', id: oc.id, dados: UMA_FOTO, mime: 'image/jpeg', ref: 0 },
    { acao: 'marcar', id: oc.id, ref: 1 },
  ]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.equal(r.resultados[1].ok, true, r.resultados[1].erro);

  const depois = r.ocorrencias.find(o => o.id === oc.id);
  assert.equal(depois.status, 'marcada', 'foto implica aprovação');
  assert.ok(depois.foto, 'a ocorrência ficou sem referência de foto');

  // e a imagem volta
  const leitura = estado(api, cfg.codigoPai, [{ acao: 'foto', foto: depois.foto, ref: 0 }]);
  assert.equal(leitura.resultados[0].ok, true, leitura.resultados[0].erro);
  assert.equal(leitura.resultados[0].dados.dados, UMA_FOTO, 'voltou outra imagem');
  assert.match(leitura.resultados[0].dados.mime, /^image\//);
});

test('não dá para pedir um arquivo qualquer do Drive', () => {
  // Sem esta checagem, quem tivesse um código poderia ler QUALQUER arquivo do
  // Drive de quem publicou o script, porque o script roda como essa pessoa.
  const { api, cfg } = montar();
  const drive = api._ambiente.DriveApp;
  const alheio = drive.createFolder().createFile(
    api._ambiente.Utilities.newBlob(Buffer.from('imposto de renda'), 'application/pdf', 'x.pdf'));

  const r = estado(api, cfg.codigoFilha, [{ acao: 'foto', foto: alheio.getId(), ref: 0 }]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /não encontrada/);
});

test('foto grande demais é recusada', () => {
  const { api, cfg } = montar();
  const oc = tarefaComFoto(api, cfg);
  const enorme = 'A'.repeat(8000001);
  const r = estado(api, cfg.codigoFilha, [
    { acao: 'enviarFoto', id: oc.id, dados: enorme, mime: 'image/jpeg', ref: 0 },
  ]);
  assert.equal(r.resultados[0].ok, false);
  assert.match(r.resultados[0].erro, /grande demais/);
});

test('pedir foto numa tarefa liga a aprovação sozinho', () => {
  const { api, cfg } = montar();
  const t = estado(api, cfg.codigoPai).tarefas.find(x => x.titulo === 'Tirar o lixo');
  assert.equal(t.precisa_aprovacao, false);

  estado(api, cfg.codigoPai, [{
    acao: 'salvarTarefa', ref: 0,
    tarefa: { ...t, precisa_foto: true, precisa_aprovacao: false },
  }]);
  const depois = estado(api, cfg.codigoPai).tarefas.find(x => x.id === t.id);
  assert.equal(depois.precisa_foto, true);
  assert.equal(depois.precisa_aprovacao, true, 'foto sem conferência não faz sentido');
});

test('desmarcar guarda a foto, para remarcar no mesmo dia não pedir outra', () => {
  const { api, cfg } = montar();
  const oc = tarefaComFoto(api, cfg);
  estado(api, cfg.codigoFilha, [
    { acao: 'enviarFoto', id: oc.id, dados: UMA_FOTO, mime: 'image/jpeg', ref: 0 },
    { acao: 'marcar', id: oc.id, ref: 1 },
  ]);
  let r = estado(api, cfg.codigoFilha, [{ acao: 'desmarcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, r.resultados[0].erro);
  assert.ok(r.ocorrencias.find(o => o.id === oc.id).foto, 'perdeu a foto ao desmarcar');

  r = estado(api, cfg.codigoFilha, [{ acao: 'marcar', id: oc.id, ref: 0 }]);
  assert.equal(r.resultados[0].ok, true, 'pediu foto de novo no mesmo dia');
});

test('a foto não viaja junto com o estado', () => {
  // O estado é baixado a cada sincronização. Mandar imagem junto seria
  // centenas de KB a cada 45 segundos.
  const { api, cfg } = montar();
  const oc = tarefaComFoto(api, cfg);
  const e = estado(api, cfg.codigoFilha, [
    { acao: 'enviarFoto', id: oc.id, dados: UMA_FOTO, mime: 'image/jpeg', ref: 0 },
  ]);
  const texto = JSON.stringify(e.ocorrencias);
  assert.ok(!texto.includes(UMA_FOTO), 'a imagem foi junto no estado');
  assert.ok(texto.length < 8000, 'estado inchou: ' + texto.length + ' bytes');
});
