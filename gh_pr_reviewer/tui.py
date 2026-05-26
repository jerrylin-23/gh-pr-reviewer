"""
Agentic GitHub PR Reviewer — Interactive TUI
─────────────────────────────────────────────
A terminal dashboard for reviewing GitHub PRs with AI.
Uses Claude CLI or Antigravity CLI — no API keys needed.
Handles GitHub auth on startup.
Auto-completes repos and PRs as you type.

Launch:
    python tui.py
"""

from __future__ import annotations

import json
import os
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

PROVIDERS = [
    ("Claude CLI", "claude"),
    ("Antigravity CLI", "antigravity"),
]

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


def call_ai_cli(provider: str, diff_text: str) -> tuple[bool, str]:
    """Send the diff to Claude or Antigravity CLI via subprocess."""
    full_prompt = REVIEW_PROMPT + f"```diff\n{diff_text}\n```"
    cmd = [provider, "-p", full_prompt]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=300,
        )
        output = result.stdout.strip()
        if not output:
            return False, f"{provider} returned an empty response."
        return True, output
    except FileNotFoundError:
        hint = (
            "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code"
            if provider == "claude"
            else "Install Antigravity CLI from your internal tooling."
        )
        return False, f"{provider} CLI not found.\n{hint}"
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No details."
        return False, f"{provider} failed (exit {exc.returncode}):\n{stderr}"
    except subprocess.TimeoutExpired:
        return False, f"{provider} timed out (5 min). The diff may be too large."


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
    SUB_TITLE = "Claude / Antigravity + GitHub CLI"
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
