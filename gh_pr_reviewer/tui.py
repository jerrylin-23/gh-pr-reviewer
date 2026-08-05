"""
Agentic GitHub PR Reviewer — Interactive TUI
─────────────────────────────────────────────
A terminal dashboard for reviewing GitHub PRs with AI.
Uses Claude CLI, Antigravity CLI, or Codex CLI — no API keys needed.
Handles GitHub auth on startup.
Auto-completes repos and PRs as you type.

Launch:
    python tui.py
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import textwrap
from enum import Enum

from textual import events, on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    Footer,
    Header,
    Input,
    Label,
    Markdown,
    OptionList,
    Select,
    Static,
    TabbedContent,
    TabPane,
)
from textual.widgets.option_list import Option

# ─── Constants ───────────────────────────────────────────────────────────────

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

PROVIDERS = [
    ("Council Mode", "council"),
    ("Claude CLI", "claude"),
    ("Antigravity CLI", "antigravity"),
    ("Codex CLI", "codex"),
]

#: Providers whose CLI takes the prompt as an argument, not on stdin.
PROMPT_AS_ARGUMENT = {"antigravity"}

SUPPORTED_PROVIDER_COMMANDS = {
    "claude": ["claude", "--print", "--output-format", "text"],
    # `agy --print` takes the prompt as its value, so it never reads stdin.
    "antigravity": ["agy", "--print-timeout", "5m", "--print"],
    "codex": [
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

# ─── Stylesheet ──────────────────────────────────────────────────────────────

CSS = """\
Screen {
    background: $surface;
}

#app-grid {
    layout: grid;
    grid-size: 1;
    grid-rows: auto auto 1fr;
    height: 100%;
    padding: 0 1;
}

/* ── Auth bar ── */

#auth-bar {
    height: auto;
    padding: 1 1 0 1;
    layout: horizontal;
    align: left middle;
}

#auth-status {
    width: 1fr;
    color: $text-muted;
}

#btn-login {
    min-width: 16;
    margin: 0 0 0 1;
}

/* ── Top bar ── */

#top-bar {
    height: auto;
    padding: 1 0;
    layout: horizontal;
    align: left middle;
}

/* ── Autocomplete wrappers ── */

.autocomplete-wrapper {
    height: auto;
    margin: 0 1 0 0;
}

#repo-autocomplete-wrapper {
    width: 32;
}

#pr-autocomplete-wrapper {
    width: 40;
}

.autocomplete-wrapper Input {
    width: 100%;
}

.autocomplete-wrapper OptionList {
    width: 100%;
    max-height: 14;
    display: none;
    layer: overlay;
    border: tall $primary;
    background: $surface;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
}

#provider-select {
    width: 24;
    margin: 0 1 0 0;
}

#btn-fetch {
    margin: 0 1 0 0;
}

#btn-review {
    margin: 0 1 0 0;
}

#btn-post {
    margin: 0 1 0 0;
}

#status-label {
    width: 1fr;
    content-align: right middle;
    color: $text-muted;
    padding: 0 1;
}

Button {
    min-width: 14;
}

/* ── Main content ── */

#content-area {
    height: 1fr;
}

TabPane {
    padding: 0;
}

#diff-view {
    height: 1fr;
    padding: 1 2;
}

#diff-text {
    height: auto;
}

#review-view {
    height: 1fr;
    padding: 1 2;
}

#review-markdown {
    height: auto;
}

#welcome-message {
    height: 1fr;
    content-align: center middle;
    color: $text-muted;
    text-style: italic;
    padding: 4;
}

/* ── Login modal ── */

LoginScreen {
    align: center middle;
}

#login-dialog {
    width: 60;
    height: auto;
    padding: 2 4;
    background: $surface;
    border: tall $primary;
}

#login-dialog Label {
    width: 100%;
    margin: 1 0;
}

#login-buttons {
    layout: horizontal;
    height: auto;
    align: center middle;
    margin: 1 0 0 0;
}

