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

function subirServidor(api, atraso) {
  const servidor = http.createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      let corpo = '';
      req.on('data', p => { corpo += p; });
      req.on('end', () => {
        let saida;
        try { saida = api.chamar(JSON.parse(corpo || '{}')); }
        catch (e) { saida = { ok: false, erro: String(e.message || e) }; }
        const responder = () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(saida));
        };
        // O Apps Script leva de meio a dois segundos. Simular isso é o que faz
        // aparecer o problema de resposta velha chegando em cima do que ela
        // acabou de marcar.
        if (atraso && atraso.ms) setTimeout(responder, atraso.ms); else responder();
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
  // Aponta para a planilha de mentira; em produção vem da constante API_URL.
  await pagina.addInitScript(
    url => localStorage.setItem('tr.conf', JSON.stringify({ url })), base + '/api');
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
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
    await pDela.waitForSelector('nav button.on', { timeout: 10000 });
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
  // Esperar por condição, não por relógio: com a máquina ocupada, tempo fixo
  // é a receita de teste que falha uma vez em dez.
  //
  // O que tem de sumir é o botão de aprovar. O nome da tarefa continua na
  // tela, no resumo do dia, agora marcada como feita.
  await pSeu.waitForFunction(
    () => document.querySelectorAll('[data-oc-sim]').length === 0,
    null, { timeout: 15000 });
  const resumo = await pSeu.textContent('#v-fila');
  assert.match(resumo, /Hoje · 2 de \d+/,
    'o resumo do dia deveria contar as duas feitas (a que ela marcou e a que você aprovou)');
  assert.match(resumo, /Lavar a louça/,
    'a tarefa aprovada tem de continuar visível, agora como feita');

  for (const aba of ['Semana', 'Extrato', 'Ajustes']) {
    await pSeu.click(`nav button:has-text("${aba}")`);
    await pSeu.waitForSelector('nav button.on', { timeout: 10000 });
  }
  assert.deepEqual(errosSeus, [], 'erro de JS ao navegar nas suas abas');

  // ---------- criar uma tarefa pelo app, sem abrir a planilha
  await pSeu.click('nav button:has-text("Editar")');
  await pSeu.click('[data-nova="tarefa"]');
  await pSeu.fill('#f-titulo', 'Passear com o cachorro');
  await pSeu.fill('#f-icone', '🐕');
  await pSeu.fill('#f-pontos', '25');
  await pSeu.click('.op[data-campo="periodo"][data-valor="tarde"]');
  // o formulário se redesenha a cada escolha: o texto digitado não pode sumir
  assert.equal(await pSeu.inputValue('#f-titulo'), 'Passear com o cachorro',
    'o formulário perdeu o que foi digitado ao trocar de opção');
  assert.equal(await pSeu.inputValue('#f-pontos'), '25');
  await pSeu.click('#btSalvar');
  await pSeu.waitForFunction(
    () => document.querySelector('#v-editar').textContent.includes('Passear com o cachorro'),
    null, { timeout: 15000 });
  await pSeu.waitForFunction(
    () => document.body.dataset.sync === 'ok',
    null, { timeout: 15000 });
  const criada = api.ler('Tarefas').find(t => t.titulo === 'Passear com o cachorro');
  assert.ok(criada, 'a tarefa não chegou na planilha');
  assert.equal(Number(criada.pontos), 25);
  assert.equal(criada.periodo, 'tarde');
  assert.deepEqual(errosSeus, [], 'erro de JS ao editar');

  // e ela aparece no celular dela
  await pDela.click('nav button:has-text("Hoje")');
  await pDela.waitForFunction(
    () => document.querySelector('#v-hoje').textContent.includes('Passear com o cachorro'),
    null, { timeout: 15000 });

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
  await pagina.addInitScript(
    url => localStorage.setItem('tr.conf', JSON.stringify({ url })), base + '/api');
  await pagina.goto(base, { waitUntil: 'domcontentloaded' });
  await pagina.fill('#inCodigo', 'ZZZZZZZZ');
  await pagina.click('#btEntrar');
  await pagina.waitForFunction(
    () => document.querySelector('#entrarErro').textContent.includes('não reconhecido'),
    null, { timeout: 10000 });
  assert.ok(await pagina.locator('#entrar').isVisible(), 'não deveria ter entrado');
});

