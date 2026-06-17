







An AI-powered GitHub Pull Request reviewer. It ships four ways to review a PR: a visual **Desktop GUI App** (macOS DMG), an **Interactive TUI Dashboard**, a **CLI**, and an **MCP Server**, all driven by the local AI agents you already have installed (`claude`, `agy`, or `codex`).

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



## Features

- **Visual Desktop GUI App**: A premium Obsidian-style dark theme with autocomplete repository/PR selectors, formatted diff highlighting, and rendered Markdown reviews.
- **Interactive TUI Dashboard**: Built with [Textual](https://textual.textualize.io/) for high-speed terminal navigation, featuring asynchronous non-blocking workers.


- **Council Review Mode**: When multiple AI CLIs are installed, run them in parallel and have one act as a moderator that synthesizes the individual reviews into a single consensus report.
- **Auto-Complete**: Live search and autocomplete for your GitHub repositories and open PRs.
- **Native GitHub Auth**: Integrates with the `gh` CLI and triggers web-based authentication when needed.
- **Bring Your Own AI CLI**: Wraps local AI CLIs (such as Anthropic's Claude Code) via subprocess, so you never configure raw API keys or tokens.
- **MCP Server**: Exposes the PR review tools to MCP-capable clients while keeping GitHub access on your existing `gh` auth.
- **Safe Workflow**: Fetch and generate reviews locally. Nothing is posted until you explicitly confirm.

## Prerequisites

- Python 3.11+
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated.
- At least one AI CLI installed globally (e.g. `npm install -g @anthropic-ai/claude-code`). Install two or more to enable Council mode.

## Installation

You can install this project globally using `pip`:

```bash
git clone https://github.com/jerrylin-23/gh-pr-reviewer.git
cd gh-pr-reviewer
pip install -e .
```

## Usage

### 1. Visual Desktop GUI App (macOS)
Launch the native Cocoa WebKit desktop window:
```bash
pr-reviewer-gui

# Or open the packaged app:
open packaging/dist/PRReviewer.dmg
```
Select **Council Mode** from the provider dropdown to review with every installed agent at once.

### 2. Interactive Dashboard (TUI)
Launch the interactive terminal UI:
```bash
pr-reviewer-tui
```

### 3. Command Line Interface (CLI)
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

### 4. MCP Server
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
- `open_in_desktop_gui`: Launch the Desktop GUI App pre-loaded with a specific repo and PR.

## Running Tests

A smoke test suite is included to verify the CLI, TUI imports, and argument validation:

```bash
bash test_runner.sh
```

## Packaging as a macOS DMG App

You can package the WebView Desktop GUI as a native standalone macOS `.dmg` application:

1. Make sure PyInstaller is installed in your virtual environment:
   ```bash
   pip install pyinstaller pywebview
   ```
2. Run the DMG builder script:
   ```bash
   ./packaging/build-dmg.sh
   ```

The output DMG installer is written to `packaging/dist/PRReviewer.dmg`.

## License

MIT License
