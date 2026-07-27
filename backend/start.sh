#!/usr/bin/env bash
set -euo pipefail

echo "Starting Distill API on port ${PORT:-8000}..."
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
