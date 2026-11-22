-- =====================================================================
-- Tarefas & Recompensas — esquema inicial
--
-- Princípios:
--  1. O extrato de pontos é imutável: nada de UPDATE em saldo. Saldo = soma.
--  2. Toda ocorrência guarda um snapshot do preço/natureza da tarefa, para
--     que mudar a tarefa hoje não reescreva o histórico de ontem.
--  3. A filha NÃO escreve direto em nenhuma tabela. Todo o que ela pode
--     fazer passa por 3 funções (claim / request_redemption / cancel).
--  4. Nada de cron: o dia é gerado sob demanda, de forma idempotente.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists app;

-- ------------------------------------------------------------------ tipos
create type profile_role      as enum ('parent','child');
create type task_kind         as enum ('basic','extra');
create type day_period        as enum ('morning','afternoon','evening','anytime');
create type recurrence        as enum ('daily','weekdays','weekend','custom','once');
create type occurrence_status as enum ('pending','claimed','approved','rejected','expired');
create type ledger_kind       as enum ('earn','spend','adjust','refund');
create type reward_kind       as enum ('screen_time','privilege','big_prize');
create type bucket            as enum ('spendable','savings');
create type redemption_status as enum ('requested','approved','rejected','fulfilled','canceled');
create type closing_status    as enum ('open','closed','paid');

-- --------------------------------------------------------------- família
create table families (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  timezone                 text not null default 'America/Sao_Paulo',
  -- fração de cada ganho que vai para o cofrinho (0.30 = o 70/30)
  savings_rate             numeric(4,3) not null default 0.300
                             check (savings_rate >= 0 and savings_rate <= 1),
  -- por quantos dias ela ainda pode marcar uma tarefa esquecida
  late_window_days         int not null default 2 check (late_window_days between 0 and 7),
  -- teto diário de tela, usado só para calibrar preços na interface do pai
  daily_screen_cap_minutes int not null default 40,
  created_at               timestamptz not null default now()
);

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  family_id    uuid not null references families(id) on delete cascade,
  display_name text not null,
  role         profile_role not null,
  avatar_emoji text not null default '🙂',
  created_at   timestamptz not null default now()
);
create index profiles_family_idx on profiles (family_id);

-- ------------------------------------------------- helpers para o RLS
-- SECURITY DEFINER para não cair em recursão de política ao ler profiles.
create or replace function app.current_family_id() returns uuid
  language sql stable security definer set search_path = public, pg_temp as
$$ select family_id from profiles where id = auth.uid() $$;

create or replace function app.is_parent() returns boolean
  language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select role = 'parent' from profiles where id = auth.uid()), false) $$;

create or replace function app.local_today(p_family uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as
$$ select (now() at time zone (select timezone from families where id = p_family))::date $$;

grant usage on schema app to authenticated;

-- --------------------------------------------------------------- tarefas
create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  family_id            uuid not null references families(id) on delete cascade,
  -- null = vale para qualquer filho da família
  assignee_id          uuid references profiles(id) on delete cascade,
  title                text not null,
  icon                 text,
  -- 'basic' = dever de casa: por padrão não paga pontos, mas conta para a
  -- mesada e para o streak. 'extra' = paga pontos.
  kind                 task_kind not null default 'extra',
  points               int not null default 0 check (points >= 0),
  period               day_period not null default 'anytime',
  recurrence           recurrence not null default 'daily',
  days_of_week         int[],              -- 0=dom .. 6=sáb, quando recurrence='custom'
  once_on              date,               -- quando recurrence='once'
  requires_approval    boolean not null default false,
  requires_photo       boolean not null default false,
  counts_for_allowance boolean not null default true,
  sort_order           int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  archived_at          timestamptz,
  constraint custom_needs_days check (
    recurrence <> 'custom' or (days_of_week is not null and array_length(days_of_week,1) > 0)),
  constraint once_needs_date check (recurrence <> 'once' or once_on is not null),
  -- foto sem aprovação não faz sentido: alguém tem de olhar a foto
  constraint photo_implies_approval check (not requires_photo or requires_approval)
);
create index tasks_family_idx on tasks (family_id) where active;

