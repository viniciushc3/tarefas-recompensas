-- =====================================================================
-- Testes de comportamento. Cada bloco falha alto se a regra quebrar.
-- Roda com scripts/testar-db.sh (Postgres local, banco recriado do zero).
-- =====================================================================
\set ON_ERROR_STOP on
\set pai   '''00000000-0000-0000-0000-0000000000a1'''
\set filha '''00000000-0000-0000-0000-0000000000a2'''
\set fam   '''00000000-0000-0000-0000-0000000000f1'''

-- ------------------------------------------------------------ fixtures
insert into auth.users (id, email) values (:pai, 'pai@local'), (:filha, 'filha@local');
insert into families (id, name) values (:fam, 'Casa');
insert into profiles (id, family_id, display_name, role) values
  (:pai,   :fam, 'Pai',   'parent'),
  (:filha, :fam, 'Filha', 'child');

insert into allowance_tiers (family_id, min_pct, amount_cents, label) values
  (:fam,  0,   500, 'R$ 5,00'),
  (:fam, 50,   850, 'R$ 8,50'),
  (:fam, 70,  1250, 'R$ 12,50'),
  (:fam, 85,  1500, 'R$ 15,00');

-- básica: conta para mesada e streak, não paga pontos
insert into tasks (id, family_id, title, kind, points, recurrence, counts_for_allowance)
  values ('00000000-0000-0000-0000-000000000b01'::uuid, :fam, 'Escovar os dentes', 'basic', 0, 'daily', true);

-- extra sem aprovação: credita na hora
insert into tasks (id, family_id, title, kind, points, recurrence, requires_approval)
  values ('00000000-0000-0000-0000-000000000e01'::uuid, :fam, 'Tirar o lixo', 'extra', 100, 'daily', false);

-- extra com aprovação
insert into tasks (id, family_id, title, kind, points, recurrence, requires_approval)
  values ('00000000-0000-0000-0000-000000000e02'::uuid, :fam, 'Lavar a louça', 'extra', 50, 'daily', true);

-- extra com foto (implica aprovação)
insert into tasks (id, family_id, title, kind, points, recurrence, requires_approval, requires_photo)
  values ('00000000-0000-0000-0000-000000000e03'::uuid, :fam, 'Arrumar a cama', 'extra', 30, 'daily', true, true);

-- backdata as tarefas para que o catch-up possa gerar dias anteriores
update tasks set created_at = now() - interval '30 days' where family_id = :fam;

insert into rewards (id, family_id, title, kind, bucket, cost_points, screen_minutes) values
  ('00000000-0000-0000-0000-00000000c001'::uuid, :fam, '30 min de tela', 'screen_time', 'spendable', 60, 30);
insert into rewards (id, family_id, title, kind, bucket, cost_points) values
  ('00000000-0000-0000-0000-00000000c002'::uuid, :fam, 'Escolher o filme', 'privilege',  'spendable', 80),
  ('00000000-0000-0000-0000-00000000c003'::uuid, :fam, 'Bicicleta',        'big_prize',  'savings',   4000);

\echo '=== 1. catch-up é idempotente e gera o intervalo ==='
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a2', false);

do $$
declare a int; b int; total int;
begin
  a := public.ensure_catch_up(10);
  b := public.ensure_catch_up(10);
  select count(*) into total from task_occurrences;
  assert a > 0,  'catch-up não gerou nada';
  assert b = 0,  format('catch-up repetido gerou %s linhas (deveria ser 0)', b);
  -- 4 tarefas diárias x 11 dias (hoje + 10)
  assert total = 44, format('esperado 44 ocorrências, veio %s', total);
  raise notice 'gerou % ocorrências, repetição inseriu %', a, b;
end $$;

\echo '=== 2. dias antigos expiram e contam como não feitos ==='
do $$
declare v_expired int; v_pending int;
begin
  select count(*) into v_expired from task_occurrences where status = 'expired';
  select count(*) into v_pending from task_occurrences where status = 'pending';
  -- janela de atraso = 2 dias: hoje, ontem e anteontem seguem marcáveis
  assert v_pending = 12, format('esperado 12 pendentes (3 dias x 4), veio %s', v_pending);
  assert v_expired = 32, format('esperado 32 expirados, veio %s', v_expired);
end $$;