test('com a planilha inchada, o toque continua instantâneo', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();

  // Reproduz a bagunça que o bug das datas deixou: o gerador rodando de novo a
  // cada abertura, por semanas. Foi o que deixou o app dela lento.
  const base = api.ler('Ocorrencias');
  for (let volta = 0; volta < 150; volta++) {
    base.forEach(o => api.anexar('Ocorrencias', {
      id: 'dup-' + volta + '-' + o.id, data: o.data, tarefa_id: o.tarefa_id,
      titulo: o.titulo, icone: o.icone, pontos: o.pontos, tipo: o.tipo,
      periodo: o.periodo, conta_mesada: 'sim', precisa_aprovacao: o.precisa_aprovacao,
      status: 'pendente',
    }));
  }
  assert.ok(api.ler('Ocorrencias').length > 1000,
    'a planilha de teste deveria estar inchada: ' + api.ler('Ocorrencias').length);

  const servidor = await subirServidor(api);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await ctx.newPage();
  const erros = await abrir(pagina, url, cfg.codigoFilha);
  assert.deepEqual(erros, []);

  // O servidor tem de entregar a lista já limpa, mesmo com a planilha suja.
  const quantas = await pagina.evaluate(
    () => JSON.parse(localStorage.getItem('tr.cache')).ocorrencias.length);
  assert.ok(quantas < 40, 'a resposta veio com ' + quantas + ' ocorrências — repetidas passaram');

  const alvo = pagina.locator('.tarefa:not([disabled])').first();
  const inicio = Date.now();
  await alvo.click();
  await pagina.waitForSelector('.tarefa.feita, .tarefa.esperando', { timeout: 5000 });
  const demora = Date.now() - inicio;

  // O desenho não pode esperar a rede nem a gravação do estado. Qualquer coisa
  // acima disto é a sensação de "ele vai na planilha antes de marcar".
  assert.ok(demora < 400, 'o toque levou ' + demora + 'ms para aparecer na tela');
  console.log('      toque -> visto na tela: ' + demora + 'ms');
});

test('ela marca, sincroniza e desmarca com um toque', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const servidor = await subirServidor(api);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const erros = await abrir(p, url, cfg.codigoFilha);

  const alvo = p.locator('.tarefa:not([disabled])', { hasText: 'Tirar o lixo' }).first();
  await alvo.click();
  await p.waitForSelector('.tarefa.feita', { timeout: 5000 });
  assert.equal(Number(await p.textContent('[data-saldo="gastavel"]')), 14);

  // Espera chegar na planilha, para o desfazer valer contra dado já gravado.
  await p.waitForFunction(() => document.body.dataset.sync === 'ok',
    null, { timeout: 15000 });
  assert.equal(api.ler('Extrato').filter(e => e.tipo === 'ganho').length, 1);

  // Era aqui que o app parecia travado: o cartão feito não respondia a toque.
  const feita = p.locator('.tarefa.feita', { hasText: 'Tirar o lixo' }).first();
  assert.match(await p.textContent('#v-hoje'), /Tocar numa tarefa feita desmarca/,
    'sem a pista, ela não descobre que dá para desfazer');

  const inicio = Date.now();
  await feita.click();
  await p.waitForFunction(
    () => Number(document.querySelector('[data-saldo="gastavel"]').textContent) === 0,
    null, { timeout: 5000 });
  const demora = Date.now() - inicio;
  assert.ok(demora < 400, 'desmarcar levou ' + demora + 'ms na tela');

  await p.waitForFunction(() => document.body.dataset.sync === 'ok',
    null, { timeout: 15000 });
  assert.deepEqual(api.saldoDe(api.ler('Extrato')), { gastavel: 0, cofrinho: 0 },
    'a planilha não estornou');
  assert.equal(
    api.ler('Ocorrencias').filter(o => o.titulo === 'Tirar o lixo' && o.status === 'aprovada').length,
    0, 'a ocorrência continuou aprovada na planilha');

  // E dá para marcar de novo, pagando de novo.
  await p.locator('.tarefa:not([disabled])', { hasText: 'Tirar o lixo' }).first().click();
  await p.waitForFunction(
    () => Number(document.querySelector('[data-saldo="gastavel"]').textContent) === 14,
    null, { timeout: 5000 });
  await p.waitForFunction(() => document.body.dataset.sync === 'ok',
    null, { timeout: 15000 });
  assert.deepEqual(api.saldoDe(api.ler('Extrato')), { gastavel: 14, cofrinho: 6 });

  assert.deepEqual(erros, [], 'erro de JS durante marcar/desmarcar');
  console.log('      desmarcar -> tela: ' + demora + 'ms');
});

