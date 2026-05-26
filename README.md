# Agentic GitHub PR Reviewer

A terminal-based Dashboard (TUI) and CLI for reviewing GitHub Pull Requests using local AI agents (`claude` or `antigravity`). 

Fetch PRs, generate comprehensive markdown reviews using AI, and post them directly back to GitHub without ever leaving your terminal or messing with API keys.

## Features

- **Interactive TUI Dashboard**: Built with [Textual](https://textual.textualize.io/), featuring asynchronous non-blocking workers.
- **Auto-Complete**: Live search and auto-complete for your GitHub repositories and open PRs.
- **Native GitHub Auth**: Seamlessly integrates with the `gh` CLI. Triggers `gh auth login --web` directly from the UI if you aren't authenticated.
- **Bring Your Own AI CLI**: Wraps existing local AI CLIs (like Anthropic's Claude Code) via subprocess, meaning you don't need to configure raw API keys or tokens.
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

### Interactive Dashboard (TUI)

Launch the interactive terminal UI:

```bash
pr-reviewer-tui
```

1. **Sign In**: If you aren't authenticated, click the Sign In button.
2. **Select Repo**: Type in the `owner/repo` field. It will auto-complete from your GitHub account.
3. **Select PR**: The PR dropdown will automatically populate with open PRs for the selected repo.
4. **Fetch**: Downloads the diff and PR metadata.
5. **Review**: Triggers the AI to generate a comprehensive markdown review based on the diff.
6. **Post**: Publishes the review as a comment to the live GitHub PR.

### Command Line Interface (CLI)

If you just want a quick review without the interactive UI:

```bash
# Review a PR in your current git repository
pr-reviewer 123

# Target a specific repository
pr-reviewer 123 -R astral-sh/ruff

# Post the review automatically
pr-reviewer 123 --post
```

## Running Tests

A smoke test suite is included to verify the CLI, TUI imports, and argument validation:

```bash
bash test_runner.sh
```

## License

MIT License