\echo '=== 3. tarefa básica: aprova sem gerar lançamento ==='
do $$
declare v_occ task_occurrences; v_n int;
begin
  select * into v_occ from task_occurrences
   where task_id = '00000000-0000-0000-0000-000000000b01' and status = 'pending'
   order by local_date desc limit 1;
  v_occ := public.claim_occurrence(v_occ.id);
  assert v_occ.status = 'approved', format('básica deveria aprovar direto, veio %s', v_occ.status);
  select count(*) into v_n from ledger_entries where occurrence_id = v_occ.id;
  assert v_n = 0, 'tarefa básica não deve gerar lançamento de pontos';
end $$;

\echo '=== 4. extra sem aprovação: divide 70/30 na hora ==='
do $$
declare v_occ task_occurrences; v_e ledger_entries;
begin
  select * into v_occ from task_occurrences
   where task_id = '00000000-0000-0000-0000-000000000e01' and status = 'pending'
   order by local_date desc limit 1;
  v_occ := public.claim_occurrence(v_occ.id);
  assert v_occ.status = 'approved', 'deveria aprovar sem fila';
  select * into v_e from ledger_entries where occurrence_id = v_occ.id;
  assert v_e.spendable_delta = 70, format('gastável esperado 70, veio %s', v_e.spendable_delta);
  assert v_e.savings_delta   = 30, format('cofrinho esperado 30, veio %s', v_e.savings_delta);
end $$;

\echo '=== 5. arredondamento favorece o saldo gastável ==='
do $$
declare v_occ task_occurrences; v_e ledger_entries;
begin
  -- 50 pontos: floor(50*0.30)=15 no cofrinho, 35 gastáveis
  select * into v_occ from task_occurrences
   where task_id = '00000000-0000-0000-0000-000000000e02' and status = 'pending'
   order by local_date desc limit 1;
  v_occ := public.claim_occurrence(v_occ.id);
  assert v_occ.status = 'claimed', format('deveria ir para a fila, veio %s', v_occ.status);
  assert not exists (select 1 from ledger_entries where occurrence_id = v_occ.id),
         'não pode creditar antes da aprovação';

  -- vira o pai (mesmo role 'authenticated', outro auth.uid())
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
  v_occ := public.decide_occurrence(v_occ.id, true);
  assert v_occ.status = 'approved', 'aprovação falhou';

  select * into v_e from ledger_entries where occurrence_id = v_occ.id;
  assert v_e.spendable_delta = 35, format('gastável esperado 35, veio %s', v_e.spendable_delta);
  assert v_e.savings_delta   = 15, format('cofrinho esperado 15, veio %s', v_e.savings_delta);
end $$;

\echo '=== 6. aprovar duas vezes não paga duas vezes ==='
do $$
declare v_occ task_occurrences;
begin
  select * into v_occ from task_occurrences
   where task_id = '00000000-0000-0000-0000-000000000e02' and status = 'approved' limit 1;
  begin
    perform public.decide_occurrence(v_occ.id, true);
    raise exception 'FALHA: decidir de novo deveria dar erro';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
  assert (select count(*) from ledger_entries
           where occurrence_id = v_occ.id and kind = 'earn') = 1,
         'crédito duplicado';
end $$;

\echo '=== 7. foto obrigatória é obrigatória mesmo ==='
do $$
declare v_occ task_occurrences;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a2', false);
  select * into v_occ from task_occurrences
   where task_id = '00000000-0000-0000-0000-000000000e03' and status = 'pending'
   order by local_date desc limit 1;
  begin
    perform public.claim_occurrence(v_occ.id);
    raise exception 'FALHA: aceitou sem foto';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    assert sqlerrm like '%precisa de foto%', format('erro inesperado: %s', sqlerrm);
  end;
  v_occ := public.claim_occurrence(v_occ.id, 'fotos/cama.jpg');
  assert v_occ.status = 'claimed' and v_occ.photo_path = 'fotos/cama.jpg', 'foto não gravou';
end $$;

\echo '=== 8. fora da janela de atraso não marca ==='
do $$
declare v_occ task_occurrences;
begin
  select * into v_occ from task_occurrences where status = 'expired' limit 1;
  begin
    perform public.claim_occurrence(v_occ.id);
    raise exception 'FALHA: marcou tarefa expirada';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
end $$;

