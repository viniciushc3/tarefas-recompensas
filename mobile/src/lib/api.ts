import { supabase } from './supabase';
import type {
  AllowanceTier, Balance, Family, LedgerEntry, Occurrence, Profile,
  Redemption, Reward, Task, WeeklyClosing,
} from './types';

function ok<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ------------------------------------------------------------------ perfil
export async function carregarProfile(userId: string): Promise<Profile> {
  return ok(await supabase.from('profiles').select('*').eq('id', userId).single());
}

export async function carregarFamilia(): Promise<Family> {
  return ok(await supabase.from('families').select('*').limit(1).single());
}

export async function carregarPerfis(): Promise<Profile[]> {
  return ok(await supabase.from('profiles').select('*').order('role'));
}

// ------------------------------------------------------------- ocorrências
/**
 * Chamada ao abrir o app. Gera um INTERVALO de dias para trás, não só hoje:
 * sem isso, os dias em que o app não foi aberto nunca geram ocorrência, o
 * denominador da mesada encolhe e o percentual sai inflado.
 */
export async function sincronizarDias(diasParaTras = 14): Promise<number> {
  return ok(await supabase.rpc('ensure_catch_up', { p_back_days: diasParaTras }));
}

export async function ocorrenciasDoPeriodo(de: string, ate: string): Promise<Occurrence[]> {
  return ok(
    await supabase
      .from('task_occurrences')
      .select('*')
      .gte('local_date', de)
      .lte('local_date', ate)
      .order('local_date', { ascending: false })
      .order('period_snapshot'),
  );
}

export async function marcarFeita(ocorrenciaId: string, fotoPath?: string): Promise<Occurrence> {
  return ok(
    await supabase.rpc('claim_occurrence', {
      p_id: ocorrenciaId,
      p_photo_path: fotoPath ?? null,
    }),
  );
}

export async function decidirOcorrencia(
  ocorrenciaId: string, aprovar: boolean, nota?: string,
): Promise<Occurrence> {
  return ok(
    await supabase.rpc('decide_occurrence', {
      p_id: ocorrenciaId, p_approve: aprovar, p_note: nota ?? null,
    }),
  );
}

/** A fila do pai: o que ela marcou e está esperando decisão. */
export async function filaDeAprovacao(): Promise<Occurrence[]> {
  return ok(
    await supabase
      .from('task_occurrences')
      .select('*')
      .eq('status', 'claimed')
      .order('claimed_at'),
  );
}

// ----------------------------------------------------------------- saldos
export async function carregarSaldo(profileId: string): Promise<Balance> {
  const linhas = ok<Balance[]>(
    await supabase.from('v_balances').select('*').eq('profile_id', profileId),
  );
  // Sem nenhum lançamento ainda a view não devolve linha: saldo zero.
  return linhas[0] ?? { profile_id: profileId, spendable: 0, savings: 0 };
}

export async function carregarExtrato(profileId: string, limite = 60): Promise<LedgerEntry[]> {
  return ok(
    await supabase
      .from('ledger_entries')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(limite),
  );
}

// ------------------------------------------------------------ recompensas
export async function carregarRecompensas(incluirInativas = false): Promise<Reward[]> {
  let q = supabase.from('rewards').select('*').order('sort_order');
  if (!incluirInativas) q = q.eq('active', true);
  return ok(await q);
}

export async function pedirResgate(rewardId: string): Promise<Redemption> {
  return ok(await supabase.rpc('request_redemption', { p_reward_id: rewardId }));
}

export async function cancelarResgate(id: string): Promise<Redemption> {
  return ok(await supabase.rpc('cancel_redemption', { p_id: id }));
}

export async function decidirResgate(id: string, aprovar: boolean): Promise<Redemption> {
  return ok(await supabase.rpc('decide_redemption', { p_id: id, p_approve: aprovar }));
}

/** Você liberou a tela de fato. */
export async function marcarEntregue(id: string): Promise<Redemption> {
  return ok(await supabase.rpc('fulfill_redemption', { p_id: id }));
}

export async function resgatesPendentes(): Promise<Redemption[]> {
  return ok(
    await supabase
      .from('redemptions')
      .select('*')
      .in('status', ['requested', 'approved'])
      .order('requested_at'),
  );
}

