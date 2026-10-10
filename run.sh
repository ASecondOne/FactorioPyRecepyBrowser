#!/usr/bin/env bash
# Start the Pyanodons planner. Usage: ./run.sh [--open]   (PORT=8642 by default)
set -e
cd "$(dirname "$(readlink -f "$0")")"
if [ ! -x target/release/pyanodons-planner ] || [ -n "$(find src Cargo.toml -newer target/release/pyanodons-planner 2>/dev/null)" ]; then
  echo "building (cargo build --release)…"
  cargo build --release
fi
export PORT="${PORT:-8642}"
if [ "$1" = "--open" ]; then (sleep 1 && xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &) ; fi
exec ./target/release/pyanodons-planner