test('a tela nunca anda para trás enquanto a planilha responde devagar', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const atraso = { ms: 0 };
  const servidor = await subirServidor(api, atraso);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const erros = await abrir(p, url, cfg.codigoFilha);

  // A partir daqui a planilha demora, como a de verdade.
  atraso.ms = 1500;

  // Quatro tarefas distintas: o cartão feito também aceita toque agora, então
  // clicar sempre no primeiro marcaria e desmarcaria a mesma.
  const porFazer = '.tarefa:not(.feita):not(.esperando):not([disabled])';
  const titulos = await p.locator(porFazer).evaluateAll(
    nos => nos.slice(0, 4).map(n => n.querySelector('.tit').textContent.trim()));
  assert.equal(titulos.length, 4);

  // Ela marca uma, e marca mais três enquanto a primeira ainda está subindo.
  await p.locator(porFazer, { hasText: titulos[0] }).first().click();
  await p.waitForTimeout(800);           // tempo de o envio começar
  for (const t of titulos.slice(1)) {
    await p.locator(porFazer, { hasText: t }).first().click();
  }

  const feitasAgora = await p.locator('.tarefa.feita, .tarefa.esperando').count();
  assert.equal(feitasAgora, 4, 'as quatro deveriam estar marcadas na hora');

  // Vigia a tela: se a resposta velha apagar marcação, o mínimo cai.
  await p.evaluate(() => {
    window.__min = 99;
    window.__vigia = setInterval(() => {
      const n = document.querySelectorAll('.tarefa.feita, .tarefa.esperando').length;
      if (n < window.__min) window.__min = n;
    }, 25);
  });

  await p.waitForFunction(
    () => document.body.dataset.sync === 'ok' && !window.__filaPendente,
    null, { timeout: 30000 });
  await p.waitForTimeout(500);
  const minimo = await p.evaluate(() => { clearInterval(window.__vigia); return window.__min; });

  assert.equal(minimo, 4,
    'a tela desmarcou sozinha: chegou a mostrar ' + minimo + ' de 4 marcadas');
  assert.equal(await p.locator('.tarefa.feita, .tarefa.esperando').count(), 4);

  // E a planilha recebeu as quatro.
  const marcadas = api.ler('Ocorrencias')
    .filter(o => o.status === 'aprovada' || o.status === 'marcada').length;
  assert.equal(marcadas, 4, 'a planilha ficou com ' + marcadas);
  assert.deepEqual(erros, []);
});

