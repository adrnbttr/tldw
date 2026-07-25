#!/usr/bin/env bash
#
# tldw installer — builds the extension and walks you through loading it.
# Usage:  ./install.sh
#
set -euo pipefail

# ── Resolve repo root (works from anywhere) ─────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ── Colors (disabled when not a TTY or NO_COLOR is set) ─────────────────────
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  BLUE=$'\033[38;5;99m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'
else
  BOLD=''; DIM=''; RESET=''; BLUE=''; GREEN=''; RED=''; YELLOW=''
fi
CHECK="${GREEN}✓${RESET}"; CROSS="${RED}✗${RESET}"; ARROW="${BLUE}▸${RESET}"

step()  { printf '\n%s %s\n' "$ARROW" "${BOLD}$1${RESET}"; }
ok()    { printf '  %s %s\n' "$CHECK" "$1"; }
fail()  { printf '  %s %s\n' "$CROSS" "$1"; }

# Run a command quietly; show output only if it fails.
run() {
  local label="$1"; shift
  local log; log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    ok "$label"
    rm -f "$log"
  else
    fail "$label"
    printf '\n%s\n' "${DIM}--- command output -------------------------------${RESET}"
    tail -n 20 "$log"
    printf '%s\n' "${DIM}--------------------------------------------------${RESET}"
    rm -f "$log"
    exit 1
  fi
}

# ── Banner ──────────────────────────────────────────────────────────────────
printf '\n%s' "$BLUE"
cat <<'BANNER'
  ┌───────────────────────────────────────┐
  │   tldw · installer                     │
  │   too long; didn't watch               │
  └───────────────────────────────────────┘
BANNER
printf '%s' "$RESET"

# ── 1. Prerequisites ────────────────────────────────────────────────────────
step 'Checking prerequisites'

if ! command -v node >/dev/null 2>&1; then
  fail 'Node.js is not installed.'
  printf '    Install it from %shttps://nodejs.org%s (v18 or newer), then re-run.\n' "$BLUE" "$RESET"
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if (( NODE_MAJOR < 18 )); then
  fail "Node $(node -v) is too old — tldw needs v18 or newer."
  exit 1
fi
ok "Node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  fail 'npm is not installed (it ships with Node).'
  exit 1
fi
ok "npm $(npm -v)"

# ── 2. Install & build ──────────────────────────────────────────────────────
step 'Installing dependencies'
run 'dependencies installed' npm install

step 'Building the extension'
run 'built → dist/' npm run build

# ── 3. Next steps ───────────────────────────────────────────────────────────
DIST="$ROOT/dist"

# Best-effort: copy the dist path to the clipboard.
CLIP_NOTE=''
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s' "$DIST" | pbcopy && CLIP_NOTE=" ${DIM}(copied to clipboard)${RESET}"
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s' "$DIST" | wl-copy && CLIP_NOTE=" ${DIM}(copied to clipboard)${RESET}"
elif command -v xclip >/dev/null 2>&1; then
  printf '%s' "$DIST" | xclip -selection clipboard && CLIP_NOTE=" ${DIM}(copied to clipboard)${RESET}"
fi

printf '\n%s\n\n' "${GREEN}${BOLD}Build complete.${RESET} Load it in your browser:"
printf '  %s1.%s Open  %schrome://extensions%s   %s(or edge://extensions)%s\n' "$BOLD" "$RESET" "$BLUE" "$RESET" "$DIM" "$RESET"
printf '  %s2.%s Turn on %sDeveloper mode%s (top-right)\n' "$BOLD" "$RESET" "$BOLD" "$RESET"
printf '  %s3.%s Click %sLoad unpacked%s and select:\n' "$BOLD" "$RESET" "$BOLD" "$RESET"
printf '        %s%s%s%s\n' "$YELLOW" "$DIST" "$RESET" "$CLIP_NOTE"
printf '  %s4.%s Open the popup → %s⚙ Settings%s → paste your %sOpenRouter key%s → Save\n' "$BOLD" "$RESET" "$BOLD" "$RESET" "$BOLD" "$RESET"
printf '        %sget one at https://openrouter.ai/keys — required before the first summary%s\n' "$DIM" "$RESET"

printf '\n%sTo update later:%s  git pull && ./install.sh  %sthen click ↻ reload on the extension card%s\n' "$DIM" "$RESET" "$DIM" "$RESET"
printf '%sHappy summarizing.%s\n\n' "$GREEN" "$RESET"