#login-buttons Button {
    margin: 0 1;
}
"""


# ─── gh CLI helpers ──────────────────────────────────────────────────────────


def run_gh(args: list[str], repo: str | None = None) -> tuple[bool, str]:
    """Run a `gh` CLI command. Returns (success, output_or_error)."""
    cmd = ["gh", *args]
    if repo:
        cmd.extend(["-R", repo])
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=120,
        )
        return True, result.stdout.strip()
    except FileNotFoundError:
        return False, (
            "GitHub CLI (gh) not found.\n"
            "Install: https://cli.github.com\n"
            "Then run: gh auth login"
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No details."
        return False, f"gh failed (exit {exc.returncode}):\n{stderr}"
    except subprocess.TimeoutExpired:
        return False, "gh command timed out (120s). Check your connection."


def check_gh_auth() -> tuple[bool, str]:
    """Check if gh is authenticated. Returns (is_authed, username_or_error)."""
    try:
        result = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True, text=True, timeout=10,
        )
        output = result.stdout + result.stderr
        if result.returncode == 0:
            try:
                user_result = subprocess.run(
                    ["gh", "api", "user", "--jq", ".login"],
                    capture_output=True, text=True, check=True, timeout=10,
                )
                username = user_result.stdout.strip()
                if username:
                    return True, username
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                pass
            return True, "authenticated"
        return False, output.strip()
    except FileNotFoundError:
        return False, "gh CLI not installed"
    except subprocess.TimeoutExpired:
        return False, "Auth check timed out"


def run_gh_login() -> tuple[bool, str]:
    """Run `gh auth login --web` interactively."""
    try:
        result = subprocess.run(["gh", "auth", "login", "--web"], timeout=300)
        if result.returncode == 0:
            ok, user = check_gh_auth()
            return ok, user
        return False, "Login cancelled or failed"
    except FileNotFoundError:
        return False, "gh CLI not installed"
    except subprocess.TimeoutExpired:
        return False, "Login timed out"


def fetch_user_repos(limit: int = 200) -> list[str]:
    """Fetch the authenticated user's repos via `gh repo list`."""
    try:
        result = subprocess.run(
            ["gh", "repo", "list", "--json", "nameWithOwner", "--limit", str(limit)],
            capture_output=True, text=True, check=True, timeout=30,
        )
        repos = json.loads(result.stdout)
        return [r["nameWithOwner"] for r in repos]
    except (FileNotFoundError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
        return []


def search_repos(query: str, limit: int = 10) -> list[str]:
    """Search GitHub repos matching a query via `gh search repos`."""
    if not query or len(query) < 2:
        return []
    try:
        result = subprocess.run(
            ["gh", "search", "repos", query, "--json", "fullName", "--limit", str(limit)],
            capture_output=True, text=True, check=True, timeout=15,
        )
        repos = json.loads(result.stdout)
        return [r["fullName"] for r in repos]
    except (FileNotFoundError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, json.JSONDecodeError, KeyError):
        return []


def fetch_open_prs(repo: str, limit: int = 30) -> list[dict]:
    """
    Fetch open PRs for a repo via `gh pr list`.
    Returns list of dicts with number, title, author.
    """
    try:
        result = subprocess.run(
            [
                "gh", "pr", "list",
                "-R", repo,
                "--state", "open",
                "--json", "number,title,author,headRefName",
                "--limit", str(limit),
            ],
            capture_output=True, text=True, check=True, timeout=20,
        )
        return json.loads(result.stdout)
    except (FileNotFoundError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired, json.JSONDecodeError):
        return []


def fetch_pr_metadata(pr_number: int, repo: str | None = None) -> tuple[bool, dict | str]:
    """Fetch PR metadata via `gh pr view`."""
    ok, out = run_gh(
        ["pr", "view", str(pr_number),
         "--json", "title,author,headRefName,baseRefName,state,additions,deletions,changedFiles"],
        repo=repo,
    )
    if not ok:
        return False, out
    try:
        return True, json.loads(out)
    except json.JSONDecodeError:
        return False, "Failed to parse PR metadata."


# ─── AI CLI helper ──────────────────────────────────────────────────────────


def call_ai_cli(provider: str, diff_text: str, wrap: bool = True) -> tuple[bool, str]:
    """Send a prompt to a supported local AI CLI via subprocess.

    When ``wrap`` is True (the default), ``diff_text`` is wrapped in the review
    prompt + diff fence. Pass ``wrap=False`` to send it verbatim — used for
    council synthesis, whose input is already a complete moderator prompt and
    must not be re-wrapped as a diff to review.
    """
    import concurrent.futures

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

    if provider == "council":
        available = []
        for p, command in SUPPORTED_PROVIDER_COMMANDS.items():
            if resolve_executable(command[0]) is not None:
                available.append(p)

        if not available:
            return False, "No supported AI CLIs (claude, agy, codex) found in your PATH."

        if len(available) == 1:
            single_provider = available[0]
            ok, review = call_ai_cli(single_provider, diff_text)
            if ok:
                return True, f"> **Note:** Council Mode requested, but only `{single_provider}` was found. Running single review.\n\n" + review
            return False, review

        # Run reviews in parallel
        reviews = {}
        failed = {}
        def run_one(p):
            ok, res = call_ai_cli(p, diff_text)
            return p, ok, res

        with concurrent.futures.ThreadPoolExecutor() as executor:
            futures = [executor.submit(run_one, p) for p in available]
            for future in concurrent.futures.as_completed(futures):
                p, ok, res = future.result()
                if ok:
                    reviews[p] = res
                else:
                    failed[p] = res

        if not reviews:
            return False, "All council reviewers failed to generate reviews."

        if len(reviews) == 1:
            p, r = list(reviews.items())[0]
            skipped = format_skipped_providers(failed)
            note = f"> **Council Mode:** only `{p}` succeeded."
            if skipped:
                note += f" Skipped providers: {skipped}."
            return True, note + "\n\n" + r

        # Synthesize using a provider that already completed successfully.
        moderator = next(p for p in available if p in reviews)
        synthesis_input = COUNCIL_PROMPT + "\n\n"
        for p, r in reviews.items():
            synthesis_input += f"### Reviewer: {p}\n\n{r}\n\n---\n\n"

        ok, final_review = call_ai_cli(moderator, synthesis_input, wrap=False)
        if ok:
            participants = ", ".join([f"`{p}`" for p in reviews.keys()])
            header = f"> **Council Review Consensus**\n> Generated by: {participants} | Synthesized by: `{moderator}`\n\n"
            if failed:
                skipped = format_skipped_providers(failed)
                header += f"> Skipped providers: {skipped}\n\n"
            return True, header + final_review
        else:
            fallback = "> **Note:** Synthesis failed. Appending individual reviews:\n\n"
            if failed:
                skipped = format_skipped_providers(failed)
                fallback += f"> Skipped providers: {skipped}\n\n"
            for p, r in reviews.items():
                fallback += f"## Reviewer: {p}\n\n{r}\n\n"
            return True, fallback

    full_prompt = REVIEW_PROMPT + f"```diff\n{diff_text}\n```" if wrap else diff_text
    if provider not in SUPPORTED_PROVIDER_COMMANDS:
        return False, (
            f"{provider} is not configured as a supported non-interactive provider.\n"
            "Use Claude, Antigravity, or Codex, or add a provider-specific command adapter first."
        )

    configured_cmd = SUPPORTED_PROVIDER_COMMANDS[provider]
    executable = resolve_executable(configured_cmd[0])
    if not executable:
        return False, f"{provider} CLI not found. Expected executable: {configured_cmd[0]}"
    cmd = [executable, *configured_cmd[1:]]

    # Most CLIs read the prompt from stdin. Some take it as the last argument.
    if provider in PROMPT_AS_ARGUMENT:
        cmd.append(full_prompt)
        stdin_text = None
    else:
        stdin_text = full_prompt

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=300,
            input=stdin_text,
        )
        output = result.stdout.strip()
        if not output:
            return False, f"{provider} returned an empty response."
        output = extract_review_markdown(output)
        if looks_like_raw_diff(output):
            return False, (
                f"{provider} returned raw diff text instead of a review. "
                "Try another provider or reduce the PR size."
            )
        return True, output
    except FileNotFoundError:
        hint = (
            "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code"
            if provider == "claude"
            else "Make sure the CLI tool is installed and in your PATH."
        )
        return False, f"{provider} CLI not found.\n{hint}"
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No details."
        return False, f"{provider} failed (exit {exc.returncode}):\n{stderr}"
    except subprocess.TimeoutExpired:
        return False, f"{provider} timed out (5 min). The diff may be too large."


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


