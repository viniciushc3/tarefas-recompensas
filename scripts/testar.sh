#!/usr/bin/env bash
# Roda tudo: regras puras, fluxo completo contra o Codigo.gs real numa planilha
# em memória, e a página de verdade no Chromium. Sem Google e sem rede.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test --test-timeout=120000 "testes/*.test.js"
