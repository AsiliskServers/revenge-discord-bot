#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="${1:-main}"
AUTO_STASH="${AUTO_STASH:-1}"
STASH_CREATED=0
STASH_REF=""

log() {
  printf '[UPDATE] %s\n' "$1"
}

has_local_changes() {
  [[ -n "$(git status --porcelain)" ]]
}

restore_stash_if_needed() {
  if [[ "$STASH_CREATED" -eq 1 && -n "$STASH_REF" ]]; then
    log "Restauration des modifications locales (${STASH_REF})"
    if ! git stash pop --index "$STASH_REF"; then
      log "Conflit pendant la restauration. Le stash est conserve."
      log "Commande manuelle: git stash list && git stash pop --index ${STASH_REF}"
      exit 1
    fi
  fi
}

cd "$REPO_DIR"

if has_local_changes; then
  if [[ "$AUTO_STASH" != "1" ]]; then
    log "Le repo contient des modifications locales. Commit/stash avant update."
    exit 1
  fi

  log "Modifications locales detectees: stash automatique"
  git stash push -u -m "auto-stash update-services $(date +%F-%T)"
  STASH_CREATED=1
  STASH_REF="$(git stash list | head -n1 | cut -d: -f1)"
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

restore_stash_if_needed

log "Update terminee avec succes."
