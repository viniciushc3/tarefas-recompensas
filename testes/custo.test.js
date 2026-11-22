// Quanto cada requisição custa em idas à planilha.
//
// No Apps Script, cada getValues()/setValues() é uma chamada ao servidor do
// Sheets, de 30 a 150ms. Não é detalhe de otimização: é a diferença entre o
// app responder em meio segundo ou em três. Estes limites existem para uma
// leitura descuidada acrescentada no futuro aparecer como teste vermelho em
// vez de "o app está lento".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente } = require('./apps-script-falso');

function medir(api, fn) {
  const c = api._ambiente._contador;
  c.leituras = 0;
  c.escritas = 0;
  fn();
  return { leituras: c.leituras, escritas: c.escritas };
}

function montado() {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  api.chamar({ codigo: cfg.codigoFilha, acoes: [] });   // primeira geração do dia
  return { api, cfg };
}

test('abrir o app dela: no máximo 7 leituras e nenhuma escrita', () => {
  const { api, cfg } = montado();
  const custo = medir(api, () => api.chamar({ codigo: cfg.codigoFilha, acoes: [] }));
  assert.ok(custo.leituras <= 7, 'leituras: ' + custo.leituras);
  // Só abrir não pode escrever nada: o dia já foi gerado.
  assert.equal(custo.escritas, 0, 'escritas: ' + custo.escritas);
});

test('abrir o app do pai: no máximo 9 leituras', () => {
  const { api, cfg } = montado();
  const custo = medir(api, () => api.chamar({ codigo: cfg.codigoPai, acoes: [] }));
  assert.ok(custo.leituras <= 9, 'leituras: ' + custo.leituras);
  assert.equal(custo.escritas, 0, 'escritas: ' + custo.escritas);
});

test('marcar uma tarefa: no máximo 10 leituras e 3 escritas', () => {
  const { api, cfg } = montado();
  const e = api.chamar({ codigo: cfg.codigoFilha, acoes: [] });
  const oc = e.ocorrencias.find(o => o.data === e.hoje && o.pontos > 0 && !o.precisa_aprovacao);
  const custo = medir(api, () =>
    api.chamar({ codigo: cfg.codigoFilha, acoes: [{ acao: 'marcar', id: oc.id, ref: 0 }] }));
  assert.ok(custo.leituras <= 10, 'leituras: ' + custo.leituras);
  // uma linha de ocorrência + um lançamento no extrato
  assert.ok(custo.escritas <= 3, 'escritas: ' + custo.escritas);
});

test('salvar uma tarefa: uma escrita de linha, não uma por coluna', () => {
  const { api, cfg } = montado();
  const t = api.chamar({ codigo: cfg.codigoPai, acoes: [] }).tarefas[0];
  const custo = medir(api, () => api.chamar({
    codigo: cfg.codigoPai,
    acoes: [{ acao: 'salvarTarefa', tarefa: { ...t, pontos: 33 }, ref: 0 }],
  }));
  // A tarefa tem 12 colunas: sem escrita em lote seriam 12 chamadas.
  assert.ok(custo.escritas <= 4, 'escritas: ' + custo.escritas);
});

test('marcar várias de uma vez não multiplica o custo', () => {
  const { api, cfg } = montado();
  const e = api.chamar({ codigo: cfg.codigoFilha, acoes: [] });
  const quatro = e.ocorrencias
    .filter(o => o.data === e.hoje && o.status === 'pendente').slice(0, 4);
  assert.equal(quatro.length, 4);

  const custo = medir(api, () => api.chamar({
    codigo: cfg.codigoFilha,
    acoes: quatro.map((o, i) => ({ acao: 'marcar', id: o.id, ref: i })),
  }));
  // É o caso de ela marcar tudo offline e sincronizar junto: a leitura das
  // abas tem de continuar sendo uma só, não uma por ação.
  assert.ok(custo.leituras <= 14, 'leituras: ' + custo.leituras);
});

test('o dia não é gerado de novo a cada toque', () => {
  const { api, cfg } = montado();
  const antes = api.ler('Ocorrencias').length;
  for (let i = 0; i < 5; i++) api.chamar({ codigo: cfg.codigoFilha, acoes: [] });
  assert.equal(api.ler('Ocorrencias').length, antes,
    'o gerador voltou a duplicar — foi exatamente esse bug que encheu a planilha');
});

test('buscar uma foto não monta a tela inteira', () => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const e = api.chamar({ codigo: cfg.codigoFilha, acoes: [] });
  const oc = e.ocorrencias.find(o => o.precisa_foto);

  api.chamar({ codigo: cfg.codigoFilha, acoes: [
    { acao: 'enviarFoto', id: oc.id, dados: Buffer.from('x').toString('base64'),
      mime: 'image/jpeg', ref: 0 },
  ]});
  const comFoto = api.ler('Ocorrencias').find(o => o.id === oc.id).foto;

  const custo = medir(api, () =>
    api.chamar({ codigo: cfg.codigoPai, acoes: [{ acao: 'foto', foto: comFoto, ref: 0 }] }));

  // Config para achar a pessoa, Ocorrencias para conferir que a foto é nossa.
  assert.ok(custo.leituras <= 3, 'leituras: ' + custo.leituras);
  assert.equal(custo.escritas, 0);
});

test('o pedido de foto não devolve a tela junto', () => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const e = api.chamar({ codigo: cfg.codigoFilha, acoes: [] });
  const oc = e.ocorrencias.find(o => o.precisa_foto);
  api.chamar({ codigo: cfg.codigoFilha, acoes: [
    { acao: 'enviarFoto', id: oc.id, dados: Buffer.from('x').toString('base64'), ref: 0 },
  ]});
  const comFoto = api.ler('Ocorrencias').find(o => o.id === oc.id).foto;

  const r = api.chamar({ codigo: cfg.codigoPai, acoes: [{ acao: 'foto', foto: comFoto, ref: 0 }] });
  assert.equal(r.somenteFoto, true);
  assert.equal(r.ocorrencias, undefined, 'veio a tela inteira junto com a imagem');
  assert.ok(r.resultados[0].dados.dados);
});

test('a senha não diferencia maiúscula de minúscula', () => {
  const api = criarAmbiente();
  api.instalar();
  // Como alguém escolheria à mão na aba Config.
  const linha = api.ler('Config').find(c => c.chave === 'codigo_filha');
  api.escrever('Config', linha._linha, 'valor', 'Lili');

  ['Lili', 'lili', 'LILI', ' lili '].forEach(tentativa => {
    const r = api.chamar({ codigo: tentativa, acoes: [] });
    assert.equal(r.ok, true, 'recusou "' + tentativa + '"');
    assert.equal(r.papel, 'filha');
  });
  assert.equal(api.chamar({ codigo: 'lilo', acoes: [] }).erro, 'codigo');
});
