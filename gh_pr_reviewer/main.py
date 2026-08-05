"""
Agentic GitHub PR Reviewer
──────────────────────────
Fetches a PR diff via the GitHub CLI (`gh`), analyses it with
Claude CLI, Antigravity CLI, or Codex CLI, and posts the review back as a PR
comment.

Handles GitHub auth — prompts `gh auth login` if needed.

Usage:
    python main.py 42                                           # current repo, claude
    python main.py 42 --repo owner/repo                        # target a specific repo
    python main.py 42 --repo owner/repo --provider antigravity  # use agy
    python main.py 42 --repo owner/repo --provider codex        # use codex
    python main.py 42 --repo owner/repo --post                  # review + post
"""

from __future__ import annotations

import os
import shlex
import shutil
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
# Route all status/error output to stderr so stdout stays clean for the MCP
# stdio transport (JSON-RPC framing) and for any piping of CLI output.
console = Console(stderr=True)

# ─── Constants ───────────────────────────────────────────────────────────────


class Provider(str, Enum):
    claude = "claude"
    antigravity = "antigravity"
    codex = "codex"
    council = "council"


REVIEW_PROMPT = textwrap.dedent("""\
    You are a senior software engineer reviewing a GitHub pull request.

    Review the unified diff and produce a concise, findings-first code review.
    Focus on real defects, regressions, security issues, data-loss risks,
    broken edge cases, and maintainability problems that would matter before
    merging. Prioritize source-code changes. Treat generated snapshots,
    lockfiles, build artifacts, vendored files, and golden-output updates as
    supporting evidence unless they reveal an actual source bug.

    Important operating rule:
    - Do not inspect the local workspace.
    - Do not run shell commands.
    - Do not use tools, request permissions, or access the network.
    - Review only the diff text included in this prompt. If context is missing,
      mention the uncertainty in Summary instead of asking for permissions.

    Output Markdown in exactly this shape:

    ## Decision
    - Status: `Ready` / `Needs changes` / `Blocked`
    - Risk: `Low` / `Medium` / `High`
    - Main reason: one sentence.

    ## Findings
    Use one subsection per issue:

    ### [P0/P1/P2/P3] Short actionable title
    - File: `path/to/file`
    - Evidence: What changed in the diff that proves this.
    - Impact: What breaks or gets riskier.
    - Fix: Smallest practical fix.

    ## Summary
    2-3 sentences on what changed and any residual risk. Mention test gaps only
    if they matter.

    Rules:
    - Put findings first. If there are no substantive issues, write
      "No blocking issues found" under Findings and keep the rest brief.
    - Do not invent problems. Tie every finding to evidence in the diff.
    - Avoid generic praise, style nits, and broad best-practice advice.
    - Do not paste large chunks of the diff back to the user.
    - Prefer actionable feedback over commentary.
    - Keep each finding readable by a busy developer in under 8 lines.

    Here is the Pull Request diff to review:

""")

SUPPORTED_PROVIDER_COMMANDS = {
    Provider.claude: ["claude", "--print", "--output-format", "text"],
    # `agy --print` takes the prompt as its value, so it never reads stdin.
    Provider.antigravity: ["agy", "--print-timeout", "5m", "--print"],
    Provider.codex: [
        "codex", "exec",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        "-c", "approval_policy=\"never\"",
        "--ephemeral",
        "--ignore-rules",
        "--color", "never",
        "-",
    ],
}

#: Providers whose CLI takes the prompt as an argument, not on stdin.
PROMPT_AS_ARGUMENT = {Provider.antigravity}

