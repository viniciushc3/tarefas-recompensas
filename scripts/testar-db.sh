#!/usr/bin/env bash
# Recria um Postgres local do zero, aplica a migração e roda os testes.
# Não precisa de Supabase nem de rede.
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/var/lib/postgresql/valida}
PORT=${PORT:-5433}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  echo "== subindo postgres =="
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown -R postgres:postgres "$(dirname "$PGDATA")"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k /tmp -p $PORT -c listen_addresses=' -l $PGDATA/server.log start" >/dev/null
  sleep 2
fi

PSQL="psql -h /tmp -p $PORT -U postgres -q -v ON_ERROR_STOP=1"

echo "== recriando banco =="
$PSQL -d postgres -c "drop database if exists tarefas_test;" -c "create database tarefas_test;"

echo "== stub do supabase =="
$PSQL -d tarefas_test -f "$ROOT/tests/stub_supabase.sql"

echo "== migração =="
$PSQL -d tarefas_test -f "$ROOT/supabase/migrations/0001_init.sql"

echo "== testes =="
$PSQL -d tarefas_test -f "$ROOT/tests/regras.sql"