test('ela fotografa a tarefa e a foto aparece na fila do pai', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const servidor = await subirServidor(api);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  // PNG de 1x1: o bastante para o canvas abrir e recomprimir como JPEG.
  const imagem = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const dela = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pDela = await dela.newPage();
  pDela.on('filechooser', async escolha => {
    await escolha.setFiles({ name: 'quarto.png', mimeType: 'image/png', buffer: imagem });
  });
  const erros = await abrir(pDela, url, cfg.codigoFilha);

  const comFoto = pDela.locator('.tarefa:not([disabled])', { hasText: 'Organizar o quarto' }).first();
  assert.equal(await comFoto.count(), 1, 'a tarefa com foto não apareceu (é de fim de semana)');
  assert.match(await comFoto.textContent(), /pede foto/,
    'ela precisa saber que essa tarefa pede foto antes de tocar');

  await comFoto.click();
  await pDela.waitForFunction(
    () => document.querySelector('#v-hoje').textContent.includes('foto enviada'),
    null, { timeout: 20000 });

  // chegou na planilha
  const oc = api.ler('Ocorrencias').find(o => o.titulo === 'Organizar o quarto');
  assert.ok(oc.foto, 'a planilha ficou sem a referência da foto');
  assert.equal(oc.status, 'marcada');
  assert.equal(api._ambiente.DriveApp._arquivos.size, 1, 'o arquivo não foi para o Drive');

  // ---------- e aparece na fila do pai
  const seu = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const pSeu = await seu.newPage();
  const errosSeus = await abrir(pSeu, url, cfg.codigoPai);

  await pSeu.waitForSelector('#v-fila img', { timeout: 20000 });
  const origem = await pSeu.getAttribute('#v-fila img', 'src');
  assert.match(origem, /^data:image\//, 'a imagem não veio pelo endereço protegido');
  assert.ok(origem.length > 100, 'imagem vazia');

  // a largura renderizada prova que o navegador decodificou de verdade
  const largura = await pSeu.evaluate(
    () => document.querySelector('#v-fila img').naturalWidth);
  assert.ok(largura > 0, 'a imagem não decodificou');

  assert.deepEqual(erros, [], 'erro de JS na tela dela');
  assert.deepEqual(errosSeus, [], 'erro de JS na sua tela');
});

test('o tema dela é o claro, e tocar no nome sai da conta', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const servidor = await subirServidor(api);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const erros = await abrir(p, url, cfg.codigoFilha);

  assert.equal(await p.getAttribute('body', 'data-papel'), 'filha');
  const fundo = await p.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bg').trim());
  assert.equal(fundo, '#fff7fb', 'a tela dela deveria estar no tema claro');
  assert.equal(await p.getAttribute('meta[name="theme-color"]', 'content'), '#fff7fb');

  // Sair: pergunta antes, porque ela não tem o código para voltar.
  let perguntou = '';
  p.on('dialog', d => { perguntou = d.message(); d.dismiss(); });
  await p.click('#perfil');
  await p.waitForTimeout(300);
  assert.match(perguntou, /Sair da conta/);
  assert.ok(!(await p.locator('#entrar').isVisible()), 'recusar não podia ter saído');

  p.removeAllListeners('dialog');
  p.on('dialog', d => d.accept());
  await p.click('#perfil');
  await p.waitForSelector('#entrar', { state: 'visible', timeout: 10000 });
  // O endereço fixo continua guardado de propósito: ao voltar, ela digita só
  // o código. O que não pode sobrar é o código.
  const guardado = await p.evaluate(() => JSON.parse(localStorage.getItem('tr.conf')));
  assert.equal(guardado.codigo, undefined, 'o código continuou no aparelho');
  assert.equal(await p.evaluate(() => localStorage.getItem('tr.cache')), 'null',
    'os dados dela continuaram no aparelho');
  assert.ok(await p.locator('#inCodigo').isVisible());
  assert.ok(!(await p.locator('#campoUrl').isVisible()), 'não deveria pedir o endereço de novo');

  assert.deepEqual(erros, []);
});

test('a tela do pai continua no tema escuro', async (t) => {
  const api = criarAmbiente();
  api.instalar();
  const cfg = api.config();
  const servidor = await subirServidor(api);
  const url = 'http://127.0.0.1:' + servidor.address().port;
  const navegador = await chromium.launch();
  t.after(async () => { await navegador.close(); servidor.close(); });

  const p = await navegador.newPage();
  await abrir(p, url, cfg.codigoPai);
  assert.equal(await p.getAttribute('body', 'data-papel'), 'pai');
  const fundo = await p.evaluate(
    () => getComputedStyle(document.body).getPropertyValue('--bg').trim());
  assert.equal(fundo, '#0b0d13');
});