COMMON_CLI_DIRS = [
    os.path.expanduser("~/.local/bin"),
    os.path.expanduser("~/bin"),
    os.path.expanduser("~/.cargo/bin"),
    os.path.expanduser("~/.npm-global/bin"),
    os.path.expanduser("~/node_modules/.bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
]


def resolve_executable(executable: str) -> str | None:
    """Resolve CLI paths even when PATH differs from the user's login shell."""
    resolved = shutil.which(executable)
    if resolved:
        return resolved

    for directory in COMMON_CLI_DIRS:
        candidate = os.path.join(directory, executable)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    try:
        result = subprocess.run(
            ["/bin/zsh", "-lc", f"command -v {shlex.quote(executable)}"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            candidate = result.stdout.strip().splitlines()[0]
            if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    except (IndexError, FileNotFoundError, subprocess.TimeoutExpired):
        return None

    return None


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
    """Send a prompt to a supported local AI CLI via subprocess."""
    if provider not in SUPPORTED_PROVIDER_COMMANDS:
        console.print(
            Panel(
                f"[bold red]{provider.value} is not configured as a supported "
                "non-interactive provider.[/bold red]\n\n"
                "Use Claude, Antigravity, or Codex, or add a provider-specific command adapter first.",
                title="⚠️  Unsupported provider",
            )
        )
        raise typer.Exit(code=1)

    cli_name = provider.value

    try:
        configured_cmd = SUPPORTED_PROVIDER_COMMANDS[provider]
        executable = resolve_executable(configured_cmd[0])
        if not executable:
            console.print(
                Panel(
                    f"[bold red]{cli_name} CLI not found.[/bold red]\n\n"
                    f"Expected executable: [bold]{configured_cmd[0]}[/bold]",
                    title="⚠️  Missing CLI",
                )
            )
            raise typer.Exit(code=1)

        cmd = [executable, *configured_cmd[1:]]

        # Most CLIs read the prompt from stdin. Some take it as the last argument.
        if provider in PROMPT_AS_ARGUMENT:
            cmd.append(prompt)
            stdin_text = None
        else:
            stdin_text = prompt

        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=300,
            input=stdin_text,
        )
        output = result.stdout.strip()
        output = extract_review_markdown(output)
        if looks_like_raw_diff(output):
            console.print(
                Panel(
                    f"[bold red]{cli_name} returned raw diff text instead of a review.[/bold red]\n\n"
                    "Try another provider or reduce the PR size.",
                    title="⚠️  AI CLI error",
                )
            )
            raise typer.Exit(code=1)
        return output
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


def get_available_providers() -> list[str]:
    available = []
    for provider, command in SUPPORTED_PROVIDER_COMMANDS.items():
        if resolve_executable(command[0]) is not None:
            available.append(provider.value)
    return available

def extract_review_markdown(output: str) -> str:
    """Trim provider progress chatter before the structured review."""
    lines = output.splitlines()
    for index, line in enumerate(lines):
        if line.strip() in {"## Decision", "## Findings", "# Decision", "# Findings"}:
            lines = lines[index:]
            break

    for index, line in enumerate(lines):
        if line.strip().lower() == "tokens used":
            lines = lines[:index]
            break

    return "\n".join(lines).strip()

def looks_like_raw_diff(output: str) -> bool:
    """Detect provider failures that echo the input diff back to the UI."""
    lines = output.splitlines()
    if not lines:
        return False

    if output.lstrip().startswith("diff --git"):
        return True

    diff_markers = 0
    for line in lines:
        if (
            line.startswith("diff --git")
            or line.startswith("@@")
            or line.startswith("+++ ")
            or line.startswith("--- ")
        ):
            diff_markers += 1

    has_review_shape = "## Findings" in output or "## Decision" in output
    return not has_review_shape and diff_markers >= 5

def summarize_provider_error(error: str) -> str:
    """Compress verbose CLI failures into useful council-mode skip reasons."""
    text = error.lower()
    if any(token in text for token in ("quota", "usage limit", "rate limit", "maxed")):
        return "quota or usage limit"
    if any(token in text for token in ("permission", "approval", "operation not permitted")):
        return "permission or sandbox issue"
    if "not found" in text or "expected executable" in text:
        return "not found"
    if "timed out" in text or "timeout" in text:
        return "timeout"
    if "raw diff" in text:
        return "returned raw diff"
    first_line = error.strip().splitlines()[0] if error.strip() else "unknown error"
    return first_line[:90]

def format_skipped_providers(failed: dict[str, str]) -> str:
    return ", ".join(
        f"`{name}` ({summarize_provider_error(error)})"
        for name, error in failed.items()
    )

COUNCIL_PROMPT = """\
You are the Moderator of the AI Code Review Council.
Below are code reviews generated by different AI agents for the same pull request diff.
Some installed agents may have failed due to quota, usage limits, auth, or
timeouts. Ignore failed agents and synthesize only the successful reviews below.
Do not inspect files, run commands, use tools, request permissions, or access
the network. Synthesize only the review text below.

Your task is to produce one concise, high-quality review:
- Preserve the same Decision, Findings, and Summary sections.
- Put actionable findings first inside Findings.
- Keep only issues backed by the diff or by a strong consensus across agents.
- Deduplicate repeated findings.
- Drop generic praise, style-only nits, and speculative advice.
- If the successful reviewers found no substantive issues, say
  "No blocking issues found" and keep the summary brief.

Format the output in clean Markdown with:
## Decision
## Findings
### [P0/P1/P2/P3] Short actionable title
## Summary

Here are the reviews from the council members:
"""

def analyze_diff(diff_text: str, provider: Provider) -> str:
    """Send the diff to the chosen AI CLI and return a Markdown review."""
    if provider == Provider.council:
        import concurrent.futures
        console.print("[cyan]Running Council Review mode…[/cyan]")
        available = get_available_providers()
        if not available:
            console.print("[bold red]Error: No supported AI CLIs (claude, agy, codex) found in your PATH.[/bold red]")
            raise typer.Exit(code=1)

        if len(available) == 1:
            single_provider = available[0]
            console.print(f"[yellow]Only {single_provider} CLI is installed. Running single review.[/yellow]")
            res = _run_ai_cli(Provider(single_provider), REVIEW_PROMPT + f"```diff\n{diff_text}\n```")
            return f"> **Note:** Council Mode requested, but only `{single_provider}` was found. Running single review.\n\n" + res

        console.print(f"[cyan]Invoking council members in parallel: {', '.join(available)}…[/cyan]")

        reviews = {}
        failed = {}
        def run_one(p):
            prov_enum = Provider(p)
            prompt = REVIEW_PROMPT + f"```diff\n{diff_text}\n```"
            try:
                res = _run_ai_cli(prov_enum, prompt)
                return p, True, res
            except Exception as e:
                return p, False, str(e)

        with concurrent.futures.ThreadPoolExecutor() as executor:
            futures = [executor.submit(run_one, p) for p in available]
            for future in concurrent.futures.as_completed(futures):
                p, ok, res = future.result()
                if ok:
                    reviews[p] = res
                    console.print(f"[green]✔ Reviewer {p} completed successfully.[/green]")
                else:
                    failed[p] = res
                    console.print(f"[red]✗ Reviewer {p} failed: {res}[/red]")

        if not reviews:
            console.print("[bold red]Error: All council reviewers failed.[/bold red]")
            raise typer.Exit(code=1)

        if len(reviews) == 1:
            p, r = list(reviews.items())[0]
            skipped = format_skipped_providers(failed)
            note = f"> **Council Mode:** only `{p}` succeeded."
            if skipped:
                note += f" Skipped providers: {skipped}."
            return note + "\n\n" + r

        moderator = next(p for p in available if p in reviews)
        console.print(f"[cyan]Synthesizing reviews using {moderator} as Moderator…[/cyan]")
        synthesis_input = COUNCIL_PROMPT + "\n\n"
        for p, r in reviews.items():
            synthesis_input += f"### Reviewer: {p}\n\n{r}\n\n---\n\n"

        try:
            final_review = _run_ai_cli(Provider(moderator), synthesis_input)
            participants = ", ".join([f"`{p}`" for p in reviews.keys()])
            header = f"> **Council Review Consensus**\n> Generated by: {participants} | Synthesized by: `{moderator}`\n\n"
            if failed:
                skipped = format_skipped_providers(failed)
                header += f"> Skipped providers: {skipped}\n\n"
            return header + final_review
        except Exception as e:
            console.print(f"[yellow]Warning: Synthesis failed ({e}). Appending individual reviews.[/yellow]")
            fallback = "> **Note:** Synthesis failed. Appending individual reviews:\n\n"
            if failed:
                skipped = format_skipped_providers(failed)
                fallback += f"> Skipped providers: {skipped}\n\n"
            for p, r in reviews.items():
                fallback += f"## Reviewer: {p}\n\n{r}\n\n"
            return fallback

    else:
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
