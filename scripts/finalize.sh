#!/usr/bin/env bash
set -euo pipefail

# ── Colors & helpers ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▶${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1" >&2; }
fatal() { err "$1"; exit 1; }

# ── Constants ─────────────────────────────────────────────────────
REPO="morapelker/hive"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ── Determine version ───────────────────────────────────────────
VERSION="${1:-}"
VERSION="${VERSION#v}"

if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
fi

if [[ -z "$VERSION" ]]; then
  fatal "Usage: finalize.sh [version]"
fi

# ── Verify the release exists ────────────────────────────────────
info "Checking release v${VERSION}..."
if ! gh release view "v${VERSION}" --repo "$REPO" &>/dev/null; then
  fatal "GitHub release v${VERSION} not found"
fi
ok "Release v${VERSION} exists"

# ── Confirm ──────────────────────────────────────────────────────
echo ""
info "Will finalize: ${GREEN}v${VERSION}${NC}"
info "This will:"
echo "  1. Un-draft the release and add auto-generated notes"
echo "  2. Download macOS DMGs and compute SHA256 checksums"
echo "  3. Update Homebrew cask (custom tap + official homebrew-cask PR)"
echo ""
read -rp "Proceed? [Y/n] " confirm
[[ "$confirm" =~ ^[Nn]$ ]] && { info "Aborted."; exit 0; }

# ── Un-draft the release ─────────────────────────────────────────
info "Publishing release (removing draft status)..."
NOTES=$(gh api "repos/${REPO}/releases/generate-notes" \
  -f tag_name="v${VERSION}" \
  --jq '.body')
gh release edit "v${VERSION}" --repo "$REPO" --draft=false --notes "$NOTES"
ok "Release v${VERSION} published"

# ── Update Homebrew cask ─────────────────────────────────────────
info "Updating Homebrew cask..."

TMPDIR_FINALIZE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_FINALIZE"' EXIT
cd "$TMPDIR_FINALIZE"

# Download macOS DMGs
info "Downloading macOS DMGs..."
gh release download "v${VERSION}" --repo "$REPO" \
  -p "Hive-${VERSION}-arm64.dmg" -p "Hive-${VERSION}.dmg"
ok "DMGs downloaded"

# Compute SHA256
SHA_ARM=$(shasum -a 256 "Hive-${VERSION}-arm64.dmg" | awk '{print $1}')
SHA_X64=$(shasum -a 256 "Hive-${VERSION}.dmg" | awk '{print $1}')
ok "SHA256 (arm64): ${SHA_ARM}"
ok "SHA256 (x64):   ${SHA_X64}"

# Clone homebrew repo
info "Cloning homebrew-hive..."
gh repo clone morapelker/homebrew-hive homebrew-hive
cd homebrew-hive

# Update cask file
node -e "
  const fs = require('fs');
  let cask = fs.readFileSync('Casks/hive.rb', 'utf8');
  cask = cask.replace(/version \"[^\"]+\"/, 'version \"${VERSION}\"');
  let shaIndex = 0;
  cask = cask.replace(/sha256 \"[a-f0-9]+\"/g, (match) => {
    shaIndex++;
    if (shaIndex === 1) return 'sha256 \"${SHA_ARM}\"';
    if (shaIndex === 2) return 'sha256 \"${SHA_X64}\"';
    return match;
  });
  fs.writeFileSync('Casks/hive.rb', cask);
"
ok "Cask file updated"

git add Casks/hive.rb
git commit -m "Update Hive to v${VERSION}"
git push origin main
ok "Homebrew repo pushed"

# Update official Homebrew cask
info "Submitting PR to official Homebrew cask..."
if HOMEBREW_GITHUB_API_TOKEN="${GH_TOKEN:-}" brew bump-cask-pr --version="$VERSION" --no-browse hive-app; then
  ok "Official Homebrew cask PR submitted"
else
  warn "Failed to submit official Homebrew cask PR (non-fatal)"
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release v${VERSION} finalized!${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
echo ""
echo "  GitHub Release: https://github.com/${REPO}/releases/tag/v${VERSION}"
echo "  Homebrew:       brew install --cask hive-app"
echo ""
