#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
pnpm install --frozen-lockfile
if [[ "${1:-greyfinance}" == "sandbox" || "${1:-greyfinance}" == "bitcoin-sandbox" ]]; then
  pnpm setup:sandbox
  exec pnpm dev:sandbox
fi
pnpm setup:bitcoin
pnpm setup:lightning
pnpm dev -- "${1:-greyfinance}"
