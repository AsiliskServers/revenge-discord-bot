#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${1:-main}"

log() {
  printf '[UPDATE] %s\n' "$1"
}

cd "$REPO_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Le repo contient des modifications locales. Commit/stash avant update."
  exit 1
fi

log "Pull de origin/${BRANCH}"
git fetch --prune origin
git pull --ff-only origin "$BRANCH"

log "Installation dependances bot"
npm ci

log "Build panel web"
cd "$REPO_DIR/features/panel-web-gestion"
npm ci
npm run build

cd "$REPO_DIR"

for service in revenge-bot revenge-panel; do
  log "Redemarrage service ${service}"
  systemctl restart "${service}"
  systemctl is-active --quiet "${service}" || {
    log "Echec: ${service} n'est pas actif apres restart"
    systemctl status "${service}" --no-pager || true
    exit 1
  }
done

log "Update terminee avec succes."
