// Espelha supabase/migrations/0001_init.sql.
// Os campos *_snapshot são o que valia no dia em que a ocorrência nasceu:
// mudar o preço de uma tarefa hoje não reescreve o histórico de ontem.

export type Role = 'parent' | 'child';
export type TaskKind = 'basic' | 'extra';
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Recurrence = 'daily' | 'weekdays' | 'weekend' | 'custom' | 'once';
export type OccurrenceStatus = 'pending' | 'claimed' | 'approved' | 'rejected' | 'expired';
export type LedgerKind = 'earn' | 'spend' | 'adjust' | 'refund';
export type RewardKind = 'screen_time' | 'privilege' | 'big_prize';
export type Bucket = 'spendable' | 'savings';
export type RedemptionStatus = 'requested' | 'approved' | 'rejected' | 'fulfilled' | 'canceled';
export type ClosingStatus = 'open' | 'closed' | 'paid';

export type Family = {
  id: string;
  name: string;
  timezone: string;
  savings_rate: number;
  late_window_days: number;
  daily_screen_cap_minutes: number;
};

export type Profile = {
  id: string;
  family_id: string;
  display_name: string;
  role: Role;
  avatar_emoji: string;
};

export type Task = {
  id: string;
  family_id: string;
  assignee_id: string | null;
  title: string;
  icon: string | null;
  kind: TaskKind;
  points: number;
  period: DayPeriod;
  recurrence: Recurrence;
  days_of_week: number[] | null;
  once_on: string | null;
  requires_approval: boolean;
  requires_photo: boolean;
  counts_for_allowance: boolean;
  sort_order: number;
  active: boolean;
  created_at: string;
  archived_at: string | null;
};

export type Occurrence = {
  id: string;
  family_id: string;
  task_id: string;
  profile_id: string;
  local_date: string;
  status: OccurrenceStatus;
  title_snapshot: string;
  icon_snapshot: string | null;
  points_snapshot: number;
  kind_snapshot: TaskKind;
  counts_for_allowance_snapshot: boolean;
  requires_approval_snapshot: boolean;
  requires_photo_snapshot: boolean;
  period_snapshot: DayPeriod;
  claimed_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  photo_path: string | null;
  note: string | null;
};

export type Reward = {
  id: string;
  family_id: string;
  title: string;
  icon: string | null;
  kind: RewardKind;
  bucket: Bucket;
  cost_points: number;
  screen_minutes: number | null;
  photo_path: string | null;
  active: boolean;
  sort_order: number;
};

export type Redemption = {
  id: string;
  family_id: string;
  reward_id: string;
  profile_id: string;
  status: RedemptionStatus;
  title_snapshot: string;
  cost_snapshot: number;
  bucket_snapshot: Bucket;
  screen_minutes_snapshot: number | null;
  requested_at: string;
  decided_at: string | null;
  fulfilled_at: string | null;
};

export type LedgerEntry = {
  id: string;
  profile_id: string;
  kind: LedgerKind;
  spendable_delta: number;
  savings_delta: number;
  reason: string;
  occurrence_id: string | null;
  redemption_id: string | null;
  created_at: string;
};

export type Balance = { profile_id: string; spendable: number; savings: number };

export type AllowanceTier = {
  id: string;
  family_id: string;
  min_pct: number;
  amount_cents: number;
  label: string | null;
};

export type WeeklyClosing = {
  id: string;
  profile_id: string;
  week_start: string;
  eligible_count: number;
  approved_count: number;
  pct: number;
  tier_min_pct: number | null;
  amount_cents: number;
  status: ClosingStatus;
  closed_at: string | null;
  paid_at: string | null;
};

export const PERIOD_LABEL: Record<DayPeriod, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
  anytime: 'Qualquer hora',
};

export const PERIOD_ORDER: DayPeriod[] = ['morning', 'afternoon', 'evening', 'anytime'];