-- ----------------------------------------------- ocorrências (tarefa-dia)
create table task_occurrences (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id) on delete cascade,
  task_id    uuid not null references tasks(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  -- data LOCAL, nunca timestamp: é o que evita a tarefa pular de dia
  local_date date not null,
  status     occurrence_status not null default 'pending',

  -- snapshots: o que valia no dia em que a ocorrência nasceu
  title_snapshot                text        not null,
  icon_snapshot                 text,
  points_snapshot               int         not null,
  kind_snapshot                 task_kind   not null,
  counts_for_allowance_snapshot boolean     not null,
  requires_approval_snapshot    boolean     not null,
  requires_photo_snapshot       boolean     not null,
  period_snapshot               day_period  not null,

  claimed_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references profiles(id),
  photo_path text,
  note       text,
  created_at timestamptz not null default now(),
  unique (task_id, profile_id, local_date)
);
create index occ_day_idx    on task_occurrences (family_id, local_date);
create index occ_status_idx on task_occurrences (family_id, status) where status = 'claimed';

-- ------------------------------------------------------------ recompensas
create table rewards (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families(id) on delete cascade,
  title          text not null,
  icon           text,
  kind           reward_kind not null,
  bucket         bucket not null default 'spendable',
  cost_points    int not null check (cost_points > 0),
  screen_minutes int,
  photo_path     text,
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  constraint screen_needs_minutes check (kind <> 'screen_time' or screen_minutes is not null),
  -- prêmio grande só sai do cofrinho; é isso que impede de gastar a poupança em tela
  constraint big_prize_uses_savings check (kind <> 'big_prize' or bucket = 'savings')
);

create table redemptions (
  id                      uuid primary key default gen_random_uuid(),
  family_id               uuid not null references families(id) on delete cascade,
  reward_id               uuid not null references rewards(id),
  profile_id              uuid not null references profiles(id) on delete cascade,
  status                  redemption_status not null default 'requested',
  title_snapshot          text not null,
  cost_snapshot           int not null,
  bucket_snapshot         bucket not null,
  screen_minutes_snapshot int,
  requested_at            timestamptz not null default now(),
  decided_at              timestamptz,
  decided_by              uuid references profiles(id),
  fulfilled_at            timestamptz
);
create index redemptions_pending_idx on redemptions (family_id, status);

-- ---------------------------------------------------- extrato (imutável)
create table ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  kind            ledger_kind not null,
  spendable_delta int not null default 0,
  savings_delta   int not null default 0,
  reason          text not null,
  occurrence_id   uuid references task_occurrences(id) on delete set null,
  redemption_id   uuid references redemptions(id) on delete set null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint not_empty check (spendable_delta <> 0 or savings_delta <> 0)
);
create index ledger_profile_idx on ledger_entries (profile_id, created_at desc);
-- trava de crédito duplo: uma ocorrência paga no máximo uma vez
create unique index ledger_one_earn_per_occurrence
  on ledger_entries (occurrence_id) where kind = 'earn' and occurrence_id is not null;

create view v_balances with (security_invoker = true) as
  select profile_id,
         coalesce(sum(spendable_delta), 0)::int as spendable,
         coalesce(sum(savings_delta),   0)::int as savings
    from ledger_entries
   group by profile_id;

-- ----------------------------------------------------------- mesada
create table allowance_tiers (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  min_pct      int  not null check (min_pct between 0 and 100),
  amount_cents int  not null check (amount_cents >= 0),
  label        text,
  unique (family_id, min_pct)
);

