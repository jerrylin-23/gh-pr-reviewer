"""
Agentic GitHub PR Reviewer
──────────────────────────
Fetches a PR diff via the GitHub CLI (`gh`), analyses it with
Claude CLI or Antigravity CLI, and posts the review back as a PR comment.

Handles GitHub auth — prompts `gh auth login` if needed.

Usage:
    python main.py 42                                           # current repo, claude
    python main.py 42 --repo owner/repo                        # target a specific repo
    python main.py 42 --repo owner/repo --provider antigravity  # use antigravity
    python main.py 42 --repo owner/repo --post                  # review + post
"""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from enum import Enum

import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

# ─── Typer / Rich setup ─────────────────────────────────────────────────────

app = typer.Typer(
    name="pr-reviewer",
    help="AI-powered GitHub PR reviewer using Claude/Antigravity/Codex CLI + GitHub CLI.",
    add_completion=False,
    rich_markup_mode="rich",
)
console = Console()

# ─── Constants ───────────────────────────────────────────────────────────────


class Provider(str, Enum):
    claude = "claude"
    antigravity = "antigravity"
    codex = "codex"


REVIEW_PROMPT = textwrap.dedent("""\
    You are a senior software engineer performing a thorough code review.

    When given a unified diff from a GitHub Pull Request, you MUST:
    1. Summarise what the PR does in 2-3 sentences.
    2. List any bugs or logic errors you find.
    3. List any security concerns.
    4. List any performance issues.
    5. Suggest concrete improvements with code snippets where helpful.
    6. Call out anything that is well done.

    Keep your tone constructive, concise, and actionable.
    Format the review in Markdown so it renders nicely on GitHub.

    Here is the Pull Request diff to review:

""")


# ─── Auth helpers ────────────────────────────────────────────────────────────


