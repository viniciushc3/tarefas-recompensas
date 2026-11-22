// Teste de ponta a ponta: a página real, no Chromium, conversando com o
// Codigo.gs real através de uma planilha em memória. Pega erro de render e de
// fluxo que teste de unidade não pega.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { criarAmbiente } = require('./apps-script-falso');

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript' };

function subirServidor(api) {
  const servidor = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      let corpo = '';
      req.on('data', p => { corpo += p; });
      req.on('end', () => {
        let saida;
        try { saida = api.chamar(JSON.parse(corpo || '{}')); }
        catch (e) { saida = { ok: false, erro: String(e.message || e) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(saida));
      });
      return;
    }
    const nome = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const arquivo = path.join(RAIZ, nome);
    if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'text/plain' });
    res.end(fs.readFileSync(arquivo));
  });
  return new Promise(ok => servidor.listen(0, '127.0.0.1', () => ok(servidor)));
}

async function abrir(pagina, base, codigo) {
  const erros = [];
  pagina.on('pageerror', e => erros.push(String(e)));
  pagina.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#inUrl', base + '/api');
  await pagina.fill('#inCodigo', codigo);
  await pagina.click('#btEntrar');
  await pagina.waitForSelector('nav button', { state: 'visible', timeout: 15000 });
  return erros;
}

test('a filha marca uma tarefa e o pai a vê na fila', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const servidor = await subirServidor(api);
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();

  t.after(async () => { await navegador.close(); servidor.close(); });

  // ---------- celular dela
  const dela = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pDela = await dela.newPage();
  const errosDela = await abrir(pDela, base, cfg.codigoFilha);

  assert.deepEqual(errosDela, [], 'erro de JS na tela dela');
  assert.match(await pDela.textContent('#titulo'), /Oi,/);
  assert.equal(await pDela.locator('nav button').count(), 4);

  const tarefas = pDela.locator('.tarefa:not([disabled])');
  const quantas = await tarefas.count();
  assert.ok(quantas > 0, 'nenhuma tarefa marcável apareceu');

  // uma que precisa de aprovação, para cair na fila do pai
  const comAprovacao = pDela.locator('.tarefa:not([disabled])', { hasText: 'Lavar a louça' }).first();
  assert.ok(await comAprovacao.count() > 0, 'a tarefa de louça não apareceu');
  await comAprovacao.click();
  await pDela.waitForSelector('.tarefa.esperando', { timeout: 10000 });

  // uma que credita na hora: o saldo tem de subir na tela
  const semAprovacao = pDela.locator('.tarefa:not([disabled])', { hasText: 'Tirar o lixo' }).first();
  await semAprovacao.click();
  await pDela.waitForFunction(
    () => Number(document.querySelector('.saldo.g .val').textContent) > 0,
    null, { timeout: 10000 });
  const gastavel = Number(await pDela.textContent('.saldo.g .val'));
  assert.equal(gastavel, 14, '20 pontos deveriam virar 14 gastáveis');

  // as outras abas dela não podem explodir
  for (const aba of ['Loja', 'Meta', 'Extrato']) {
    await pDela.click(`nav button:has-text("${aba}")`);
    await pDela.waitForTimeout(250);
  }
  assert.deepEqual(errosDela, [], 'erro de JS ao navegar nas abas dela');

  // ---------- seu celular
  const seu = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pSeu = await seu.newPage();
  const errosSeus = await abrir(pSeu, base, cfg.codigoPai);

  assert.deepEqual(errosSeus, [], 'erro de JS na sua tela');
  const fila = await pSeu.textContent('#v-fila');
  assert.match(fila, /Lavar a louça/, 'a tarefa marcada não chegou na fila');
  assert.match(fila, /Tarefas aguardando/);

  await pSeu.click('[data-oc-sim]');
  await pSeu.waitForTimeout(1200);
  assert.doesNotMatch(await pSeu.textContent('#v-fila'), /Lavar a louça/,
    'a tarefa deveria sair da fila depois de aprovada');

  for (const aba of ['Semana', 'Extrato', 'Ajustes']) {
    await pSeu.click(`nav button:has-text("${aba}")`);
    await pSeu.waitForTimeout(250);
  }
  assert.deepEqual(errosSeus, [], 'erro de JS ao navegar nas suas abas');

  // o saldo dela subiu os 30 pontos aprovados
  const saldo = api.saldoDe(api.ler('Extrato'));
  assert.deepEqual(saldo, { gastavel: 35, cofrinho: 15 }, 'saldo final errado');
});

test('código errado não entra', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const servidor = await subirServidor(api);
  const base = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const pagina = await navegador.newPage();
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#inUrl', base + '/api');
  await pagina.fill('#inCodigo', 'ZZZZZZ');
  await pagina.click('#btEntrar');
  await pagina.waitForFunction(
    () => document.querySelector('#entrarErro').textContent.includes('não reconhecido'),
    null, { timeout: 10000 });
  assert.ok(await pagina.locator('#entrar').isVisible(), 'não deveria ter entrado');
});