create table weekly_closings (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families(id) on delete cascade,
  profile_id     uuid not null references profiles(id) on delete cascade,
  week_start     date not null,              -- sempre segunda-feira
  eligible_count int  not null default 0,
  approved_count int  not null default 0,
  pct            int  not null default 0,
  tier_min_pct   int,
  amount_cents   int  not null default 0,
  status         closing_status not null default 'open',
  closed_at      timestamptz,
  paid_at        timestamptz,
  unique (profile_id, week_start)
);

-- =====================================================================
-- FUNÇÕES DE TRANSIÇÃO
-- Toda mudança de estado passa por aqui. É isso que permite negar
-- escrita direta para a filha sem precisar de políticas RLS acrobáticas.
-- =====================================================================

-- Credita uma ocorrência aprovada, aplicando a divisão 70/30.
-- O resto da divisão vai para o saldo gastável (a favor dela).
create or replace function app.credit_occurrence(p_occ task_occurrences)
  returns void language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_rate     numeric;
  v_savings  int;
  v_spend    int;
begin
  if p_occ.points_snapshot <= 0 then
    return;  -- tarefa básica: conta para mesada e streak, não gera lançamento
  end if;

  select savings_rate into v_rate from families where id = p_occ.family_id;
  v_savings := floor(p_occ.points_snapshot * v_rate)::int;
  v_spend   := p_occ.points_snapshot - v_savings;

  insert into ledger_entries (
    family_id, profile_id, kind, spendable_delta, savings_delta, reason, occurrence_id, created_by)
  values (
    p_occ.family_id, p_occ.profile_id, 'earn', v_spend, v_savings,
    p_occ.title_snapshot, p_occ.id, auth.uid())
  on conflict (occurrence_id) where kind = 'earn' and occurrence_id is not null
    do nothing;  -- idempotente: aprovar duas vezes não paga duas vezes
end $$;

-- ------------------------------------------------- geração do dia
-- Gera as ocorrências de UM dia. Idempotente via o unique (task, perfil, dia).
create or replace function app.generate_day(p_family uuid, p_date date)
  returns int language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_dow      int := extract(dow from p_date)::int;
  v_inserted int;
begin
  insert into task_occurrences (
    family_id, task_id, profile_id, local_date,
    title_snapshot, icon_snapshot, points_snapshot, kind_snapshot,
    counts_for_allowance_snapshot,
    requires_approval_snapshot, requires_photo_snapshot, period_snapshot)
  select t.family_id, t.id, c.id, p_date,
         t.title, t.icon, t.points, t.kind, t.counts_for_allowance,
         t.requires_approval, t.requires_photo, t.period
    from tasks t
    join profiles c
      on c.family_id = t.family_id
     and c.role = 'child'
     and (t.assignee_id is null or t.assignee_id = c.id)
   where t.family_id = p_family
     and t.active
     and t.archived_at is null
     -- não gera ocorrência para antes de a tarefa existir
     and p_date >= (t.created_at at time zone (select timezone from families where id = p_family))::date
     and (   t.recurrence = 'daily'
          or (t.recurrence = 'weekdays' and v_dow between 1 and 5)
          or (t.recurrence = 'weekend'  and v_dow in (0, 6))
          or (t.recurrence = 'custom'   and v_dow = any (t.days_of_week))
          or (t.recurrence = 'once'     and t.once_on = p_date))
  on conflict (task_id, profile_id, local_date) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- Expira o que passou da janela de atraso. Expirada conta como NÃO feita no
-- cálculo da mesada, que é o comportamento correto.
create or replace function app.expire_stale(p_family uuid) returns int
  language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_window  int;
  v_today   date := app.local_today(p_family);
  v_expired int;
begin
  select late_window_days into v_window from families where id = p_family;
  update task_occurrences
     set status = 'expired'
   where family_id = p_family
     and status = 'pending'
     and local_date < v_today - v_window;
  get diagnostics v_expired = row_count;
  return v_expired;
end $$;