\echo '=== 9. a filha não escreve em nada ==='
do $$
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a2', false);

  begin
    insert into ledger_entries (family_id, profile_id, kind, spendable_delta, reason)
      values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2',
              'adjust', 99999, 'me dá pontos');
    raise exception 'FALHA: inseriu no extrato';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    raise notice 'extrato protegido: %', sqlerrm;
  end;

  begin
    update task_occurrences set status = 'approved' where status = 'pending';
    if found then raise exception 'FALHA: aprovou tarefa por UPDATE direto'; end if;
    raise exception 'FALHA: UPDATE direto não foi barrado';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    raise notice 'ocorrências protegidas: %', sqlerrm;
  end;

  begin
    perform public.adjust_points('00000000-0000-0000-0000-0000000000a2', 500, 0, 'hehe');
    raise exception 'FALHA: a filha ajustou pontos';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    assert sqlerrm like '%responsável%', format('erro inesperado: %s', sqlerrm);
  end;

  begin
    perform public.ensure_day(current_date);
    raise exception 'FALHA: a filha gerou dia arbitrário';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;

  begin
    update tasks set points = 9999 where points = 100;
    if found then raise exception 'FALHA: a filha mudou o preço da tarefa'; end if;
    raise notice 'preços protegidos (0 linhas afetadas pelo RLS)';
  end;
end $$;

\echo '=== 10. resgate: reserva, saldo insuficiente, devolução ==='
do $$
declare v_red redemptions; v_spend int; v_before int;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a2', false);
  select spendable into v_before from v_balances where profile_id = '00000000-0000-0000-0000-0000000000a2';
  raise notice 'saldo gastável antes do resgate: %', v_before;

  -- prêmio grande custa 4000 do cofrinho: tem de faltar
  begin
    perform public.request_redemption('00000000-0000-0000-0000-00000000c003');
    raise exception 'FALHA: resgatou sem cofrinho';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    assert sqlerrm like '%cofrinho%', format('erro inesperado: %s', sqlerrm);
  end;

  -- 30 min de tela custa 60 gastáveis
  v_red := public.request_redemption('00000000-0000-0000-0000-00000000c001');
  assert v_red.status = 'requested', 'resgate deveria ficar pendente';
  select spendable into v_spend from v_balances where profile_id = '00000000-0000-0000-0000-0000000000a2';
  assert v_spend = v_before - 60, format('reserva não debitou: antes %s, agora %s', v_before, v_spend);

  -- pai recusa -> devolve
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
  v_red := public.decide_redemption(v_red.id, false);
  assert v_red.status = 'rejected', 'recusa falhou';
  select spendable into v_spend from v_balances where profile_id = '00000000-0000-0000-0000-0000000000a2';
  assert v_spend = v_before, format('não devolveu: esperado %s, veio %s', v_before, v_spend);
  raise notice 'reserva e devolução ok';
end $$;

\echo '=== 11. fechamento semanal usa a faixa certa ==='
do $$
declare v_c weekly_closings;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
  v_c := public.close_week('00000000-0000-0000-0000-0000000000a2', current_date);
  raise notice 'semana %: % de % aprovadas = % por cento -> faixa % por cento, R$ %',
    v_c.week_start, v_c.approved_count, v_c.eligible_count, v_c.pct,
    v_c.tier_min_pct, (v_c.amount_cents / 100.0);
  assert v_c.eligible_count > 0, 'semana sem ocorrências elegíveis';
  assert v_c.amount_cents >= 500, 'piso da mesada não aplicado';
  -- recalcular dá o mesmo resultado
  assert (public.close_week('00000000-0000-0000-0000-0000000000a2', current_date)).pct = v_c.pct,
    'recálculo divergiu';
end $$;

\echo '=== 12. semana paga não é recalculada ==='
do $$
declare v_week date := date_trunc('week', current_date)::date;
begin
  update weekly_closings set status = 'paid', paid_at = now()
   where profile_id = '00000000-0000-0000-0000-0000000000a2' and week_start = v_week;
  begin
    perform public.close_week('00000000-0000-0000-0000-0000000000a2', v_week);
    raise exception 'FALHA: recalculou semana paga';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
    assert sqlerrm like '%paga%', format('erro inesperado: %s', sqlerrm);
  end;
end $$;

\echo '=== 13. ajuste manual do pai exige motivo ==='
do $$
begin
  begin
    perform public.adjust_points('00000000-0000-0000-0000-0000000000a2', 10, 0, '  ');
    raise exception 'FALHA: aceitou ajuste sem motivo';
  exception when others then
    if sqlerrm like 'FALHA:%' then raise; end if;
  end;
  perform public.adjust_points('00000000-0000-0000-0000-0000000000a2', -10, 0, 'Corrigindo erro de lançamento');
  raise notice 'ajuste com motivo ok';
end $$;

reset role;
\echo ''
\echo '################ TODOS OS TESTES PASSARAM ################'
