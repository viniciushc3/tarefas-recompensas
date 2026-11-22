// Testes das funções puras (datas e métricas). Rodam com node --test sobre o
// JS compilado por scripts/testar-logica.sh — sem Metro e sem React.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { somarDias, inicioDaSemana, diferencaEmDias, rotuloDoDia } = require('../.testes-build/datas.js');
const {
  calcularStreak, resumoDaSemana, faixaAlcancada, proximaFaixa,
  tarefasParaAlcancar, pontosPorMinutoDeTela, diaCompleto,
} = require('../.testes-build/metricas.js');

function occ(dia, status, opcoes = {}) {
  return {
    local_date: dia,
    status,
    counts_for_allowance_snapshot: opcoes.conta ?? true,
    points_snapshot: opcoes.pontos ?? 10,
  };
}

// ----------------------------------------------------------------- datas
test('somarDias atravessa a virada do mês', () => {
  assert.equal(somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(somarDias('2026-01-01', -1), '2025-12-31');
});

test('somarDias atravessa ano bissexto', () => {
  assert.equal(somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(somarDias('2028-02-29', 1), '2028-03-01');
});

test('inicioDaSemana devolve segunda, igual ao date_trunc do Postgres', () => {
  assert.equal(inicioDaSemana('2026-11-23'), '2026-11-23'); // segunda
  assert.equal(inicioDaSemana('2026-11-25'), '2026-11-23'); // quarta
  assert.equal(inicioDaSemana('2026-11-29'), '2026-11-23'); // domingo -> segunda anterior
  assert.equal(inicioDaSemana('2026-11-22'), '2026-11-16'); // domingo
});

test('diferencaEmDias ignora horário e fuso', () => {
  assert.equal(diferencaEmDias('2026-11-20', '2026-11-22'), 2);
  assert.equal(diferencaEmDias('2026-11-22', '2026-11-20'), -2);
});

test('rotuloDoDia fala como ela fala', () => {
  assert.equal(rotuloDoDia('2026-11-22', '2026-11-22'), 'hoje');
  assert.equal(rotuloDoDia('2026-11-21', '2026-11-22'), 'ontem');
  assert.match(rotuloDoDia('2026-11-19', '2026-11-22'), /quinta, 19\/11/);
});

// ----------------------------------------------------------------- streak
test('dia só está completo se tiver tarefa elegível e todas aprovadas', () => {
  assert.equal(diaCompleto([]), false, 'dia vazio não é completo');
  assert.equal(diaCompleto([occ('2026-11-22', 'approved')]), true);
  assert.equal(diaCompleto([occ('2026-11-22', 'approved'), occ('2026-11-22', 'pending')]), false);
  // tarefa que não conta para a mesada não deve impedir o dia de fechar
  assert.equal(
    diaCompleto([occ('2026-11-22', 'approved'), occ('2026-11-22', 'pending', { conta: false })]),
    true,
  );
});

test('streak não zera porque hoje ainda está em aberto', () => {
  const o = [
    occ('2026-11-22', 'pending'),   // hoje, de manhã
    occ('2026-11-21', 'approved'),
    occ('2026-11-20', 'approved'),
  ];
  assert.equal(calcularStreak(o, '2026-11-22'), 2, 'deve contar ontem e anteontem');
});

test('hoje completo entra no streak', () => {
  const o = [occ('2026-11-22', 'approved'), occ('2026-11-21', 'approved')];
  assert.equal(calcularStreak(o, '2026-11-22'), 2);
});

test('dia falhado quebra o streak', () => {
  const o = [
    occ('2026-11-22', 'approved'),
    occ('2026-11-21', 'expired'),
    occ('2026-11-20', 'approved'),
  ];
  assert.equal(calcularStreak(o, '2026-11-22'), 1);
});

test('buraco sem ocorrência nenhuma encerra a contagem', () => {
  // 21/11 não existe: o catch-up do servidor é o que evita esse caso,
  // mas a interface não pode contar como se fosse completo.
  const o = [occ('2026-11-22', 'approved'), occ('2026-11-20', 'approved')];
  assert.equal(calcularStreak(o, '2026-11-22'), 1);
});

// ----------------------------------------------------------------- semana
test('resumoDaSemana conta só os 7 dias e só o que conta para a mesada', () => {
  const o = [
    occ('2026-11-23', 'approved'),
    occ('2026-11-24', 'approved'),
    occ('2026-11-25', 'pending'),
    occ('2026-11-26', 'expired'),
    occ('2026-11-30', 'approved'),              // semana seguinte
    occ('2026-11-23', 'approved', { conta: false }), // fora da mesada
  ];
  const r = resumoDaSemana(o, '2026-11-23');
  assert.equal(r.elegiveis, 4);
  assert.equal(r.aprovadas, 2);
  assert.equal(r.emAberto, 1);
  assert.equal(r.pct, 50);
});

test('semana sem tarefa elegível não vira divisão por zero', () => {
  assert.equal(resumoDaSemana([], '2026-11-23').pct, 0);
});

// ----------------------------------------------------------------- mesada
const FAIXAS = [
  { min_pct: 0, amount_cents: 500 },
  { min_pct: 50, amount_cents: 850 },
  { min_pct: 70, amount_cents: 1250 },
  { min_pct: 85, amount_cents: 1500 },
];

test('faixaAlcancada pega a maior faixa atingida', () => {
  assert.equal(faixaAlcancada(FAIXAS, 0).amount_cents, 500);
  assert.equal(faixaAlcancada(FAIXAS, 49).amount_cents, 500);
  assert.equal(faixaAlcancada(FAIXAS, 70).amount_cents, 1250, '70% paga os R$ 12,50');
  assert.equal(faixaAlcancada(FAIXAS, 100).amount_cents, 1500);
});

test('o piso nunca é zero: 0% ainda paga a faixa base', () => {
  assert.equal(faixaAlcancada(FAIXAS, 0).amount_cents, 500);
});

test('proximaFaixa aponta para cima', () => {
  assert.equal(proximaFaixa(FAIXAS, 55).min_pct, 70);
  assert.equal(proximaFaixa(FAIXAS, 100), null);
});

test('tarefasParaAlcancar devolve null quando já é inalcançável', () => {
  // 10 elegíveis, 2 aprovadas, nada em aberto: 70% exige 7, impossível
  const r = { elegiveis: 10, aprovadas: 2, emAberto: 0, pct: 20 };
  assert.equal(tarefasParaAlcancar(r, 70), null);
});

test('tarefasParaAlcancar conta o que ainda dá', () => {
  const r = { elegiveis: 10, aprovadas: 5, emAberto: 5, pct: 50 };
  assert.equal(tarefasParaAlcancar(r, 70), 2);
});

test('faixa já alcançada não pede tarefa nenhuma', () => {
  const r = { elegiveis: 10, aprovadas: 8, emAberto: 2, pct: 80 };
  assert.equal(tarefasParaAlcancar(r, 70), 0);
});

// ------------------------------------------------------- preço da tela
test('pontosPorMinutoDeTela usa a tarifa mais barata do catálogo', () => {
  const recompensas = [
    { kind: 'screen_time', cost_points: 30, screen_minutes: 15 },  // 2,0/min
    { kind: 'screen_time', cost_points: 130, screen_minutes: 60 }, // ~2,17/min
    { kind: 'privilege', cost_points: 80, screen_minutes: null },
  ];
  assert.equal(pontosPorMinutoDeTela(recompensas), 2);
});

test('catálogo sem tela não quebra a conversão', () => {
  assert.equal(pontosPorMinutoDeTela([{ kind: 'privilege', cost_points: 80, screen_minutes: null }]), 0);
});