-- O que o app chama ao abrir.
--
-- Gera um INTERVALO de dias, não só hoje. Isso importa: se ela ficar cinco
-- dias sem abrir o app, os dias no meio nunca teriam ocorrência, o
-- denominador da mesada ficaria menor e o percentual sairia inflado — ela
-- receberia mesada cheia por uma semana que não cumpriu. Gerando para trás,
-- o dia que ela não abriu nasce 'pending' e expira como não feito.
create or replace function public.ensure_catch_up(p_back_days int default 14)
  returns int language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_family uuid := app.current_family_id();
  v_today  date;
  v_back   int  := least(greatest(coalesce(p_back_days, 14), 0), 60);
  v_d      date;
  v_total  int  := 0;
begin
  if v_family is null then raise exception 'perfil sem família'; end if;
  v_today := app.local_today(v_family);

  v_d := v_today - v_back;
  while v_d <= v_today loop
    v_total := v_total + app.generate_day(v_family, v_d);
    v_d := v_d + 1;
  end loop;

  perform app.expire_stale(v_family);
  return v_total;
end $$;

-- Geração explícita de um dia específico (ex.: o pai cria uma tarefa avulsa
-- para hoje, ou quer preparar o dia seguinte). Só o responsável, e sem deixar
-- a filha gerar dias arbitrários para si mesma.
create or replace function public.ensure_day(p_date date default null)
  returns int language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_family uuid := app.current_family_id();
  v_today  date;
begin
  if v_family is null then raise exception 'perfil sem família'; end if;
  if not app.is_parent() then raise exception 'só o responsável gera dias'; end if;

  v_today := app.local_today(v_family);
  return app.generate_day(v_family, coalesce(p_date, v_today));
end $$;

-- ------------------------------------------------- filha marca a tarefa
-- Aceita 'pending' e 'rejected' (segunda chance) dentro da janela de atraso.
-- Sem aprovação necessária -> credita na hora, sem passar pela sua fila.
create or replace function public.claim_occurrence(p_id uuid, p_photo_path text default null)
  returns task_occurrences language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_occ    task_occurrences;
  v_today  date;
  v_window int;
  v_family uuid := app.current_family_id();
  v_uid    uuid := auth.uid();
begin
  -- Sem sessão não há nada a fazer aqui. A checagem é explícita porque
  -- 'algo <> NULL' resulta NULL e um IF com NULL NÃO dispara: comparar contra
  -- um current_family_id() nulo deixaria passar quem não está autenticado,
  -- e esta função é SECURITY DEFINER, ou seja, lê a linha ignorando o RLS.
  if v_family is null or v_uid is null then
    raise exception 'sem sessão';
  end if;

  select * into v_occ from task_occurrences where id = p_id;
  if not found then raise exception 'ocorrência não encontrada'; end if;

  if v_occ.family_id <> v_family then
    raise exception 'fora da família';
  end if;
  if v_occ.profile_id <> v_uid and not app.is_parent() then
    raise exception 'essa tarefa não é sua';
  end if;
  if v_occ.status not in ('pending', 'rejected') then
    raise exception 'tarefa já está %', v_occ.status;
  end if;

  select late_window_days into v_window from families where id = v_occ.family_id;
  v_today := app.local_today(v_occ.family_id);
  if v_occ.local_date > v_today then
    raise exception 'ainda não é o dia dessa tarefa';
  end if;
  if v_occ.local_date < v_today - v_window then
    raise exception 'passou do prazo para marcar essa tarefa';
  end if;
  if v_occ.requires_photo_snapshot and p_photo_path is null then
    raise exception 'essa tarefa precisa de foto';
  end if;

  update task_occurrences
     set status     = case when requires_approval_snapshot
                        then 'claimed'::occurrence_status
                        else 'approved'::occurrence_status end,
         claimed_at = now(),
         photo_path = coalesce(p_photo_path, photo_path),
         decided_at = case when requires_approval_snapshot then null else now() end
   where id = p_id
  returning * into v_occ;

  if v_occ.status = 'approved' then
    perform app.credit_occurrence(v_occ);
  end if;

  return v_occ;
