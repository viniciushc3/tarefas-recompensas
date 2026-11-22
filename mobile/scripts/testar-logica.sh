#!/usr/bin/env bash
# Compila as funções puras e roda os testes de lógica.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .testes-build
npx tsc --ignoreConfig src/lib/datas.ts src/lib/metricas.ts \
  --outDir .testes-build --module commonjs --target es2022 \
  --moduleResolution node10 --ignoreDeprecations 6.0 --skipLibCheck --strict
node --test "testes/*.test.js"
