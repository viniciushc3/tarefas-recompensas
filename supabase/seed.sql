-- =====================================================================
-- Seed inicial: a família, as faixas de mesada e o catálogo calibrado.
--
-- ANTES DE RODAR: crie os dois usuários no painel do Supabase
-- (Authentication > Users) e cole os UUIDs aqui embaixo.
--
--   psql "$DATABASE_URL" -f supabase/seed.sql
-- =====================================================================
\set pai   '''COLE-O-UUID-DO-PAI-AQUI'''
\set filha '''COLE-O-UUID-DA-FILHA-AQUI'''
\set fam   '''11111111-1111-1111-1111-111111111111'''

insert into families (id, name, timezone, savings_rate, late_window_days, daily_screen_cap_minutes)
values (:fam, 'Casa', 'America/Sao_Paulo', 0.300, 2, 40)
on conflict (id) do nothing;

insert into profiles (id, family_id, display_name, role, avatar_emoji) values
  (:pai,   :fam, 'Pai',   'parent', '👨'),
  (:filha, :fam, 'Filha', 'child',  '🦄')
on conflict (id) do nothing;

-- ---------------------------------------------------------- mesada
-- Fechamento SEMANAL. R$ 12,50/semana = os R$ 50/mês que ela já recebe hoje,
-- atingíveis a partir de 70% das tarefas. Piso de R$ 5,00 de propósito:
-- se ela pudesse zerar, no dia em que isso ficasse garantido ela pararia de
-- fazer tudo pelo resto da semana.
insert into allowance_tiers (family_id, min_pct, amount_cents, label) values
  (:fam,  0,  500, 'Piso'),
  (:fam, 50,  850, 'Metade do caminho'),
  (:fam, 70, 1250, 'O normal (R$ 50/mês)'),
  (:fam, 85, 1500, 'Acima do combinado')
on conflict (family_id, min_pct) do nothing;

-- ---------------------------------------------------------- tarefas
-- BÁSICAS: dever de casa. Não pagam pontos, mas contam para a mesada e para
-- o streak. É o que evita a criança que pergunta "quanto eu ganho pra isso?"
-- antes de escovar os dentes.
insert into tasks (family_id, title, icon, kind, points, period, recurrence, counts_for_allowance, sort_order) values
  (:fam, 'Escovar os dentes (manhã)', '🪥', 'basic', 0, 'morning',  'daily',    true, 10),
  (:fam, 'Arrumar a cama',            '🛏️', 'basic', 0, 'morning',  'daily',    true, 20),
  (:fam, 'Mochila pronta',            '🎒', 'basic', 0, 'evening',  'weekdays', true, 30),
  (:fam, 'Lição de casa',             '📚', 'basic', 0, 'afternoon','weekdays', true, 40),
  (:fam, 'Escovar os dentes (noite)', '🪥', 'basic', 0, 'evening',  'daily',    true, 50);

-- EXTRAS: pagam pontos. Calibradas para ~95 pontos num dia útil completo,
-- ou seja ~66 gastáveis/dia -> pouco mais de 30 min de tela por dia.
insert into tasks (family_id, title, icon, kind, points, period, recurrence, requires_approval, sort_order) values
  (:fam, 'Pôr a mesa',        '🍽️', 'extra', 20, 'evening',  'daily',    false, 60),
  (:fam, 'Tirar a mesa',      '🧽',  'extra', 20, 'evening',  'daily',    false, 70),
  (:fam, 'Tirar o lixo',      '🗑️', 'extra', 20, 'evening',  'daily',    false, 80),
  (:fam, 'Lavar a louça',     '🫧',  'extra', 30, 'evening',  'daily',    true,  90);

insert into tasks (family_id, title, icon, kind, points, period, recurrence, days_of_week, requires_approval, sort_order) values
  (:fam, 'Regar as plantas',  '🪴', 'extra', 15, 'morning', 'custom', array[1,3,5], false, 100);

-- com foto: resolve o "mas eu fiz!" quando você não está em casa
insert into tasks (family_id, title, icon, kind, points, period, recurrence, requires_approval, requires_photo, sort_order) values
  (:fam, 'Organizar o quarto', '🧹', 'extra', 40, 'anytime', 'weekend', true, true, 110);

-- ------------------------------------------------------ recompensas
-- Preços derivados do teto: 40 min/dia de tela. 30 min = 60 pontos, e num dia
-- perfeito ela tem ~66 gastáveis. Sobra pouco de propósito — se sobrar muito,
-- ela acumula tela demais; se sobrar nada, o sistema desanima.
insert into rewards (family_id, title, icon, kind, bucket, cost_points, screen_minutes, sort_order) values
  (:fam, '15 min de tela',           '📱', 'screen_time', 'spendable',  30, 15, 10),
  (:fam, '30 min de tela',           '📱', 'screen_time', 'spendable',  60, 30, 20),
  (:fam, '1 hora de tela (sábado)',  '🎮', 'screen_time', 'spendable', 130, 60, 30);

insert into rewards (family_id, title, icon, kind, bucket, cost_points, sort_order) values
  (:fam, 'Escolher o filme da sexta',      '🍿', 'privilege', 'spendable',  80, 40),
  (:fam, 'Escolher o jantar',              '🍕', 'privilege', 'spendable',  90, 50),
  (:fam, 'Dormir 30 min mais tarde',       '🌙', 'privilege', 'spendable', 150, 60),
  (:fam, 'Pular uma tarefa (uma vez)',     '🎟️', 'privilege', 'spendable', 120, 70);

-- Prêmio grande: SÓ do cofrinho. A ~28 pontos/dia de cofrinho, 4000 pontos
-- dão cerca de 4 meses e meio — longo o bastante para ser meta de verdade,
-- curto o bastante para ela acreditar.
insert into rewards (family_id, title, icon, kind, bucket, cost_points, sort_order) values
  (:fam, 'Meta grande (troque pelo item combinado)', '🚲', 'big_prize', 'savings', 4000, 80);
