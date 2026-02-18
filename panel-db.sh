#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PANEL_ENV_FILE:-$REPO_DIR/features/panel-web-gestion/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[PANEL-DB] Fichier .env introuvable: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PANEL_DATABASE_URL:?PANEL_DATABASE_URL manquante dans $ENV_FILE}"

if [[ "${1:-}" == "--check" ]]; then
  echo "[PANEL-DB] ENV_FILE=$ENV_FILE"
  echo "[PANEL-DB] PANEL_DATABASE_URL is set"
  exit 0
fi

exec psql "$PANEL_DATABASE_URL" "$@"