export async function resgatesDela(profileId: string, limite = 30): Promise<Redemption[]> {
  return ok(
    await supabase
      .from('redemptions')
      .select('*')
      .eq('profile_id', profileId)
      .order('requested_at', { ascending: false })
      .limit(limite),
  );
}

/**
 * O que ela fez para juntar os pontos deste resgate.
 *
 * Existe porque a liberação é manual e analisada: aprovar "30 min de tela" sem
 * ver as tarefas por trás é aprovar no escuro. Pega as ocorrências aprovadas
 * desde o resgate anterior dela.
 */
export async function tarefasPorTrasDoResgate(
  resgate: Redemption,
): Promise<{ desde: string | null; ocorrencias: Occurrence[] }> {
  const anteriores = ok<Redemption[]>(
    await supabase
      .from('redemptions')
      .select('*')
      .eq('profile_id', resgate.profile_id)
      .in('status', ['approved', 'fulfilled'])
      .lt('requested_at', resgate.requested_at)
      .order('requested_at', { ascending: false })
      .limit(1),
  );
  const desde = anteriores[0]?.requested_at ?? null;

  let q = supabase
    .from('task_occurrences')
    .select('*')
    .eq('profile_id', resgate.profile_id)
    .eq('status', 'approved')
    .lte('decided_at', resgate.requested_at)
    .order('decided_at', { ascending: false });
  if (desde) q = q.gt('decided_at', desde);

  return { desde, ocorrencias: ok<Occurrence[]>(await q) };
}

// ----------------------------------------------------------------- tarefas
export async function carregarTarefas(): Promise<Task[]> {
  return ok(await supabase.from('tasks').select('*').order('sort_order'));
}

export async function salvarTarefa(t: Partial<Task> & { id?: string }): Promise<Task> {
  if (t.id) {
    const { id, ...resto } = t;
    return ok(await supabase.from('tasks').update(resto).eq('id', id).select().single());
  }
  return ok(await supabase.from('tasks').insert(t).select().single());
}

export async function salvarRecompensa(r: Partial<Reward> & { id?: string }): Promise<Reward> {
  if (r.id) {
    const { id, ...resto } = r;
    return ok(await supabase.from('rewards').update(resto).eq('id', id).select().single());
  }
  return ok(await supabase.from('rewards').insert(r).select().single());
}

export async function ajustarPontos(
  profileId: string, gastavel: number, cofrinho: number, motivo: string,
): Promise<LedgerEntry> {
  return ok(
    await supabase.rpc('adjust_points', {
      p_profile_id: profileId, p_spendable: gastavel,
      p_savings: cofrinho, p_reason: motivo,
    }),
  );
}

// ------------------------------------------------------------------ mesada
export async function carregarFaixas(): Promise<AllowanceTier[]> {
  return ok(await supabase.from('allowance_tiers').select('*').order('min_pct'));
}

export async function fecharSemana(profileId: string, semana: string): Promise<WeeklyClosing> {
  return ok(await supabase.rpc('close_week', { p_profile_id: profileId, p_week_start: semana }));
}

export async function carregarFechamentos(profileId: string): Promise<WeeklyClosing[]> {
  return ok(
    await supabase
      .from('weekly_closings')
      .select('*')
      .eq('profile_id', profileId)
      .order('week_start', { ascending: false })
      .limit(12),
  );
}

export async function marcarSemanaPaga(id: string): Promise<WeeklyClosing> {
  return ok(
    await supabase
      .from('weekly_closings')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id).select().single(),
  );
}

// ------------------------------------------------------------------ fotos
export async function enviarFoto(
  profileId: string, ocorrenciaId: string, arquivo: ArrayBuffer,
): Promise<string> {
  // O caminho começa pelo profile_id: é o prefixo que a política do bucket exige.
  const caminho = `${profileId}/${ocorrenciaId}.jpg`;
  const { error } = await supabase.storage
    .from('provas')
    .upload(caminho, arquivo, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(error.message);
  return caminho;
}

export async function urlDaFoto(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage.from('provas').createSignedUrl(caminho, 60 * 10);
  return data?.signedUrl ?? null;
}