# ─── Colourised diff helper ─────────────────────────────────────────────────


def colourise_diff(diff_text: str) -> str:
    """Apply Rich markup to unified diff lines."""
    lines: list[str] = []
    for raw_line in diff_text.splitlines():
        escaped = raw_line.replace("[", "\\[")
        if raw_line.startswith("+++") or raw_line.startswith("---"):
            lines.append(f"[bold yellow]{escaped}[/]")
        elif raw_line.startswith("@@"):
            lines.append(f"[bold cyan]{escaped}[/]")
        elif raw_line.startswith("+"):
            lines.append(f"[green]{escaped}[/]")
        elif raw_line.startswith("-"):
            lines.append(f"[red]{escaped}[/]")
        elif raw_line.startswith("diff "):
            lines.append(f"[bold magenta]{escaped}[/]")
        else:
            lines.append(escaped)
    return "\n".join(lines)


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len, adding ellipsis if needed."""
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


# ─── Login Modal ─────────────────────────────────────────────────────────────


class LoginScreen(ModalScreen[bool]):
    """Modal screen that triggers `gh auth login --web`."""

    def compose(self) -> ComposeResult:
        with Vertical(id="login-dialog"):
            yield Label("[bold]🔑 GitHub Sign-In[/bold]")
            yield Label(
                "You're not signed in to GitHub.\n"
                "This will open your browser for authentication."
            )
            with Horizontal(id="login-buttons"):
                yield Button("Sign In", id="btn-do-login", variant="primary")
                yield Button("Cancel", id="btn-cancel-login", variant="default")

    @on(Button.Pressed, "#btn-do-login")
    def on_login(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#btn-cancel-login")
    def on_cancel(self) -> None:
        self.dismiss(False)


# ─── TUI Application ────────────────────────────────────────────────────────


class ReviewerApp(App):
    """Agentic GitHub PR Reviewer — Terminal Dashboard."""

    TITLE = "PR Reviewer"
    SUB_TITLE = "Claude / Antigravity / Codex + GitHub CLI"
    CSS = CSS

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit", show=True),
        Binding("ctrl+f", "focus_input", "Focus Input", show=True),
        Binding("ctrl+r", "trigger_review", "Review", show=True),
        Binding("ctrl+l", "trigger_login", "Sign In", show=True),
        Binding("escape", "clear_input", "Clear Search", show=True),
    ]

    # Reactive state
    pr_number: reactive[int | None] = reactive(None)
    diff_text: reactive[str] = reactive("")
    review_text: reactive[str] = reactive("")
    status_message: reactive[str] = reactive("Enter a repo and PR number to begin")
    selected_provider: reactive[str] = reactive("claude")
    gh_username: reactive[str] = reactive("")

    # Autocomplete state
    _all_repos: list[str] = []
    _search_pending: str = ""
    _pr_list: list[dict] = []       # cached open PRs for the current repo
    _pr_repo: str = ""              # which repo _pr_list is for

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)

        with Container(id="app-grid"):
            # ── Auth bar ──
            with Horizontal(id="auth-bar"):
                yield Label("🔑 Checking auth…", id="auth-status")
                yield Button("Sign In", id="btn-login", variant="primary")

            # ── Top action bar ──
            with Horizontal(id="top-bar"):
                with Vertical(id="repo-autocomplete-wrapper", classes="autocomplete-wrapper"):
                    yield Input(
                        placeholder="owner/repo — type to search…",
                        id="repo-input",
                        max_length=100,
                    )
                    yield OptionList(id="repo-suggestions")

                with Vertical(id="pr-autocomplete-wrapper", classes="autocomplete-wrapper"):
                    yield Input(
                        placeholder="PR # — select repo first",
                        id="pr-input",
                        max_length=8,
                    )
                    yield OptionList(id="pr-suggestions")

                yield Select(
                    PROVIDERS,
                    value="claude",
                    id="provider-select",
                    allow_blank=False,
                )
                yield Button("⬇ Fetch", id="btn-fetch", variant="primary")
                yield Button("🔍 Review", id="btn-review", variant="warning", disabled=True)
                yield Button("📤 Post", id="btn-post", variant="success", disabled=True)
                yield Label(self.status_message, id="status-label")

            # ── Tabbed content area ──
            with TabbedContent(id="content-area"):
                with TabPane("Diff", id="tab-diff"):
                    yield Static(
                        "[dim italic]Fetch a PR to see its diff here…[/]",
                        id="welcome-message",
                    )
                    with VerticalScroll(id="diff-view"):
                        yield Static(id="diff-text", markup=True)

                with TabPane("AI Review", id="tab-review"):
                    with VerticalScroll(id="review-view"):
                        yield Markdown(id="review-markdown")

        yield Footer()

    def on_mount(self) -> None:
        self.query_one("#diff-view").display = False
        self._check_auth()

    # ─── Watchers ────────────────────────────────────────────────────────

    def watch_status_message(self, message: str) -> None:
        try:
            self.query_one("#status-label", Label).update(message)
        except Exception:
            pass

    def watch_gh_username(self, username: str) -> None:
        auth_label = self.query_one("#auth-status", Label)
        login_btn = self.query_one("#btn-login", Button)
        if username:
            auth_label.update(f"[green]✔ Signed in as [bold]{username}[/bold][/green]")
            login_btn.label = "Switch Account"
            login_btn.variant = "default"
            self._load_repos()
        else:
            auth_label.update("[yellow]⚠ Not signed in[/yellow]")
            login_btn.label = "Sign In"
            login_btn.variant = "primary"

    # ─── Actions ─────────────────────────────────────────────────────────

    def action_focus_input(self) -> None:
        self.query_one("#repo-input", Input).focus()

    def action_trigger_review(self) -> None:
        if self.diff_text:
            self._do_review()

    def action_trigger_login(self) -> None:
        self._prompt_login()

    def action_clear_input(self) -> None:
        """Clear the currently focused input and hide suggestions."""
        focused = self.focused
        if isinstance(focused, Input):
            focused.value = ""
        self._hide_all_suggestions()

    # ─── Repo autocomplete ──────────────────────────────────────────────

    @work(thread=True, exclusive=True, group="repos")
    def _load_repos(self) -> None:
        """Load user's repos in the background after auth."""
        repos = fetch_user_repos(limit=200)
        self._all_repos = sorted(repos, key=str.lower)

    def on_descendant_focus(self, event: events.DescendantFocus) -> None:
        """Show suggestions when input is focused."""
        if event.widget.id == "repo-input":
            self._update_repo_suggestions_for_query(self.query_one("#repo-input", Input).value)
        elif event.widget.id == "pr-input":
            self._update_pr_suggestions_for_query(self.query_one("#pr-input", Input).value)

    @on(Input.Changed, "#repo-input")
    def on_repo_input_changed(self, event: Input.Changed) -> None:
        """Filter repo suggestions as the user types."""
        self._update_repo_suggestions_for_query(event.value)

    def _update_repo_suggestions_for_query(self, query_str: str) -> None:
        query = query_str.strip().lower()
        suggestions = self.query_one("#repo-suggestions", OptionList)

        if not query:
            if self._all_repos:
                suggestions.clear_options()
                for repo in self._all_repos:
                    suggestions.add_option(Option(_truncate(repo, 30), id=repo))
                suggestions.display = True
            else:
                suggestions.display = False
            return

        # Filter local repos
        matches = [r for r in self._all_repos if query in r.lower()]

        if matches:
            suggestions.clear_options()
            for repo in matches:
                suggestions.add_option(Option(_truncate(repo, 30), id=repo))
            suggestions.display = True
        else:
            # Search GitHub
            self._search_pending = query
            self._search_remote_repos(query)

    @work(thread=True, exclusive=True, group="repo-search")
    def _search_remote_repos(self, query: str) -> None:
        """Search GitHub for repos matching the query."""
        if len(query) < 2:
            return
        results = search_repos(query, limit=10)
        if self._search_pending == query and results:
            self.call_from_thread(self._update_repo_suggestions, results)

    def _update_repo_suggestions(self, repos: list[str]) -> None:
        suggestions = self.query_one("#repo-suggestions", OptionList)
        suggestions.clear_options()
        for repo in repos:
            suggestions.add_option(Option(_truncate(repo, 30), id=repo))
        suggestions.display = bool(repos)

    @on(OptionList.OptionSelected, "#repo-suggestions")
    def on_repo_suggestion_selected(self, event: OptionList.OptionSelected) -> None:
        """User selected a repo from the dropdown."""
        repo_name = str(event.option.id)
        self.query_one("#repo-input", Input).value = repo_name
        self.query_one("#repo-suggestions", OptionList).display = False
        # Load PRs for this repo, then focus PR input
        self._load_prs_for_repo(repo_name)
        self.query_one("#pr-input", Input).focus()

    @on(Input.Submitted, "#repo-input")
    def on_repo_submit(self, event: Input.Submitted) -> None:
        """Hide suggestions, load PRs, focus PR input on Enter."""
        self.query_one("#repo-suggestions", OptionList).display = False
        repo = event.value.strip()
        if repo:
            self._load_prs_for_repo(repo)
        self.query_one("#pr-input", Input).focus()

    # ─── PR autocomplete ────────────────────────────────────────────────

    @work(thread=True, exclusive=True, group="pr-list")
    def _load_prs_for_repo(self, repo: str) -> None:
        """Fetch open PRs for a repo in background."""
        self.status_message = f"[cyan]⏳ Loading PRs for {repo}…[/]"
        prs = fetch_open_prs(repo, limit=30)
        self._pr_list = prs
        self._pr_repo = repo

        if prs:
            self.call_from_thread(self._show_pr_suggestions, prs)
            count = len(prs)
            self.status_message = f"[green]✔ {count} open PR{'s' if count != 1 else ''} in {repo}[/]"
        else:
            self.status_message = f"[yellow]No open PRs found in {repo}[/]"

    def _show_pr_suggestions(self, prs: list[dict], filter_text: str = "") -> None:
        """Populate the PR dropdown with open PRs."""
        suggestions = self.query_one("#pr-suggestions", OptionList)
        suggestions.clear_options()

        for pr in prs:
            num = pr.get("number", 0)
            title = pr.get("title", "")
            author = pr.get("author", {}).get("login", "")
            branch = pr.get("headRefName", "")

            num_str = str(num)
            # Filter by typed text
            if filter_text:
                search = filter_text.lower()
                if not (
                    search in num_str
                    or search in title.lower()
                    or search in author.lower()
                    or search in branch.lower()
                ):
                    continue

            label = _truncate(f"#{num}  {title}  ({author})", 38)
            suggestions.add_option(Option(label, id=num_str))

        suggestions.display = suggestions.option_count > 0

    @on(Input.Changed, "#pr-input")
    def on_pr_input_changed(self, event: Input.Changed) -> None:
        """Filter PR suggestions as the user types."""
        self._update_pr_suggestions_for_query(event.value)

    def _update_pr_suggestions_for_query(self, query_str: str) -> None:
        query = query_str.strip()
        repo = self._get_repo()

        # If we have cached PRs for this repo, filter them
        if self._pr_list and repo and repo == self._pr_repo:
            self._show_pr_suggestions(self._pr_list, filter_text=query)
        else:
            self.query_one("#pr-suggestions", OptionList).display = False

    @on(OptionList.OptionSelected, "#pr-suggestions")
    def on_pr_suggestion_selected(self, event: OptionList.OptionSelected) -> None:
        """User selected a PR from the dropdown."""
        pr_num = str(event.option.id)
        self.query_one("#pr-input", Input).value = pr_num
        self.query_one("#pr-suggestions", OptionList).display = False
        # Auto-fetch the diff
        self._do_fetch()

    @on(Input.Submitted, "#pr-input")
    def on_pr_submit(self, event: Input.Submitted) -> None:
        self.query_one("#pr-suggestions", OptionList).display = False
        if event.value.strip():
            self._do_fetch()

    # ─── Event handlers ─────────────────────────────────────────────────

    @on(Select.Changed, "#provider-select")
    def on_provider_changed(self, event: Select.Changed) -> None:
        self.selected_provider = str(event.value)

    @on(Button.Pressed, "#btn-login")
    def on_login_pressed(self) -> None:
        self._prompt_login()

    @on(Button.Pressed, "#btn-fetch")
    def on_fetch_pressed(self) -> None:
        self._do_fetch()

    @on(Button.Pressed, "#btn-review")
    def on_review_pressed(self) -> None:
        self._do_review()

    @on(Button.Pressed, "#btn-post")
    def on_post_pressed(self) -> None:
        self._do_post()

    # ─── Auth ────────────────────────────────────────────────────────────

    @work(thread=True, exclusive=True, group="auth")
    def _check_auth(self) -> None:
        ok, info = check_gh_auth()
        self.gh_username = info if ok else ""
        if not ok:
            self.status_message = "[yellow]Sign in to GitHub to get started[/yellow]"

    def _prompt_login(self) -> None:
        def _on_dismiss(should_login: bool) -> None:
            if should_login:
                self._do_login()
        self.push_screen(LoginScreen(), callback=_on_dismiss)

    @work(thread=True, exclusive=True, group="auth")
    def _do_login(self) -> None:
        self.status_message = "[cyan]⏳ Waiting for GitHub sign-in…[/]"
        ok, result = run_gh_login()
        if ok:
            self.gh_username = result
            self.status_message = f"[green]✔ Signed in as {result}[/green]"
        else:
            self.gh_username = ""
            self.status_message = f"[red]✗ Login failed: {result}[/]"

    # ─── Workers ─────────────────────────────────────────────────────────

    def _get_repo(self) -> str | None:
        value = self.query_one("#repo-input", Input).value.strip()
        return value if value else None

    @work(thread=True, exclusive=True, group="fetch")
    def _do_fetch(self) -> None:
        inp = self.query_one("#pr-input", Input)
        value = inp.value.strip()
        repo = self._get_repo()

        if not value:
            self.status_message = "[yellow]Enter a PR number first[/]"
            return

        try:
            pr_num = int(value)
        except ValueError:
            self.status_message = "[red]Invalid PR number[/]"
            return

        self.pr_number = pr_num
        target = f" from {repo}" if repo else ""
        self.status_message = f"[cyan]⏳ Fetching PR #{pr_num}{target}…[/]"
        self.call_from_thread(self._set_buttons_disabled, True, True, True)
        self.call_from_thread(self._hide_all_suggestions)

        ok_meta, meta = fetch_pr_metadata(pr_num, repo=repo)
        ok_diff, diff = run_gh(["pr", "diff", str(pr_num)], repo=repo)

        if not ok_diff:
            self.status_message = f"[red]✗ {diff}[/]"
            self.call_from_thread(self._set_buttons_disabled, False, True, True)
            return

        self.diff_text = diff

        coloured = colourise_diff(diff)
        diff_widget = self.query_one("#diff-text", Static)
        self.call_from_thread(diff_widget.update, coloured)
        self.call_from_thread(self._show_diff_panel)

        if ok_meta and isinstance(meta, dict):
            title = meta.get("title", "—")
            author = meta.get("author", {}).get("login", "—")
            head = meta.get("headRefName", "—")
            base = meta.get("baseRefName", "—")
            state = meta.get("state", "—")
            adds = meta.get("additions", 0)
            dels = meta.get("deletions", 0)
            files = meta.get("changedFiles", 0)
            info = (
                f"[bold]#{pr_num}[/] {title}  •  "
                f"[dim]{author}[/]  •  "
                f"{head} → {base}  •  "
                f"[green]+{adds}[/] [red]-{dels}[/]  •  "
                f"{files} file{'s' if files != 1 else ''}  •  "
                f"{state}"
            )
            self.status_message = info
        else:
            line_count = len(diff.splitlines())
            self.status_message = f"[green]✔ Fetched PR #{pr_num}[/] — {line_count} lines"

        self.call_from_thread(self._set_buttons_disabled, False, False, True)
        self.call_from_thread(self._switch_tab, "tab-diff")

    @work(thread=True, exclusive=True, group="review")
    def _do_review(self) -> None:
        if not self.diff_text:
            self.status_message = "[yellow]Fetch a PR first[/]"
            return

        provider = self.selected_provider
        self.status_message = f"[cyan]⏳ Reviewing PR #{self.pr_number} with {provider}…[/]"
        self.call_from_thread(self._set_buttons_disabled, True, True, True)

        ok, review = call_ai_cli(provider, self.diff_text)

        if not ok:
            self.status_message = f"[red]✗ {review}[/]"
            self.call_from_thread(self._set_buttons_disabled, False, False, True)
            return

        self.review_text = review
        md_widget = self.query_one("#review-markdown", Markdown)
        self.call_from_thread(md_widget.update, review)

        self.status_message = f"[green]✔ Review complete for PR #{self.pr_number} ({provider})[/]"
        self.call_from_thread(self._set_buttons_disabled, False, False, False)
        self.call_from_thread(self._switch_tab, "tab-review")

    @work(thread=True, exclusive=True, group="post")
    def _do_post(self) -> None:
        if not self.review_text or not self.pr_number:
            self.status_message = "[yellow]Nothing to post[/]"
            return

        repo = self._get_repo()
        target = f" on {repo}" if repo else ""
        self.status_message = f"[cyan]⏳ Posting review to PR #{self.pr_number}{target}…[/]"
        self.call_from_thread(self._set_buttons_disabled, True, True, True)

        ok, result = run_gh(
            ["pr", "review", str(self.pr_number), "--comment", "--body", self.review_text],
            repo=repo,
        )

        if not ok:
            self.status_message = f"[red]✗ {result}[/]"
        else:
            self.status_message = f"[bold green]✔ Review posted to PR #{self.pr_number}![/]"

        self.call_from_thread(self._set_buttons_disabled, False, False, False)

    # ─── UI helpers ──────────────────────────────────────────────────────

    def _set_buttons_disabled(self, fetch: bool, review: bool, post: bool) -> None:
        self.query_one("#btn-fetch", Button).disabled = fetch
        self.query_one("#btn-review", Button).disabled = review
        self.query_one("#btn-post", Button).disabled = post

    def _show_diff_panel(self) -> None:
        self.query_one("#welcome-message").display = False
        self.query_one("#diff-view").display = True

    def _hide_all_suggestions(self) -> None:
        self.query_one("#repo-suggestions", OptionList).display = False
        self.query_one("#pr-suggestions", OptionList).display = False

    def _switch_tab(self, tab_id: str) -> None:
        tabs = self.query_one(TabbedContent)
        tabs.active = tab_id


# ─── Entrypoint ──────────────────────────────────────────────────────────────

def run_tui() -> None:
    ReviewerApp().run()

if __name__ == "__main__":
    run_tui()
