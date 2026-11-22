-- Stub local do que o Supabase já fornece pronto. Não vai para produção.
-- Roles são do cluster, não do banco: criação idempotente.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- O Supabase concede ALL em tabelas novas via ALTER DEFAULT PRIVILEGES.
-- Reproduzimos isso para que o teste de RLS seja honesto: a migração precisa
-- revogar esse excesso por conta própria.
alter default privileges in schema public grant all on tables to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key, email text);

-- No Supabase real isto lê o claim 'sub' do JWT. Aqui, uma GUC que o teste seta.
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('test.uid', true), '')::uuid $$;
