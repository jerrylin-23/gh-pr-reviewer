#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# test_runner.sh — Smoke tests for the PR Reviewer
# Run from: ~/Projects/gh-pr-reviewer
# ─────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✔ PASS${RESET}: $1"; }
fail() { echo -e "${RED}✗ FAIL${RESET}: $1"; }
info() { echo -e "${CYAN}▶${RESET} $1"; }
divider() { echo -e "${DIM}──────────────────────────────────────────${RESET}"; }

cd "$(dirname "$0")"
source .venv/bin/activate

echo ""
echo "🧪 PR Reviewer — Smoke Tests"
divider

# ─── Test 1: CLI help renders ────────────────────────────────────────────
info "Test 1: CLI --help renders without errors"
if python gh_pr_reviewer/main.py --help > /dev/null 2>&1; then
    pass "main.py --help"
else
    fail "main.py --help"
fi

# ─── Test 2: TUI module imports cleanly ──────────────────────────────────
info "Test 2: TUI imports without errors"
if python -c "from gh_pr_reviewer.tui import ReviewerApp" 2>&1; then
    pass "tui.py imports"
else
    fail "tui.py imports"
fi

# ─── Test 3: Missing PR number shows error ───────────────────────────────
info "Test 3: Missing PR number shows usage error"
OUTPUT=$(python gh_pr_reviewer/main.py 2>&1 || true)
if echo "$OUTPUT" | grep -qi "missing"; then
    pass "Missing argument error"
else
    fail "Missing argument error — got: $OUTPUT"
fi

# ─── Test 4: Invalid PR number (zero) ───────────────────────────────────
info "Test 4: PR number 0 is rejected (min=1)"
OUTPUT=$(python gh_pr_reviewer/main.py 0 2>&1 || true)
if echo "$OUTPUT" | grep -qiE "invalid|error|range"; then
    pass "PR #0 rejected"
else
    fail "PR #0 rejected — got: $OUTPUT"
fi

# ─── Test 5: gh CLI not in a repo (expected failure) ────────────────────
info "Test 5: gh fails gracefully outside a git repo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT=$(cd /tmp && python "$SCRIPT_DIR/gh_pr_reviewer/main.py" 1 2>&1 || true)
if echo "$OUTPUT" | grep -qi "error\|not a git\|failed"; then
    pass "gh error handling"
else
    fail "gh error handling — got: $OUTPUT"
fi

# ─── Test 6: Provider flag accepts both values ─────────────────────────
info "Test 6: --provider flag validates input"
OUTPUT=$(python gh_pr_reviewer/main.py --help 2>&1)
if echo "$OUTPUT" | grep -q "claude|antigravity|codex"; then
    pass "--provider enum shown in help"
else
    fail "--provider enum — got: $OUTPUT"
fi

# ─── Test 7: Invalid provider is rejected ──────────────────────────────
info "Test 7: Invalid provider is rejected"
OUTPUT=$(python gh_pr_reviewer/main.py 1 --provider fake 2>&1 || true)
if echo "$OUTPUT" | grep -qiE "invalid|error|not.*valid"; then
    pass "Invalid provider rejected"
else
    fail "Invalid provider rejected — got: $OUTPUT"
fi

divider
echo ""
echo "🧪 All unit smoke tests complete."
echo ""
divider
echo ""
echo "📋 To test against a REAL repo, run these:"
echo ""
echo "  # Clone a public repo with open PRs:"
echo "  git clone https://github.com/astral-sh/ruff.git /tmp/ruff-test"
echo "  cd /tmp/ruff-test"
echo ""
echo "  # List open PRs:"
echo "  gh pr list --limit 5"
echo ""
echo "  # Review a PR (preview only, won't post):"
echo "  python ~/Projects/gh-pr-reviewer/gh_pr_reviewer/main.py <PR_NUMBER>"
echo ""
echo "  # Or launch the TUI:"
echo "  python ~/Projects/gh-pr-reviewer/gh_pr_reviewer/tui.py"
echo ""
