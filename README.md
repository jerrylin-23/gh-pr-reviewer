







An AI-powered GitHub Pull Request reviewer. It ships four ways to review a PR: an **Electron Desktop App** (macOS DMG), an **Interactive TUI Dashboard**, a **CLI**, and an **MCP Server**, all driven by the local AI agents you already have installed (`claude`, `agy`, or `codex`). The earlier pywebview window is kept as a legacy surface.

Fetch PRs, view formatted diffs, generate comprehensive reviews with local AI, and post comments straight back to GitHub without ever handling raw API keys.

## Demo
https://github.com/user-attachments/assets/1d173ea8-328f-497e-93bd-4ab456627fef

# Agentic GitHub PR Reviewer
<!--
  To embed the demo video: open this README in the GitHub web editor
  (https://github.com/jerrylin-23/gh-pr-reviewer/edit/main/README.md), drag the
  MP4 into the editor where the line below is, and GitHub will replace it with a
  hosted https://github.com/user-attachments/assets/... player link.
-->



## Architecture

Electron is only the desktop user interface. Python stays the review engine.

```
Electron main process  (window, security policy, process lifecycle)
    |
    |  secure preload IPC  (contextIsolation, sandbox, fixed channel list)
    |
React + TypeScript renderer  (no Node, no shell, no credentials)
    |
    |  localhost HTTP API  (127.0.0.1, random port, per-launch token)
    |
Python review backend  (gh_pr_reviewer.api_server -> gh_pr_reviewer.service)
    |
    ├── GitHub CLI (gh)
    ├── Claude CLI (claude)
    ├── Antigravity CLI (agy)
    ├── Codex CLI (codex)
    └── MCP server (pr-reviewer-mcp)
```

Python remains authoritative for GitHub authentication, `gh` calls, Pull Request
metadata and diffs, AI provider execution, Council Mode, review generation,
review posting, timeouts, provider availability, and every error message. The
Electron main process never runs an arbitrary shell command.

The CLI, the TUI, and the MCP server are unchanged. They import the same Python
functions and do not depend on Electron.

| Surface | Entry point | Status |
| --- | --- | --- |
| Electron desktop app | `desktop/` | Maintained desktop UI |
| pywebview desktop app | `pr-reviewer-gui` | Legacy, still works |
| CLI | `pr-reviewer` | Unchanged |
| TUI | `pr-reviewer-tui` | Unchanged |
| MCP server | `pr-reviewer-mcp` | Unchanged |
| Local desktop API | `pr-reviewer-api` | New, used by Electron |

## Features

- **Electron Desktop App**: React and TypeScript two-pane cockpit. The left pane shows Pull Request metadata and the diff. The right pane shows structured findings with severity colours, or safe Markdown when the response does not match the review template.
- **Legacy pywebview GUI**: The previous Obsidian-style window. It still runs, and it shares all review logic with the Electron app.
- **Interactive TUI Dashboard**: Built with [Textual](https://textual.textualize.io/) for high-speed terminal navigation, featuring asynchronous non-blocking workers.


- **Council Review Mode**: When multiple AI CLIs are installed, run them in parallel and have one act as a moderator that synthesizes the individual reviews into a single consensus report.
- **Auto-Complete**: Live search and autocomplete for your GitHub repositories and open PRs.
- **Native GitHub Auth**: Integrates with the `gh` CLI and triggers web-based authentication when needed.
- **Bring Your Own AI CLI**: Wraps local AI CLIs (such as Anthropic's Claude Code) via subprocess, so you never configure raw API keys or tokens.
- **MCP Server**: Exposes the PR review tools to MCP-capable clients while keeping GitHub access on your existing `gh` auth.
- **Safe Workflow**: Fetch and generate reviews locally. Nothing is posted until you explicitly confirm.

## Prerequisites

- Python 3.11+
- Node.js 20+ and npm (only for the Electron desktop app)
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated.
- At least one AI CLI installed globally (e.g. `npm install -g @anthropic-ai/claude-code`). Install two or more to enable Council mode.

## Installation

Install the Python engine first. Every surface needs it.

```bash
git clone https://github.com/jerrylin-23/gh-pr-reviewer.git
cd gh-pr-reviewer
python3 -m venv .venv
.venv/bin/pip install -e .
```

For the development tools (tests and lint):

```bash
.venv/bin/pip install -e '.[dev]'
```

Then install the desktop app dependencies:

```bash
cd desktop
npm install
```

## Usage

### 1. Electron Desktop App (macOS)

Start the app in development mode. It starts the Vite dev server, builds the
Electron main and preload bundles, starts the Python backend, and opens the
window:

```bash
cd desktop
npm run dev
```

Production build and macOS package:

```bash
cd desktop
npm run build      # React renderer + Electron main and preload
npm run package    # release/PR Reviewer-<version>-arm64.dmg
```

Workflow inside the app:

1. The header shows backend health and GitHub sign-in state.
2. Search for a repository, or type `owner/repo` and press Enter.
3. Pick an open Pull Request. The app loads metadata and the diff.
4. Pick an AI provider, or **Council Mode** to use every installed agent.
5. Select **Generate review**.
6. Read the structured findings, switch to the Markdown view, or copy the Markdown.
7. Select **Post to GitHub**, then confirm in the dialog. Nothing reaches GitHub before that confirmation.

### 2. Legacy pywebview Desktop App (macOS)

The previous Cocoa WebKit window still works and shares all review logic:

```bash
pr-reviewer-gui

# Or open the packaged app:
open packaging/dist/PRReviewer.dmg
```
Select **Council Mode** from the provider dropdown to review with every installed agent at once.

### 3. Interactive Dashboard (TUI)
Launch the interactive terminal UI:
```bash
pr-reviewer-tui
```

### 4. Command Line Interface (CLI)
If you just want a quick review without the interactive UI:
```bash
# Review a PR in your current git repository
pr-reviewer 123

# Target a specific repository
pr-reviewer 123 -R astral-sh/ruff

# Choose a provider (claude, antigravity, codex) or run the full council
pr-reviewer 123 --provider council

# Post the review automatically
pr-reviewer 123 --post
```

### 5. MCP Server
Run the reviewer as a stdio MCP server:
```bash
pr-reviewer-mcp
```

Example MCP client config (point `command` at the `pr-reviewer-mcp` on your PATH, or the one inside this repo's virtualenv):
```json
{
  "mcpServers": {
    "gh-pr-reviewer": {
      "command": "pr-reviewer-mcp"
    }
  }
}
```

Available MCP tools:
- `github_auth_status`: Check whether `gh` is installed and authenticated.
- `list_available_providers`: Show installed local review providers.
- `list_open_prs`: List open PRs for a repo.
- `fetch_pr_metadata`: Fetch PR title, refs, author, stats, and URL.
- `fetch_pr_diff`: Fetch the unified diff.
- `generate_pr_review`: Generate a Markdown review without posting it.
- `post_pr_review`: Post an existing review body.
- `review_pr`: Fetch metadata and diff, generate a review, and optionally post it.
- `open_in_desktop_gui`: Launch the legacy pywebview Desktop GUI App pre-loaded with a specific repo and PR.

## Security model

The desktop app follows these rules. The tests in `desktop/electron/*.test.ts`
and `tests/test_api_server.py` check each one.

**Electron**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false`.
- The renderer gets one bridge object, `window.prReviewer`, with a fixed method list. It never sees `ipcRenderer`, `require`, `fs`, or `child_process`.
- Every IPC channel maps to exactly one product operation. There is no channel that runs a command, reads a file, or takes a URL path from the renderer.
- Main-frame navigation is limited to the local frontend. Every other navigation is blocked.
- Every new window is denied. Links open in the system browser, and only for an approved host list (`github.com`, `cli.github.com`, `docs.anthropic.com`).
- The renderer page sets a strict Content-Security-Policy. It loads no remote script, style, font, or image.
- AI Markdown is sanitized with DOMPurify against a narrow allow-list before it reaches the DOM. Images, iframes, inline styles, and `javascript:` links are removed.

**Local backend token**
- The Electron main process generates a 256-bit random token at launch and passes it to Python through the `PR_REVIEWER_API_TOKEN` environment variable.
- Python refuses to start without that variable, so the token is never written to stdout or to a log. Backend log lines are redacted before they are printed.
- The backend binds to `127.0.0.1` on a port the operating system chooses. It never binds a public interface.
- Every route, including `/health`, requires the token in the `x-pr-reviewer-token` header. A missing token returns 401. A wrong token returns 403.
- Every value is validated in Python before use: repository pattern, Pull Request range, provider allow-list, diff size, review body size.
- Posting a review and writing the MCP configuration both need an explicit `confirm: true` flag.
- The backend never returns a stack trace, a secret, or an environment value. Failures map to a stable error code.
- GitHub credentials stay inside `gh`. The renderer never holds a credential.

## Process lifecycle

- Electron starts one Python child process: `python -m gh_pr_reviewer.api_server --port 0`.
- Python prints one JSON line, `{"event":"ready","host":"127.0.0.1","port":N}`, when the socket is listening. Electron reads the port from that line.
- Electron then calls `/health`. The window only leaves the starting state after the health check passes.
- Startup is bounded to 30 seconds. Shutdown sends `SIGTERM`, waits up to 5 seconds, then sends `SIGKILL`.
- A failed start, an unexpected exit, or a missing backend shows an actionable error in the window instead of an endless spinner.
- `app.requestSingleInstanceLock()` prevents a second app instance, and therefore a second backend.

The Electron app finds the Python engine in this order, always from the
application location and never from the current working directory:

1. `PR_REVIEWER_PYTHON`, if you set it.
2. `Resources/backend/.venv/bin/python` inside a packaged app.
3. A `.venv` in the repository checkout that contains the app.
4. A `pr-reviewer-api` console script from a `pip install`.
5. A system `python3` next to a checkout.

## Running Tests

Python engine and local API:

```bash
.venv/bin/python -m pytest -q      # 68 tests
.venv/bin/ruff check .
bash test_runner.sh                # 9 CLI, TUI, and backend smoke checks
```

Desktop app:

```bash
cd desktop
npm run typecheck
npm run lint
npm run test                       # 68 tests, Vitest
npm run build
```

End-to-end smoke test. It starts the real Python backend and a real Electron
process, and mocks `gh` with a stub on `PATH`:

```bash
cd desktop
npm run smoke                      # 12 checks
```

No automated test calls real GitHub, a real AI provider, or a real repository.

## Packaging

### Electron desktop app (current)

```bash
cd desktop
npm run package
```

The output is `desktop/release/PR Reviewer-<version>-arm64.dmg`.

The package includes the React frontend and the Electron main and preload
bundles. It does **not** include Python. The installed app finds the engine
using the search order above. To ship a self-contained app, copy the repository
with its `.venv` to `desktop/backend/` and uncomment the `extraResources` block
in `desktop/electron-builder.yml`.

Code signing and notarization are **not** set up. `mac.identity` is `null`, so
macOS shows a Gatekeeper warning on first launch. Both are release requirements
for distribution outside your own machine.

### Legacy PyInstaller DMG (pywebview GUI)

`PRReviewer.spec`, `pr-reviewer-tui.spec`, and `packaging/build-dmg.sh` build
the older pywebview window. They still work and are kept as the legacy
packaging path.

```bash
pip install pyinstaller pywebview
./packaging/build-dmg.sh
```

The output DMG installer is written to `packaging/dist/PRReviewer.dmg`.

## Troubleshooting

**"Could not find the Python review backend"** — Run `pip install -e .` in the
repository, or set `PR_REVIEWER_PYTHON` to a Python that has `gh_pr_reviewer`
installed.

**The window stays on "Backend starting"** — Run
`.venv/bin/python -m gh_pr_reviewer.api_server --port 0` with
`PR_REVIEWER_API_TOKEN` set to a 32-character value. The error appears in that
terminal.

**"No AI CLI found"** — Install `claude`, `agy`, or `codex`. A macOS app inherits
no login shell `PATH`, so the backend also searches `~/.local/bin`, `~/bin`,
`~/.cargo/bin`, `/opt/homebrew/bin`, and `/usr/local/bin`.

**Sign-in does nothing** — `gh auth login --web` needs a terminal. The app opens
one, and the header updates once the login completes.

**A second launch does nothing** — The single-instance lock focuses the running
window instead of starting a second backend.

## Known limitations

- The macOS package is unsigned and not notarized.
- Only `arm64` is configured as a package target.
- The package does not bundle Python by default.
- The structured review parser expects the house Markdown template. Other shapes fall back to sanitized Markdown with a visible notice.
- The Council Mode progress display is a single loading state, not per-provider progress.
- The repair workflow (worktree, agent fix, re-review) is not implemented. The architecture leaves room for it, and Electron runs no local code on its own.

## License

MIT License
