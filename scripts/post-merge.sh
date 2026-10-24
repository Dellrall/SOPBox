#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_TARGET="${PYTHONUSERBASE:-$ROOT/.pythonlibs}/lib/python3.12/site-packages"

cd "$ROOT/src/frontend"
npm ci
npm run build

cd "$ROOT/src/backend"
mkdir -p "$PYTHON_TARGET"
python -m pip install --upgrade --target="$PYTHON_TARGET" -r requirements.txt
export PYTHONPATH="$PYTHON_TARGET${PYTHONPATH:+:$PYTHONPATH}"
python -m app.migrate
