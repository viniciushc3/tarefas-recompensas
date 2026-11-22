import { diferencaEmDias, somarDias } from './datas';
import type { Occurrence } from './types';

/**
 * Um dia está "completo" quando tem pelo menos uma tarefa que conta para a
 * mesada e TODAS elas foram aprovadas.
 */
export function diaCompleto(ocorrencias: Occurrence[]): boolean {
  const elegiveis = ocorrencias.filter((o) => o.counts_for_allowance_snapshot);
  return elegiveis.length > 0 && elegiveis.every((o) => o.status === 'approved');
}

export function agruparPorDia(ocorrencias: Occurrence[]): Map<string, Occurrence[]> {
  const mapa = new Map<string, Occurrence[]>();
  for (const o of ocorrencias) {
    const lista = mapa.get(o.local_date);
    if (lista) lista.push(o);
    else mapa.set(o.local_date, [o]);
  }
  return mapa;
}

/**
 * Dias completos consecutivos.
 *
 * Começa de ontem quando hoje ainda não está completo: às 9h da manhã o dia
 * naturalmente não está fechado, e zerar o streak nessa hora puniria ela por
 * acordar. Hoje completo entra e soma.
 */
export function calcularStreak(ocorrencias: Occurrence[], hoje: string): number {
  const porDia = agruparPorDia(ocorrencias);
  const hojeFechado = diaCompleto(porDia.get(hoje) ?? []);

  let dia = hojeFechado ? hoje : somarDias(hoje, -1);
  let total = 0;

  while (porDia.has(dia)) {
    if (!diaCompleto(porDia.get(dia) ?? [])) break;
    total++;
    dia = somarDias(dia, -1);
  }
  return total;
}

export type ResumoDaSemana = {
  elegiveis: number;
  aprovadas: number;
  pct: number;
  /** Dias que ainda podem virar aprovação, para não dar a semana por perdida cedo. */
  emAberto: number;
};

/** Mesmo cálculo de close_week(), para a interface mostrar antes do fechamento. */
export function resumoDaSemana(
  ocorrencias: Occurrence[], inicioSemana: string,
): ResumoDaSemana {
  const naSemana = ocorrencias.filter((o) => {
    const d = diferencaEmDias(inicioSemana, o.local_date);
    return d >= 0 && d < 7 && o.counts_for_allowance_snapshot;
  });
  const aprovadas = naSemana.filter((o) => o.status === 'approved').length;
  const emAberto = naSemana.filter((o) => o.status === 'pending' || o.status === 'claimed').length;
  const pct = naSemana.length === 0 ? 0 : Math.round((100 * aprovadas) / naSemana.length);
  return { elegiveis: naSemana.length, aprovadas, pct, emAberto };
}

/** Faixa de mesada que um percentual alcança. */
export function faixaAlcancada<T extends { min_pct: number }>(faixas: T[], pct: number): T | null {
  const ordenadas = [...faixas].sort((a, b) => b.min_pct - a.min_pct);
  return ordenadas.find((f) => f.min_pct <= pct) ?? null;
}

/** Próxima faixa acima, para mostrar "faltam X tarefas para R$ Y". */
export function proximaFaixa<T extends { min_pct: number }>(faixas: T[], pct: number): T | null {
  return [...faixas].sort((a, b) => a.min_pct - b.min_pct).find((f) => f.min_pct > pct) ?? null;
}

/**
 * Quantas tarefas faltam para alcançar um percentual, considerando o que ainda
 * está em aberto. Devolve null quando a faixa já é inalcançável nesta semana.
 */
export function tarefasParaAlcancar(resumo: ResumoDaSemana, metaPct: number): number | null {
  const { elegiveis, aprovadas, emAberto } = resumo;
  if (elegiveis === 0) return null;
  const necessarias = Math.ceil((metaPct * elegiveis) / 100) - aprovadas;
  if (necessarias <= 0) return 0;
  return necessarias <= emAberto ? necessarias : null;
}

/** Preço médio por minuto de tela no catálogo, para traduzir saldo em minutos. */
export function pontosPorMinutoDeTela(
  recompensas: { kind: string; cost_points: number; screen_minutes: number | null }[],
): number {
  const telas = recompensas.filter((r) => r.kind === 'screen_time' && (r.screen_minutes ?? 0) > 0);
  if (telas.length === 0) return 0;
  const taxas = telas.map((r) => r.cost_points / (r.screen_minutes as number));
  return Math.min(...taxas);
}