end $$;

-- ------------------------------------------------- pai aprova ou rejeita
create or replace function public.decide_occurrence(
    p_id uuid, p_approve boolean, p_note text default null)
  returns task_occurrences language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_occ    task_occurrences;
  v_family uuid := app.current_family_id();
begin
  if v_family is null then raise exception 'sem sessão'; end if;
  if not app.is_parent() then raise exception 'só o responsável decide'; end if;

  select * into v_occ from task_occurrences where id = p_id;
  if not found then raise exception 'ocorrência não encontrada'; end if;
  if v_occ.family_id <> v_family then raise exception 'fora da família'; end if;
  if v_occ.status <> 'claimed' then
    raise exception 'nada a decidir: status %', v_occ.status;
  end if;

  update task_occurrences
     set status     = case when p_approve then 'approved'::occurrence_status
                              else 'rejected'::occurrence_status end,
         decided_at = now(),
         decided_by = auth.uid(),
         note       = coalesce(p_note, note)
   where id = p_id
  returning * into v_occ;

  if p_approve then
    perform app.credit_occurrence(v_occ);
  end if;

  return v_occ;
end $$;

-- ------------------------------------------------- resgate de recompensa
-- Reserva: debita no pedido e devolve na recusa. Evita o caso chato de
-- "aprovado mas sem saldo" quando ela pede duas coisas ao mesmo tempo.
create or replace function public.request_redemption(p_reward_id uuid)
  returns redemptions language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_reward    rewards;
  v_family    uuid := app.current_family_id();
  v_spendable int;
  v_savings   int;
  v_red       redemptions;
  v_uid       uuid := auth.uid();
begin
  if v_family is null or v_uid is null then raise exception 'sem sessão'; end if;

  select * into v_reward from rewards where id = p_reward_id;
  if not found or v_reward.family_id <> v_family then raise exception 'recompensa inválida'; end if;
  if not v_reward.active then raise exception 'recompensa indisponível'; end if;

  select coalesce(spendable, 0), coalesce(savings, 0)
    into v_spendable, v_savings
    from v_balances where profile_id = auth.uid();
  v_spendable := coalesce(v_spendable, 0);   -- sem lançamento nenhum: nenhuma linha
  v_savings   := coalesce(v_savings, 0);

  if v_reward.bucket = 'spendable' and v_spendable < v_reward.cost_points then
    raise exception 'faltam % pontos', v_reward.cost_points - v_spendable;
  end if;
  if v_reward.bucket = 'savings' and v_savings < v_reward.cost_points then
    raise exception 'faltam % pontos no cofrinho', v_reward.cost_points - v_savings;
  end if;

  insert into redemptions (
    family_id, reward_id, profile_id, title_snapshot, cost_snapshot,
    bucket_snapshot, screen_minutes_snapshot)
  values (
    v_family, v_reward.id, auth.uid(), v_reward.title, v_reward.cost_points,
    v_reward.bucket, v_reward.screen_minutes)
  returning * into v_red;

  insert into ledger_entries (
    family_id, profile_id, kind, spendable_delta, savings_delta, reason, redemption_id, created_by)
  values (
    v_family, auth.uid(), 'spend',
    case when v_reward.bucket = 'spendable' then -v_reward.cost_points else 0 end,
    case when v_reward.bucket = 'savings'   then -v_reward.cost_points else 0 end,
    v_reward.title, v_red.id, auth.uid());

  return v_red;
end $$;

