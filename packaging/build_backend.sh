#!/usr/bin/env bash
#
# Freezes the Python review engine into a standalone binary. The packaged
# desktop app ships the result, so the host machine needs no Python.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PR_REVIEWER_BUILD_PYTHON:-$REPO_DIR/.venv/bin/python}"

if [ ! -x "$PYTHON" ]; then
    echo "[Error] Python not found at: $PYTHON" >&2
    echo "Create it with: python3 -m venv .venv && .venv/bin/pip install -e ." >&2
    exit 1
fi

echo "=== Freezing the review engine with PyInstaller ==="

"$PYTHON" -m PyInstaller --noconfirm \
    --name pr-reviewer-api \
    --distpath "$REPO_DIR/packaging/backend-dist" \
    --workpath "$REPO_DIR/packaging/backend-build" \
    --specpath "$REPO_DIR/packaging" \
    --console \
    --paths "$REPO_DIR" \
    --collect-submodules gh_pr_reviewer \
    --collect-data gh_pr_reviewer \
    --collect-submodules uvicorn \
    --collect-submodules starlette \
    --hidden-import uvicorn.protocols.http.h11_impl \
    --hidden-import uvicorn.lifespan.on \
    --hidden-import uvicorn.loops.asyncio \
    "$REPO_DIR/packaging/api_entry.py"

echo "Backend built at: $REPO_DIR/packaging/backend-dist/pr-reviewer-api"
