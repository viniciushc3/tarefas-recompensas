// Testes das regras puras do Apps Script.
//
// O arquivo Codigo.gs é JavaScript comum, e seu nível superior tem só
// declarações — então dá para avaliá-lo aqui e exercitar as regras de verdade,
// sem Apps Script, sem planilha e sem rede. Rode com: node --test testes/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Codigo.gs'), 'utf8');
const R = new Function(fonte + `
  return { dividir, somarDias, diferencaEmDias, diaDaSemana, inicioDaSemana,
           tarefaCaiNoDia, diaCompleto, calcularStreak, resumoDaSemana,
           faixaAlcancada, proximaFaixa, tarefasParaAlcancar, pontosPorMinuto,
           saldoDe };
`)();

function oc(data, status, opcoes = {}) {
  return {
    data,
    status,
    conta_mesada: opcoes.conta ?? true,
    pontos: opcoes.pontos ?? 10,
  };
}

// ------------------------------------------------------- cofrinho 70/30
test('divide 70/30 e o resto fica com o saldo gastável', () => {
  assert.deepEqual(R.dividir(100, 0.3), { gastavel: 70, cofrinho: 30 });
  // 50 * 0,3 = 15 exato
  assert.deepEqual(R.dividir(50, 0.3), { gastavel: 35, cofrinho: 15 });
  // 25 * 0,3 = 7,5 -> cofrinho 7, gastável 18 (o resto a favor dela)
  assert.deepEqual(R.dividir(25, 0.3), { gastavel: 18, cofrinho: 7 });
  assert.deepEqual(R.dividir(0, 0.3), { gastavel: 0, cofrinho: 0 });
});

test('tarefa de 1 ponto não some no arredondamento', () => {
  assert.deepEqual(R.dividir(1, 0.3), { gastavel: 1, cofrinho: 0 });
});

// ----------------------------------------------------------------- datas
test('somarDias atravessa mês, ano e ano bissexto', () => {
  assert.equal(R.somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(R.somarDias('2026-01-01', -1), '2025-12-31');
  assert.equal(R.somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(R.somarDias('2028-02-29', 1), '2028-03-01');
});

test('inicioDaSemana devolve segunda', () => {
  assert.equal(R.inicioDaSemana('2026-11-23'), '2026-11-23'); // segunda
  assert.equal(R.inicioDaSemana('2026-11-25'), '2026-11-23'); // quarta
  assert.equal(R.inicioDaSemana('2026-11-29'), '2026-11-23'); // domingo
  assert.equal(R.inicioDaSemana('2026-11-22'), '2026-11-16'); // domingo anterior
});

test('diferencaEmDias ignora horário', () => {
  assert.equal(R.diferencaEmDias('2026-11-20', '2026-11-22'), 2);
  assert.equal(R.diferencaEmDias('2026-11-22', '2026-11-20'), -2);
});

// ----------------------------------------------------------- recorrência
test('recorrências caem nos dias certos', () => {
  const seg = '2026-11-23', sab = '2026-11-28', dom = '2026-11-29';
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'diaria' }, dom), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'semana' }, seg), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'semana' }, sab), false);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'fimdesemana' }, sab), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'fimdesemana' }, dom), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'fimdesemana' }, seg), false);
  // segunda, quarta, sexta
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'dias', dias: '1,3,5' }, seg), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'dias', dias: '1,3,5' }, '2026-11-24'), false);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'avulsa', dias: '2026-12-24' }, '2026-12-24'), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'avulsa', dias: '2026-12-24' }, seg), false);
});

test('"dias" não confunde 1 com 11', () => {
  // split(',') exato: '1,3,5' não deve casar com um dia 11 inexistente, e
  // '0' (domingo) não deve casar por substring
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'dias', dias: '0' }, '2026-11-29'), true);
  assert.equal(R.tarefaCaiNoDia({ recorrencia: 'dias', dias: '6' }, '2026-11-29'), false);
});

// ---------------------------------------------------------------- streak
test('dia só fecha com tarefa elegível e todas aprovadas', () => {
  assert.equal(R.diaCompleto([]), false);
  assert.equal(R.diaCompleto([oc('2026-11-22', 'aprovada')]), true);
  assert.equal(R.diaCompleto([oc('2026-11-22', 'aprovada'), oc('2026-11-22', 'pendente')]), false);
  // tarefa fora da mesada não impede o dia de fechar
  assert.equal(
    R.diaCompleto([oc('2026-11-22', 'aprovada'), oc('2026-11-22', 'pendente', { conta: false })]),
    true,
  );
});