create or replace function app.refund_redemption(p_red redemptions, p_reason text)
  returns void language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  insert into ledger_entries (
    family_id, profile_id, kind, spendable_delta, savings_delta, reason, redemption_id, created_by)
  values (
    p_red.family_id, p_red.profile_id, 'refund',
    case when p_red.bucket_snapshot = 'spendable' then  p_red.cost_snapshot else 0 end,
    case when p_red.bucket_snapshot = 'savings'   then  p_red.cost_snapshot else 0 end,
    p_reason, p_red.id, auth.uid());
end $$;

create or replace function public.decide_redemption(p_id uuid, p_approve boolean)
  returns redemptions language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_red    redemptions;
  v_family uuid := app.current_family_id();
begin
  if v_family is null then raise exception 'sem sessão'; end if;
  if not app.is_parent() then raise exception 'só o responsável decide'; end if;

  select * into v_red from redemptions where id = p_id;
  if not found or v_red.family_id <> v_family then
    raise exception 'resgate inválido';
  end if;
  if v_red.status <> 'requested' then raise exception 'resgate já está %', v_red.status; end if;

  update redemptions
     set status     = case when p_approve then 'approved'::redemption_status
                              else 'rejected'::redemption_status end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_id
  returning * into v_red;

  if not p_approve then
    perform app.refund_redemption(v_red, 'Resgate recusado: ' || v_red.title_snapshot);
  end if;

  return v_red;
end $$;

-- Ela pode desistir enquanto você não decidiu; os pontos voltam.
create or replace function public.cancel_redemption(p_id uuid)
  returns redemptions language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_red    redemptions;
  v_family uuid := app.current_family_id();
  v_uid    uuid := auth.uid();
begin
  if v_family is null or v_uid is null then raise exception 'sem sessão'; end if;

  select * into v_red from redemptions where id = p_id;
  if not found or v_red.family_id <> v_family then
    raise exception 'resgate inválido';
  end if;
  if v_red.profile_id <> v_uid and not app.is_parent() then
    raise exception 'esse resgate não é seu';
  end if;
  if v_red.status <> 'requested' then raise exception 'resgate já está %', v_red.status; end if;

  update redemptions set status = 'canceled', decided_at = now()
   where id = p_id returning * into v_red;

  perform app.refund_redemption(v_red, 'Resgate cancelado: ' || v_red.title_snapshot);
  return v_red;
end $$;

-- Marca a recompensa como efetivamente entregue (você liberou a tela etc.)
create or replace function public.fulfill_redemption(p_id uuid)
  returns redemptions language plpgsql security definer set search_path = public, pg_temp as
$$
declare v_red redemptions;
begin
  if app.current_family_id() is null then raise exception 'sem sessão'; end if;
  if not app.is_parent() then raise exception 'só o responsável entrega'; end if;
  update redemptions set status = 'fulfilled', fulfilled_at = now()
   where id = p_id and family_id = app.current_family_id() and status = 'approved'
  returning * into v_red;
  if not found then raise exception 'resgate não está aprovado'; end if;
  return v_red;
end $$;

-- ------------------------------------------------- ajuste manual do pai
-- O jeito certo de corrigir um erro: um lançamento novo, nunca editar o
-- histórico. Aceita valor negativo.
create or replace function public.adjust_points(
    p_profile_id uuid, p_spendable int, p_savings int, p_reason text)
  returns ledger_entries language plpgsql security definer set search_path = public, pg_temp as
$$
declare v_entry ledger_entries;
begin
  if app.current_family_id() is null then raise exception 'sem sessão'; end if;
  if not app.is_parent() then raise exception 'só o responsável ajusta'; end if;
  if coalesce(p_spendable, 0) = 0 and coalesce(p_savings, 0) = 0 then
    raise exception 'ajuste vazio';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ajuste precisa de motivo'; end if;
  if not exists (select 1 from profiles
                  where id = p_profile_id and family_id = app.current_family_id()) then
    raise exception 'perfil fora da família';
  end if;

  insert into ledger_entries (
    family_id, profile_id, kind, spendable_delta, savings_delta, reason, created_by)
  values (
    app.current_family_id(), p_profile_id, 'adjust',
    coalesce(p_spendable, 0), coalesce(p_savings, 0), p_reason, auth.uid())
  returning * into v_entry;

  return v_entry;
