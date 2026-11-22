// Planilha de mentira, em memória, com o bastante do Apps Script para rodar
// Codigo.gs de verdade fora do Google. É o que permite testar instalar(),
// marcar, aprovar e resgatar sem abrir o navegador.
const fs = require('node:fs');
const path = require('node:path');

// O Google Sheets converte sozinho o que parece data. Escrever a string
// "2026-11-23" numa célula devolve um objeto Date na leitura, e
// String(date) nunca é igual a "2026-11-23". A planilha falsa precisa
// mentir igual, senão o teste passa e o app quebra.
//
// E o Date criado é a meia-noite NO FUSO DA PLANILHA, não no fuso de quem
// está rodando — detalhe que decide se o dia volta certo ou um dia atrás.
function partesEm(d, tz) {
  const o = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).forEach(p => { o[p.type] = Number(p.value); });
  return o;
}

function instanteNoFuso(y, mo, d, h, mi, tz) {
  const alvo = Date.UTC(y, mo - 1, d, h, mi);
  let t = alvo;
  for (let i = 0; i < 3; i++) {
    const p = partesEm(new Date(t), tz);
    const obtido = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (obtido === alvo) break;
    t += alvo - obtido;
  }
  return new Date(t);
}

function fabricarComoSheets(tz) {
  return v => {
    if (typeof v !== 'string') return v;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return instanteNoFuso(+m[1], +m[2], +m[3], 0, 0, tz);
    m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(v);
    if (m) return instanteNoFuso(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
    return v;
  };
}

function criarAba(nome, comoSheets, contador) {
  const linhas = [];
  const validacoes = [];
  const conta = k => { if (contador) contador[k] = (contador[k] || 0) + 1; };
  const faixa = (r, c, nr, nc) => ({
    setValues(vals) {
      conta('escritas');
      for (let i = 0; i < vals.length; i++) {
        const alvo = r - 1 + i;
        while (linhas.length <= alvo) linhas.push([]);
        const linha = linhas[alvo];
        for (let j = 0; j < vals[i].length; j++) linha[c - 1 + j] = comoSheets(vals[i][j]);
      }
      return this;
    },
    setValue(v) { return this.setValues([[v]]); },
    getValues() {
      conta('leituras');
      const saida = [];
      for (let i = 0; i < nr; i++) saida.push((linhas[r - 1 + i] || []).slice(c - 1, c - 1 + nc));
      return saida;
    },
    setFontWeight() { return this; },
    setDataValidation(regra) { validacoes.push({ r, c, nr, regra }); return this; },
  });

  return {
    _linhas: linhas,
    _validacoes: validacoes,
    getName: () => nome,
    getLastRow: () => linhas.length,
    getLastColumn: () => linhas.reduce((m, l) => Math.max(m, l.length), 0),
    setFrozenRows() { return this; },
    appendRow(arr) { conta('escritas'); linhas.push(arr.map(comoSheets)); return this; },
    deleteRows(inicio, quantidade) { linhas.splice(inicio - 1, quantidade); return this; },
    getRange(r, c, nr, nc) { return faixa(r, c, nr ?? 1, nc ?? 1); },
    getDataRange() {
      const largura = linhas.reduce((m, l) => Math.max(m, l.length), 0);
      return {
        getValues: () => (conta('leituras'), linhas.map(l => {
          const copia = l.slice();
          while (copia.length < largura) copia.push('');
          return copia;
        })),
      };
    },
  };
}

function criarAmbiente({ fuso = 'America/Sao_Paulo' } = {}) {
  const comoSheets = fabricarComoSheets(fuso);
  const contador = { leituras: 0, escritas: 0 };
  const abas = new Map();
  // Planilha nova de verdade vem com a aba padrão.
  abas.set('Página1', criarAba('Página1', comoSheets, contador));

  const planilha = {
    getName: () => 'Planilha sem título',
    getSpreadsheetTimeZone: () => fuso,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/falsa/edit',
    // Reproduz o erro que apareceu em produção: numa planilha recém-criada,
    // getSheetByName() estourou "Planilha 0 não encontrada". O código não pode
    // mais depender dela — se voltar a usar, os testes quebram aqui.
    getSheetByName() { throw new Error('Planilha 0 não encontrada'); },
    insertSheet(n) { const a = criarAba(n, comoSheets, contador); abas.set(n, a); return a; },
    getSheets: () => [...abas.values()],
    deleteSheet(a) { abas.delete(a.getName()); },
  };

  const alertas = [];
  const partes = (d, tz) => {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const o = {};
    f.forEach(p => { o[p.type] = p.value; });
    return o;
  };

  const ambiente = {
    SpreadsheetApp: {
      getActive: () => planilha,
      getUi: () => ({ alert: m => { alertas.push(m); } }),
      newDataValidation: () => {
        const regra = { valores: null };
        const b = {
          requireValueInList(v) { regra.valores = v; return b; },
          setAllowInvalid() { return b; },
          build: () => regra,
        };
        return b;
      },
    },
    Utilities: {
      formatDate(d, tz, fmt) {
        const p = partes(d, tz);
        const data = `${p.year}-${p.month}-${p.day}`;
        return fmt.indexOf('HH') >= 0 ? `${data} ${p.hour}:${p.minute}` : data;
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: t => ({ _texto: t, setMimeType() { return this; }, getContent() { return this._texto; } }),
    },
    Logger: { log() {} },
    console,
    Math,
    Date,
    JSON,
    Object,
    Number,
    String,
    Array,
    Set,
    Error,
    Intl,
    _alertas: alertas,
    _abas: abas,
    _contador: contador,
    _fuso: fuso,
  };

  const fonte = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Codigo.gs'), 'utf8');
  const nomes = Object.keys(ambiente);
  const criar = new Function(...nomes, fonte + `
    return { instalar, doPost, doGet, config, ler, garantirDias, hojeLocal,
             inicioDaSemana, somarDias, escrever, anexar, saldoDe, diagnostico,
             procurarAba, consertar, novoId, ABAS };
  `);
  const api = criar(...nomes.map(n => ambiente[n]));

  /** Chama doPost como a página chamaria, e devolve o JSON já decodificado. */
  api.chamar = (corpo) =>
    JSON.parse(api.doPost({ postData: { contents: JSON.stringify(corpo) } }).getContent());

  api._ambiente = ambiente;
  return api;
}

module.exports = { criarAmbiente };
