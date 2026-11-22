// Planilha de mentira, em memória, com o bastante do Apps Script para rodar
// Codigo.gs de verdade fora do Google. É o que permite testar instalar(),
// marcar, aprovar e resgatar sem abrir o navegador.
const fs = require('node:fs');
const path = require('node:path');

function criarAba(nome) {
  const linhas = [];
  const faixa = (r, c, nr, nc) => ({
    setValues(vals) {
      for (let i = 0; i < vals.length; i++) {
        const alvo = r - 1 + i;
        while (linhas.length <= alvo) linhas.push([]);
        const linha = linhas[alvo];
        for (let j = 0; j < vals[i].length; j++) linha[c - 1 + j] = vals[i][j];
      }
      return this;
    },
    setValue(v) { return this.setValues([[v]]); },
    getValues() {
      const saida = [];
      for (let i = 0; i < nr; i++) saida.push((linhas[r - 1 + i] || []).slice(c - 1, c - 1 + nc));
      return saida;
    },
    setFontWeight() { return this; },
  });

  return {
    _linhas: linhas,
    getName: () => nome,
    getLastRow: () => linhas.length,
    setFrozenRows() { return this; },
    appendRow(arr) { linhas.push(arr.slice()); return this; },
    getRange(r, c, nr, nc) { return faixa(r, c, nr ?? 1, nc ?? 1); },
    getDataRange() {
      const largura = linhas.reduce((m, l) => Math.max(m, l.length), 0);
      return {
        getValues: () => linhas.map(l => {
          const copia = l.slice();
          while (copia.length < largura) copia.push('');
          return copia;
        }),
      };
    },
  };
}

function criarAmbiente({ fuso = 'America/Sao_Paulo' } = {}) {
  const abas = new Map();
  // Planilha nova de verdade vem com a aba padrão.
  abas.set('Página1', criarAba('Página1'));

  const planilha = {
    getName: () => 'Planilha sem título',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/falsa/edit',
    // Reproduz o erro que apareceu em produção: numa planilha recém-criada,
    // getSheetByName() estourou "Planilha 0 não encontrada". O código não pode
    // mais depender dela — se voltar a usar, os testes quebram aqui.
    getSheetByName() { throw new Error('Planilha 0 não encontrada'); },
    insertSheet(n) { const a = criarAba(n); abas.set(n, a); return a; },
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
    _fuso: fuso,
  };

  const fonte = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Codigo.gs'), 'utf8');
  const nomes = Object.keys(ambiente);
  const criar = new Function(...nomes, fonte + `
    return { instalar, doPost, doGet, config, ler, garantirDias, hojeLocal,
             inicioDaSemana, somarDias, escrever, anexar, saldoDe, diagnostico,
             procurarAba, ABAS };
  `);
  const api = criar(...nomes.map(n => ambiente[n]));

  /** Chama doPost como a página chamaria, e devolve o JSON já decodificado. */
  api.chamar = (corpo) =>
    JSON.parse(api.doPost({ postData: { contents: JSON.stringify(corpo) } }).getContent());

  api._ambiente = ambiente;
  return api;
}

module.exports = { criarAmbiente };