end $$;

-- ------------------------------------------------- fechamento da semana
-- Elegível = ocorrências da semana marcadas como contando para a mesada.
-- Aprovada conta; pendente, recusada, expirada ou ainda em análise não contam.
create or replace function public.close_week(p_profile_id uuid, p_week_start date default null)
  returns weekly_closings language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  v_family   uuid := app.current_family_id();
  v_week     date;
  v_eligible int;
  v_approved int;
  v_pct      int;
  v_tier     allowance_tiers;
  v_closing  weekly_closings;
  v_i        int;
begin
  if v_family is null then raise exception 'sem sessão'; end if;
  if not app.is_parent() then raise exception 'só o responsável fecha a semana'; end if;

  v_week := date_trunc('week', coalesce(p_week_start, app.local_today(v_family)))::date;

  -- garante que todos os dias da semana existem antes de contar
  for v_i in 0..6 loop
    perform app.generate_day(v_family, v_week + v_i);
  end loop;
  perform app.expire_stale(v_family);

  select count(*) filter (where counts_for_allowance_snapshot),
         count(*) filter (where counts_for_allowance_snapshot and status = 'approved')
    into v_eligible, v_approved
    from task_occurrences
   where family_id  = v_family
     and profile_id = p_profile_id
     and local_date >= v_week
     and local_date <  v_week + 7;

  v_pct := case when v_eligible = 0 then 0
                else round(100.0 * v_approved / v_eligible)::int end;

  select * into v_tier from allowance_tiers
   where family_id = v_family and min_pct <= v_pct
   order by min_pct desc limit 1;

  insert into weekly_closings (
    family_id, profile_id, week_start, eligible_count, approved_count,
    pct, tier_min_pct, amount_cents, status, closed_at)
  values (
    v_family, p_profile_id, v_week, v_eligible, v_approved,
    v_pct, v_tier.min_pct, coalesce(v_tier.amount_cents, 0), 'closed', now())
  on conflict (profile_id, week_start) do update
    set eligible_count = excluded.eligible_count,
        approved_count = excluded.approved_count,
        pct            = excluded.pct,
        tier_min_pct   = excluded.tier_min_pct,
        amount_cents   = excluded.amount_cents,
        status         = 'closed',
        closed_at      = now()
    where weekly_closings.status <> 'paid'   -- semana paga não se reescreve
  returning * into v_closing;

  if v_closing.id is null then
    raise exception 'semana já foi paga e não pode ser recalculada';
  end if;
  return v_closing;
end $$;

-- =====================================================================
-- RLS
-- Regra de ouro: a filha LÊ tudo da família e ESCREVE em nada.
-- A superfície de escrita dela são 3 funções: claim_occurrence,
-- request_redemption e cancel_redemption. Não é paranoia com uma criança
-- de 9 anos — é que um APK pode ser inspecionado, e aos 11 com um amigo
-- esperto a história muda.
-- =====================================================================

alter table families        enable row level security;
alter table profiles        enable row level security;
alter table tasks           enable row level security;
alter table task_occurrences enable row level security;
alter table rewards         enable row level security;
alter table redemptions     enable row level security;
alter table ledger_entries  enable row level security;
alter table allowance_tiers enable row level security;
alter table weekly_closings enable row level security;

-- família
create policy families_read on families
  for select to authenticated using (id = app.current_family_id());
create policy families_parent_update on families
  for update to authenticated using (id = app.current_family_id() and app.is_parent())
  with check (id = app.current_family_id() and app.is_parent());

-- perfis: leitura na família, cada um edita o próprio, pai edita todos
create policy profiles_read on profiles
  for select to authenticated using (family_id = app.current_family_id());
