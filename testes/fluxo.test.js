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
