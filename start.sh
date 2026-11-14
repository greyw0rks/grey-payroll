#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
pnpm install --frozen-lockfile
pnpm setup:bitcoin
pnpm setup:lightning
pnpm dev -- "${1:-greyfinance}"