test('streak não zera porque hoje ainda está em aberto', () => {
  const dados = [
    oc('2026-11-22', 'pendente'),
    oc('2026-11-21', 'aprovada'),
    oc('2026-11-20', 'aprovada'),
  ];
  assert.equal(R.calcularStreak(dados, '2026-11-22'), 2);
});

test('hoje completo entra no streak', () => {
  assert.equal(
    R.calcularStreak([oc('2026-11-22', 'aprovada'), oc('2026-11-21', 'aprovada')], '2026-11-22'),
    2,
  );
});

test('dia expirado quebra o streak', () => {
  const dados = [
    oc('2026-11-22', 'aprovada'),
    oc('2026-11-21', 'expirada'),
    oc('2026-11-20', 'aprovada'),
  ];
  assert.equal(R.calcularStreak(dados, '2026-11-22'), 1);
});

test('dia sem ocorrência nenhuma encerra a contagem', () => {
  assert.equal(
    R.calcularStreak([oc('2026-11-22', 'aprovada'), oc('2026-11-20', 'aprovada')], '2026-11-22'),
    1,
  );
});

// ---------------------------------------------------------------- semana
test('resumoDaSemana conta só os 7 dias e só o que vale mesada', () => {
  const dados = [
    oc('2026-11-23', 'aprovada'),
    oc('2026-11-24', 'aprovada'),
    oc('2026-11-25', 'pendente'),
    oc('2026-11-26', 'expirada'),
    oc('2026-11-30', 'aprovada'),                  // semana seguinte
    oc('2026-11-23', 'aprovada', { conta: false }), // fora da mesada
  ];
  const r = R.resumoDaSemana(dados, '2026-11-23');
  assert.equal(r.elegiveis, 4);
  assert.equal(r.aprovadas, 2);
  assert.equal(r.emAberto, 1);
  assert.equal(r.pct, 50);
});

test('semana vazia não divide por zero', () => {
  assert.equal(R.resumoDaSemana([], '2026-11-23').pct, 0);
});

// ---------------------------------------------------------------- mesada
const FAIXAS = [
  { min_pct: 0, valor: 5 },
  { min_pct: 50, valor: 8.5 },
  { min_pct: 70, valor: 12.5 },
  { min_pct: 85, valor: 15 },
];

test('faixa alcançada é a maior atingida, e o piso nunca é zero', () => {
  assert.equal(R.faixaAlcancada(FAIXAS, 0).valor, 5);
  assert.equal(R.faixaAlcancada(FAIXAS, 49).valor, 5);
  assert.equal(R.faixaAlcancada(FAIXAS, 70).valor, 12.5, '70% paga os R$ 12,50');
  assert.equal(R.faixaAlcancada(FAIXAS, 100).valor, 15);
});

test('proximaFaixa aponta para cima', () => {
  assert.equal(R.proximaFaixa(FAIXAS, 55).min_pct, 70);
  assert.equal(R.proximaFaixa(FAIXAS, 100), null);
});

test('tarefasParaAlcancar conta o que ainda dá, e null quando não dá mais', () => {
  assert.equal(R.tarefasParaAlcancar({ elegiveis: 10, aprovadas: 5, emAberto: 5, pct: 50 }, 70), 2);
  assert.equal(R.tarefasParaAlcancar({ elegiveis: 10, aprovadas: 2, emAberto: 0, pct: 20 }, 70), null);
  assert.equal(R.tarefasParaAlcancar({ elegiveis: 10, aprovadas: 8, emAberto: 2, pct: 80 }, 70), 0);
});

// ------------------------------------------------------------ tela, saldo
test('pontosPorMinuto usa a tarifa mais barata', () => {
  const rec = [
    { tipo: 'tela', custo: 30, minutos: 15 },   // 2,00/min
    { tipo: 'tela', custo: 130, minutos: 60 },  // 2,17/min
    { tipo: 'privilegio', custo: 80, minutos: 0 },
  ];
  assert.equal(R.pontosPorMinuto(rec), 2);
  assert.equal(R.pontosPorMinuto([{ tipo: 'privilegio', custo: 80, minutos: 0 }]), 0);
});

test('saldo é a soma do extrato, com lançamentos negativos', () => {
  const extrato = [
    { gastavel: 70, cofrinho: 30 },
    { gastavel: -60, cofrinho: 0 },
    { gastavel: 35, cofrinho: 15 },
    { gastavel: '', cofrinho: '' },   // célula vazia da planilha
  ];
  assert.deepEqual(R.saldoDe(extrato), { gastavel: 45, cofrinho: 45 });
});
