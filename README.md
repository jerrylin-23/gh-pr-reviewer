# Agentic GitHub PR Reviewer

An AI-powered GitHub Pull Request reviewer. It provides a visual **Desktop GUI App** (macOS DMG), an **Interactive TUI Dashboard** (Terminal), and a **CLI** tool for reviewing PRs using local AI agents (`claude`, `agy`, or `codex`).
A terminal-based Dashboard (TUI) and CLI for reviewing GitHub Pull Requests using local AI agents (`claude` or `antigravity and codex`). 

Fetch PRs, view visual formatted diffs, generate comprehensive reviews using local AI, and post comments directly back to GitHub.

## Features

- **Visual Desktop GUI App**: Built with a premium Obsidian-style dark theme, interactive autocomplete repository/PR selectors, formatted diff highlighting, and markdown review rendering.
- **Interactive TUI Dashboard**: Built with [Textual](https://textual.textualize.io/) for high-speed terminal navigation.
<img width="1333" height="492" alt="image" src="https://github.com/user-attachments/assets/c700847e-1fde-491d-ada1-0f637c853970" />


- **Interactive TUI Dashboard**: Built with [Textual](https://textual.textualize.io/), featuring asynchronous non-blocking workers.
- **Auto-Complete**: Live search and auto-complete for your GitHub repositories and open PRs.
- **Native GitHub Auth**: Seamlessly integrates with the `gh` CLI. Triggers authentication via Web GUI directly when needed.
- **Bring Your Own AI CLI**: Wraps existing local AI CLIs (like Anthropic's Claude Code) via subprocess, meaning you don't need to configure raw API keys or tokens.
- **MCP Server**: Exposes PR review tools to MCP-capable clients while keeping GitHub access on your existing `gh` auth.
- **Safe Workflow**: Fetch and generate reviews locally. Reviews are never posted until you explicitly click **Post**.

## Prerequisites

- Python 3.11+
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated.
- An AI CLI installed globally (e.g. `npm install -g @anthropic-ai/claude-code`).

## Installation

You can install this project globally using `pip`:

```bash
git clone https://github.com/YOUR_USERNAME/gh-pr-reviewer.git
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

# Post the review automatically
pr-reviewer 123 --post
```

### 4. MCP Server
Run the reviewer as a stdio MCP server:
```bash
pr-reviewer-mcp
```

Example MCP client config:
```json
{
  "mcpServers": {
    "gh-pr-reviewer": {
      "command": "/Users/jerry/Projects/gh-pr-reviewer/.venv/bin/pr-reviewer-mcp"
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

## Running Tests

A smoke test suite is included to verify the CLI, TUI imports, and argument validation:

```bash
bash test_runner.sh
```

## Packaging as a macOS DMG App

You can package the Webview Desktop GUI as a native standalone macOS `.dmg` application:

1. Make sure you have PyInstaller installed in your virtual environment:
   ```bash
   pip install pyinstaller pywebview
   ```
2. Run the DMG builder script:
   ```bash
   ./packaging/build-dmg.sh
   ```

The output DMG installer will be located in [PRReviewer.dmg](file:///Users/jerry/Projects/gh-pr-reviewer/packaging/dist/PRReviewer.dmg).

## License

MIT License