def check_gh_installed() -> bool:
    """Check if the `gh` CLI is installed."""
    try:
        subprocess.run(
            ["gh", "--version"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def check_gh_auth() -> tuple[bool, str]:
    """
    Check if `gh` is authenticated.
    Returns (is_authenticated, username_or_error).
    """
    try:
        result = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True, text=True, timeout=10,
        )
        output = result.stdout + result.stderr
        if result.returncode == 0:
            # Extract username from output
            for line in output.splitlines():
                if "Logged in to" in line and "account" in line:
                    # e.g. "✓ Logged in to github.com account username (..."
                    parts = line.split("account")
                    if len(parts) > 1:
                        username = parts[1].strip().split()[0].strip("()")
                        return True, username
                if "Logged in to" in line:
                    return True, "authenticated"
            return True, "authenticated"
        else:
            return False, output.strip()
    except FileNotFoundError:
        return False, "gh CLI not installed"
    except subprocess.TimeoutExpired:
        return False, "gh auth check timed out"


def get_gh_username() -> str | None:
    """Get the authenticated GitHub username."""
    try:
        result = subprocess.run(
            ["gh", "api", "user", "--jq", ".login"],
            capture_output=True, text=True, check=True, timeout=10,
        )
        return result.stdout.strip() or None
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None


def run_gh_login() -> bool:
    """
    Run `gh auth login` interactively so the user can authenticate.
    Returns True if login succeeded.
    """
    console.print(
        Panel(
            "[bold cyan]Starting GitHub authentication…[/bold cyan]\n\n"
            "Follow the prompts below to sign in.",
            title="🔑  GitHub Sign-In",
        )
    )
    try:
        result = subprocess.run(["gh", "auth", "login"], timeout=300)
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def ensure_gh_auth() -> str:
    """
    Ensure `gh` is installed and authenticated.
    Triggers interactive login if needed.
    Returns the authenticated username.
    Raises typer.Exit on failure.
    """
    # Check gh is installed
    if not check_gh_installed():
        console.print(
            Panel(
                "[bold red]GitHub CLI (`gh`) not found.[/bold red]\n\n"
                "Install it from [link=https://cli.github.com]https://cli.github.com[/link]",
                title="⚠️  Missing dependency",
            )
        )
        raise typer.Exit(code=1)

    # Check auth
    is_authed, info = check_gh_auth()

    if is_authed:
        username = get_gh_username() or info
        console.print(f"[green]✔ Signed in as[/green] [bold]{username}[/bold]")
        return username

    # Not authenticated — offer login
    console.print(
        Panel(
            "[yellow]You're not signed in to GitHub.[/yellow]\n\n"
            f"[dim]{info}[/dim]",
            title="🔑  Auth required",
        )
    )

    if typer.confirm("Sign in now?", default=True):
        if run_gh_login():
            username = get_gh_username() or "authenticated"
            console.print(f"\n[green]✔ Signed in as[/green] [bold]{username}[/bold]")
            return username
        else:
            console.print("[bold red]Login failed or was cancelled.[/bold red]")
            raise typer.Exit(code=1)
    else:
        console.print("[dim]Skipped login. Some features won't work.[/dim]")
        raise typer.Exit(code=1)


# ─── GH command runner ──────────────────────────────────────────────────────


def _run_gh(args: list[str], repo: str | None = None) -> str:
    """
    Execute a GitHub CLI command and return its stdout.

    If `repo` is provided (e.g. "owner/repo"), it is passed as `-R repo`
    so the command targets that repo instead of the local git remote.

    Raises `typer.Exit` with a helpful message on failure.
    """
    cmd = ["gh", *args]
    if repo:
        cmd.extend(["-R", repo])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=60,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        console.print(
            Panel(
                "[bold red]GitHub CLI (`gh`) not found.[/bold red]\n\n"
                "Install it from [link=https://cli.github.com]https://cli.github.com[/link]\n"
                "then run [bold]gh auth login[/bold] to authenticate.",
                title="⚠️  Missing dependency",
            )
        )
        raise typer.Exit(code=1)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No additional details."
        console.print(
            Panel(
                f"[bold red]`gh` command failed[/bold red] (exit code {exc.returncode}):\n\n"
                f"[dim]{' '.join(cmd)}[/dim]\n\n{stderr}",
                title="⚠️  GitHub CLI error",
            )
        )
        raise typer.Exit(code=1)
    except subprocess.TimeoutExpired:
        console.print(
            Panel(
                "[bold red]The `gh` command timed out after 60 seconds.[/bold red]\n"
                "Check your network connection and try again.",
                title="⏱  Timeout",
            )
        )
        raise typer.Exit(code=1)


def _run_ai_cli(provider: Provider, prompt: str) -> str:
    """Send a prompt to Claude CLI or Antigravity CLI via subprocess."""
    cli_name = provider.value
    cmd = [cli_name, "-p", prompt]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=300,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        console.print(
            Panel(
                f"[bold red]{cli_name} CLI not found.[/bold red]\n\n"
                + (
                    "Install Claude Code: [link=https://docs.anthropic.com/en/docs/claude-code]"
                    "https://docs.anthropic.com/en/docs/claude-code[/link]"
                    if provider == Provider.claude
                    else "Install the required CLI tool."
                ),
                title="⚠️  Missing CLI",
            )
        )
        raise typer.Exit(code=1)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No details."
        console.print(
            Panel(
                f"[bold red]{cli_name} failed[/bold red] (exit {exc.returncode}):\n\n{stderr}",
                title="⚠️  AI CLI error",
            )
        )
        raise typer.Exit(code=1)
    except subprocess.TimeoutExpired:
        console.print(
            Panel(
                f"[bold red]{cli_name} timed out after 5 minutes.[/bold red]\n"
                "The diff may be too large, or the CLI may be unresponsive.",
                title="⏱  Timeout",
            )
        )
        raise typer.Exit(code=1)


# ─── Core logic ──────────────────────────────────────────────────────────────


def fetch_diff(pr_number: int, repo: str | None = None) -> str:
    """Fetch the unified diff for a Pull Request via `gh pr diff`."""
    target = f" from {repo}" if repo else ""
    console.print(f"[cyan]Fetching diff for PR #{pr_number}{target}…[/cyan]")
    diff = _run_gh(["pr", "diff", str(pr_number)], repo=repo)
    if not diff:
        console.print("[yellow]Warning:[/yellow] The diff is empty — the PR may have no file changes.")
    return diff


def analyze_diff(diff_text: str, provider: Provider) -> str:
    """Send the diff to the chosen AI CLI and return a Markdown review."""
    console.print(f"[cyan]Analysing diff with {provider.value}…[/cyan]")
    full_prompt = REVIEW_PROMPT + f"```diff\n{diff_text}\n```"
    return _run_ai_cli(provider, full_prompt)


def post_review(pr_number: int, review_body: str, repo: str | None = None) -> None:
    """Post the review as a comment on the PR via `gh pr review`."""
    target = f" on {repo}" if repo else ""
    console.print(f"[cyan]Posting review to PR #{pr_number}{target}…[/cyan]")
    _run_gh(
        ["pr", "review", str(pr_number), "--comment", "--body", review_body],
        repo=repo,
    )
    console.print("[bold green]✔ Review posted successfully![/bold green]")


# ─── CLI command ─────────────────────────────────────────────────────────────


@app.command()
def review(
    pr_number: int = typer.Argument(
        ...,
        help="The number of the Pull Request to review.",
        min=1,
    ),
    repo: str = typer.Option(
        None,
        "--repo",
        "-R",
        help="Target repo as owner/repo (e.g. 'facebook/react'). Uses local git remote if omitted.",
    ),
    provider: Provider = typer.Option(
        Provider.claude,
        "--provider",
        "-P",
        help="Which AI CLI to use for the review.",
    ),
    post: bool = typer.Option(
        False,
        "--post",
        "-p",
        help="Post the review as a comment on the PR.",
    ),
) -> None:
    """
    🔍 Review a GitHub Pull Request with AI.

    Fetches the diff using the GitHub CLI, analyses it with Claude,
    Antigravity, or Codex, and optionally posts the review back to the PR.
    """
    # 0. Ensure authenticated
    ensure_gh_auth()
    console.print()

    # 1. Fetch the diff
    diff_text = fetch_diff(pr_number, repo=repo)

    # 2. Analyse with chosen CLI
    review_text = analyze_diff(diff_text, provider)

    # 3. Display locally
    title_suffix = f" @ {repo}" if repo else ""
    console.print()
    console.print(
        Panel(
            Markdown(review_text),
            title=f"[bold]AI Review — PR #{pr_number}{title_suffix} ({provider.value})[/bold]",
            border_style="green",
            padding=(1, 2),
        )
    )

    # 4. Optionally post to GitHub
    if post:
        post_review(pr_number, review_text, repo=repo)
    else:
        console.print(
            "\n[dim]Tip: re-run with [bold]--post[/bold] to submit this review to GitHub.[/dim]"
        )


# ─── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app()