create policy profiles_update_self on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_parent_write on profiles
  for all to authenticated using (family_id = app.current_family_id() and app.is_parent())
  with check (family_id = app.current_family_id() and app.is_parent());

-- tarefas, recompensas, faixas de mesada: leitura geral, escrita só do pai
create policy tasks_read on tasks
  for select to authenticated using (family_id = app.current_family_id());
create policy tasks_parent_write on tasks
  for all to authenticated using (family_id = app.current_family_id() and app.is_parent())
  with check (family_id = app.current_family_id() and app.is_parent());

create policy rewards_read on rewards
  for select to authenticated using (family_id = app.current_family_id());
create policy rewards_parent_write on rewards
  for all to authenticated using (family_id = app.current_family_id() and app.is_parent())
  with check (family_id = app.current_family_id() and app.is_parent());

create policy tiers_read on allowance_tiers
  for select to authenticated using (family_id = app.current_family_id());
create policy tiers_parent_write on allowance_tiers
  for all to authenticated using (family_id = app.current_family_id() and app.is_parent())
  with check (family_id = app.current_family_id() and app.is_parent());

-- ocorrências e resgates: SOMENTE LEITURA para todo mundo.
-- Não existe política de escrita de propósito: quem escreve são as funções.
create policy occurrences_read on task_occurrences
  for select to authenticated using (family_id = app.current_family_id());

create policy redemptions_read on redemptions
  for select to authenticated using (family_id = app.current_family_id());

-- extrato: leitura na família, escrita por ninguém. Imutável por construção.
create policy ledger_read on ledger_entries
  for select to authenticated using (family_id = app.current_family_id());

-- fechamento semanal: leitura geral; o pai marca como pago
create policy closings_read on weekly_closings
  for select to authenticated using (family_id = app.current_family_id());
create policy closings_parent_write on weekly_closings
  for all to authenticated using (family_id = app.current_family_id() and app.is_parent())
  with check (family_id = app.current_family_id() and app.is_parent());

-- --------------------------------------------------------------- grants
-- Revogar de 'anon' não basta: funções nascem executáveis por PUBLIC, e anon
-- herda disso. Revogamos de PUBLIC e devolvemos só para authenticated.
revoke all on all functions in schema public from public, anon;

grant execute on function public.ensure_catch_up(int)                    to authenticated;
grant execute on function public.ensure_day(date)                        to authenticated;
grant execute on function public.claim_occurrence(uuid, text)            to authenticated;
grant execute on function public.decide_occurrence(uuid, boolean, text)  to authenticated;
grant execute on function public.request_redemption(uuid)                to authenticated;
grant execute on function public.decide_redemption(uuid, boolean)        to authenticated;
grant execute on function public.cancel_redemption(uuid)                 to authenticated;
grant execute on function public.fulfill_redemption(uuid)                to authenticated;
grant execute on function public.adjust_points(uuid, int, int, text)     to authenticated;
grant execute on function public.close_week(uuid, date)                  to authenticated;

-- ------------------------------------------- privilégios de tabela
-- O Supabase aplica ALTER DEFAULT PRIVILEGES concedendo ALL em tabelas novas
-- para anon/authenticated. Revogamos e devolvemos só o necessário, para que o
-- RLS não seja a única linha de defesa e nada dependa do estado do painel.
revoke all on all tables in schema public from anon, authenticated;

grant select on
  families, profiles, tasks, task_occurrences, rewards,
  redemptions, ledger_entries, allowance_tiers, weekly_closings, v_balances
  to authenticated;

-- o que o app do pai escreve direto (protegido pelas políticas acima)
grant insert, update, delete on tasks, rewards, allowance_tiers to authenticated;
grant update on families, profiles, weekly_closings to authenticated;

-- task_occurrences, redemptions e ledger_entries ficam sem grant de escrita:
-- toda mudança passa pelas funções SECURITY DEFINER.
