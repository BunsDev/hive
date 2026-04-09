#!/usr/bin/env bash
set -euo pipefail

# ── update-homebrew-cask.sh ──────────────────────────────────────
# Creates a PR to Homebrew/homebrew-cask updating Casks/h/hive-app.rb
#
# Usage: update-homebrew-cask.sh <VERSION> <SHA_ARM> <SHA_X64>
# Env:   GH_TOKEN must be set (needs public_repo scope)
# ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▶${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1" >&2; }

UPSTREAM_REPO="Homebrew/homebrew-cask"
CASK_PATH="Casks/h/hive-app.rb"

# ── Validate args ────────────────────────────────────────────────
VERSION="${1:-}"
SHA_ARM="${2:-}"
SHA_X64="${3:-}"

if [[ -z "$VERSION" || -z "$SHA_ARM" || -z "$SHA_X64" ]]; then
  err "Usage: update-homebrew-cask.sh <VERSION> <SHA_ARM> <SHA_X64>"
  exit 1
fi

# ── Validate token ───────────────────────────────────────────────
if [[ -z "${GH_TOKEN:-}" ]]; then
  err "GH_TOKEN is not set. It needs public_repo scope to create PRs to $UPSTREAM_REPO."
  exit 1
fi

# ── Check for existing open PR ───────────────────────────────────
info "Checking for existing open PRs updating hive-app..."
EXISTING_PR=$(gh pr list --repo "$UPSTREAM_REPO" --state open --limit 100 \
  --json title,url \
  --jq "[.[] | select(.title | test(\"^Update hive-app to ${VERSION}$\"; \"i\"))] | .[0].url // empty" 2>/dev/null || echo "")

if [[ -n "$EXISTING_PR" ]]; then
  ok "PR already exists for hive-app v${VERSION}: $EXISTING_PR"
  exit 0
fi

# ── Determine fork ───────────────────────────────────────────────
info "Determining GitHub user for fork..."
GH_USER=$(gh api user --jq '.login')
FORK_REPO="${GH_USER}/homebrew-cask"
ok "Will use fork: $FORK_REPO"

# ── Ensure fork exists ───────────────────────────────────────────
if ! gh api "repos/${FORK_REPO}" &>/dev/null 2>&1; then
  info "Forking $UPSTREAM_REPO..."
  gh repo fork "$UPSTREAM_REPO" --clone=false
  ok "Forked $UPSTREAM_REPO"
  # Brief pause for GitHub to register the fork
  sleep 3
fi

# ── Clone and update ─────────────────────────────────────────────
TMPDIR_CASK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_CASK"' EXIT

BRANCH="update-hive-${VERSION}"

info "Cloning fork (shallow)..."
gh repo clone "$FORK_REPO" "$TMPDIR_CASK/homebrew-cask" -- --depth=1
cd "$TMPDIR_CASK/homebrew-cask"

# Sync fork with upstream
git remote add upstream "https://github.com/${UPSTREAM_REPO}.git" 2>/dev/null || true
git fetch upstream main --depth=1
git checkout -B "$BRANCH" upstream/main

# ── Update cask file ─────────────────────────────────────────────
if [[ ! -f "$CASK_PATH" ]]; then
  err "Cask file not found at $CASK_PATH — has the initial cask been submitted?"
  exit 1
fi

info "Updating $CASK_PATH..."
node -e "
  const fs = require('fs');
  let cask = fs.readFileSync('${CASK_PATH}', 'utf8');

  // Update version
  cask = cask.replace(/version \"[^\"]+\"/, 'version \"${VERSION}\"');

  // Update sha256 values — arm comes first in the file
  let shaIndex = 0;
  cask = cask.replace(/sha256 arm: +\"[a-f0-9]+\"/,   'sha256 arm:   \"${SHA_ARM}\"');
  cask = cask.replace(/intel: +\"[a-f0-9]+\"/,         'intel: \"${SHA_X64}\"');

  fs.writeFileSync('${CASK_PATH}', cask);
"
# Verify the replacement took effect
if ! grep -q "$SHA_ARM" "$CASK_PATH" || ! grep -q "$SHA_X64" "$CASK_PATH"; then
  err "SHA replacement did not take effect — cask file format may have changed"
  exit 1
fi
ok "Cask file updated to v${VERSION}"

# ── Commit and push ──────────────────────────────────────────────
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add "$CASK_PATH"
git commit -m "Update hive-app to ${VERSION}"
git push --force origin "$BRANCH"
ok "Pushed branch $BRANCH to $FORK_REPO"

# ── Create PR ────────────────────────────────────────────────────
info "Creating PR to $UPSTREAM_REPO..."
PR_URL=$(gh pr create \
  --repo "$UPSTREAM_REPO" \
  --head "${GH_USER}:${BRANCH}" \
  --title "Update hive-app to ${VERSION}" \
  --body "$(cat <<EOF
Created by automation.

- Updated version to \`${VERSION}\`
- Updated SHA256 checksums for arm64 and Intel DMGs
EOF
)")

ok "PR created: $PR_URL"
