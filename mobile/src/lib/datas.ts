// Datas SEMPRE no fuso da família, nunca no do aparelho e nunca em UTC.
// Indexar o dia por timestamp é a origem clássica do bug "a tarefa pulou de dia".

/** 'YYYY-MM-DD' de hoje no fuso dado. en-CA devolve exatamente nesse formato. */
export function hojeNoFuso(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Soma dias a uma data 'YYYY-MM-DD' sem passar por Date local. */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(a, m - 1, d) + dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data 'YYYY-MM-DD'. Casa com date_trunc('week') do Postgres. */
export function inicioDaSemana(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0=dom
  return somarDias(iso, dow === 0 ? -6 : 1 - dow);
}

export function diferencaEmDias(de: string, para: string): number {
  const p = (s: string) => {
    const [a, m, d] = s.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((p(para) - p(de)) / 86400000);
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "hoje", "ontem", ou "quarta, 19/11" — o que ela entende sem pensar. */
export function rotuloDoDia(iso: string, hoje: string): string {
  const delta = diferencaEmDias(iso, hoje);
  if (delta === 0) return 'hoje';
  if (delta === 1) return 'ontem';
  const [a, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS[dow]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Minutos de tela que um saldo compra, dado o preço por minuto do catálogo. */
export function minutosEquivalentes(pontos: number, pontosPorMinuto: number): number {
  if (pontosPorMinuto <= 0) return 0;
  return Math.floor(pontos / pontosPorMinuto);
}
