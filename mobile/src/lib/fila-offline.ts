import AsyncStorage from '@react-native-async-storage/async-storage';
import { marcarFeita } from './api';

/**
 * Fila local de marcações.
 *
 * Ela vai marcar tarefa sem internet — no carro, na casa da avó. A marcação
 * não pode PARECER ter falhado. Então grava localmente, a interface mostra
 * como feita na hora, e a fila esvazia quando a rede volta.
 *
 * Conflito é praticamente impossível: uma linha por tarefa-dia, e o banco
 * rejeita marcar duas vezes. Se o servidor recusar por regra (fora do prazo,
 * já decidida), o item sai da fila — insistir não ajudaria.
 */

const CHAVE = 'fila-marcacoes-v1';

export type ItemDaFila = {
  ocorrenciaId: string;
  fotoPath?: string;
  enfileiradoEm: string;
};

async function ler(): Promise<ItemDaFila[]> {
  try {
    const bruto = await AsyncStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as ItemDaFila[]) : [];
  } catch {
    return [];
  }
}

async function gravar(itens: ItemDaFila[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, JSON.stringify(itens));
  } catch {
    // Armazenamento cheio ou indisponível: a marcação já foi para o servidor
    // ou será refeita no próximo toque. Não vale derrubar a tela por isso.
  }
}

export async function enfileirar(ocorrenciaId: string, fotoPath?: string): Promise<void> {
  const itens = await ler();
  if (itens.some((i) => i.ocorrenciaId === ocorrenciaId)) return;
  itens.push({ ocorrenciaId, fotoPath, enfileiradoEm: new Date().toISOString() });
  await gravar(itens);
}

export async function pendentes(): Promise<string[]> {
  return (await ler()).map((i) => i.ocorrenciaId);
}

/** Erro de regra do servidor (não vale reenviar) x erro de rede (vale). */
function eErroDeRegra(mensagem: string): boolean {
  const regras = [
    'já está', 'não é sua', 'passou do prazo', 'ainda não é o dia',
    'precisa de foto', 'não encontrada', 'fora da família',
  ];
  return regras.some((r) => mensagem.includes(r));
}

export type ResultadoDoFlush = { enviadas: number; descartadas: number; restantes: number };

export async function esvaziarFila(): Promise<ResultadoDoFlush> {
  const itens = await ler();
  if (itens.length === 0) return { enviadas: 0, descartadas: 0, restantes: 0 };

  const sobraram: ItemDaFila[] = [];
  let enviadas = 0;
  let descartadas = 0;

  for (const item of itens) {
    try {
      await marcarFeita(item.ocorrenciaId, item.fotoPath);
      enviadas++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (eErroDeRegra(msg)) {
        descartadas++;        // o servidor já decidiu; insistir não muda nada
      } else {
        sobraram.push(item);  // provavelmente rede: tenta de novo depois
      }
    }
  }

  await gravar(sobraram);
  return { enviadas, descartadas, restantes: sobraram.length };
}

/** Tenta enviar agora; se a rede falhar, enfileira e devolve false. */
export async function marcarComFila(
  ocorrenciaId: string, fotoPath?: string,
): Promise<{ sincronizado: boolean; erroDeRegra?: string }> {
  try {
    await marcarFeita(ocorrenciaId, fotoPath);
    return { sincronizado: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (eErroDeRegra(msg)) return { sincronizado: false, erroDeRegra: msg };
    await enfileirar(ocorrenciaId, fotoPath);
    return { sincronizado: false };
  }
}
