import os
import sys
import json
import shlex
import shutil
import subprocess
import webview

# ─── Path Injection for GUI Context ──────────────────────────────────────────

def inject_common_paths():
    paths = os.environ.get("PATH", "").split(os.path.pathsep)
    common_dirs = [
        os.path.expanduser("~/.local/bin"),
        os.path.expanduser("~/bin"),
        os.path.expanduser("~/.cargo/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        os.path.expanduser("~/.npm-global/bin"),
        os.path.expanduser("~/node_modules/.bin"),
    ]
    modified = False
    for d in common_dirs:
        if os.path.exists(d) and d not in paths:
            paths.append(d)
            modified = True
    if modified:
        os.environ["PATH"] = os.path.pathsep.join(paths)

inject_common_paths()

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
    """Resolve CLI paths from GUI apps that do not inherit the user's shell PATH."""
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

# ─── Auth / GitHub Helpers ──────────────────────────────────────────────────

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
    """Search public GitHub repos matching a query via `gh search repos`."""
    if not query or len(query.strip()) < 2:
        return []
    try:
        result = subprocess.run(
            [
                "gh", "search", "repos", query.strip(),
                "--json", "fullName",
                "--limit", str(limit),
            ],
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
                "--json", "number,title,author",
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
         "--json", "title,author,additions,deletions,changedFiles"],
        repo=repo,
    )
    if not ok:
        return False, out
    try:
        return True, json.loads(out)
    except json.JSONDecodeError:
        return False, "Failed to parse PR metadata."


# ─── AI Helper ──────────────────────────────────────────────────────────────

REVIEW_PROMPT = """\
You are a senior software engineer reviewing a GitHub pull request.

Review the unified diff and produce a concise, findings-first code review.
Focus on real defects, regressions, security issues, data-loss risks, broken
edge cases, and maintainability problems that would matter before merging.
Prioritize source-code changes. Treat generated snapshots, lockfiles, build
artifacts, vendored files, and golden-output updates as supporting evidence
unless they reveal an actual source bug.

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
2-3 sentences on what changed and any residual risk. Mention test gaps only if
they matter.

Rules:
- Put findings first. If there are no substantive issues, write
  "No blocking issues found" under Findings and keep the rest brief.
- Do not invent problems. Tie every finding to evidence in the diff.
- Avoid generic praise, style nits, and broad best-practice advice.
- Do not paste large chunks of the diff back to the user.
- Prefer actionable feedback over commentary.
- Keep each finding readable by a busy developer in under 8 lines.

Here is the Pull Request diff to review:

"""

import concurrent.futures

SUPPORTED_PROVIDERS = {
    "claude": {
        "label": "Claude CLI",
        "command": ["claude", "--print", "--output-format", "text"],
    },
    "antigravity": {
        "label": "Antigravity CLI",
        "command": ["agy", "--print", "--print-timeout", "5m"],
    },
    "codex": {
        "label": "Codex CLI",
        "command": [
            "codex", "exec",
            "--skip-git-repo-check",
            "--sandbox", "read-only",
            "-c", "approval_policy=\"never\"",
            "--ephemeral",
            "--ignore-rules",
            "--color", "never",
            "-",
        ],
    },
}

def get_available_providers() -> list[str]:
    """Detect which local AI CLI tools are installed and available in the PATH."""
    available = []
    for provider, config in SUPPORTED_PROVIDERS.items():
        executable = config["command"][0]
        if resolve_executable(executable) is not None:
            available.append(provider)
    return available

def get_provider_options() -> list[dict]:
    """Return provider options that should be shown in the GUI."""
    available = get_available_providers()
    options = []
    if len(available) > 1:
        options.append({"value": "council", "label": "Council Mode"})
    options.extend(
        {"value": provider, "label": SUPPORTED_PROVIDERS[provider]["label"]}
        for provider in available
    )
    return options

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

def call_ai_cli(provider: str, diff_text: str) -> tuple[bool, str]:
    """Send the diff to a supported local AI CLI via subprocess."""
    if provider not in SUPPORTED_PROVIDERS:
        return False, (
            f"{provider} is not configured as a supported non-interactive provider.\n"
            "Use Claude, Antigravity, or Codex, or add a provider-specific command adapter first."
        )

    full_prompt = REVIEW_PROMPT + f"```diff\n{diff_text}\n```"
    configured_cmd = SUPPORTED_PROVIDERS[provider]["command"]
    executable = resolve_executable(configured_cmd[0])
    if not executable:
        return False, f"{provider} CLI not found. Expected executable: {configured_cmd[0]}"
    cmd = [executable, *configured_cmd[1:]]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=True, timeout=300,
            input=full_prompt,
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


# ─── API Class exposed to Javascript ────────────────────────────────────────

class API:
    def __init__(self, repo: str | None = None, pr: str | None = None):
        self.repo = repo
        self.pr = pr

    def get_init_args(self):
        return {"repo": self.repo, "pr": self.pr}

    def check_auth(self):
        is_authed, info = check_gh_auth()
        return {"is_authed": is_authed, "username_or_error": info}

    def trigger_login(self):
        is_authed, info = run_gh_login()
        return {"is_authed": is_authed, "username_or_error": info}

    def fetch_repos(self):
        return fetch_user_repos()

    def fetch_providers(self):
        return get_provider_options()

    def search_repos(self, query):
        return search_repos(query)

    def fetch_prs(self, repo):
        return fetch_open_prs(repo)

    def fetch_pr_details(self, repo, pr_num):
        ok_meta, meta = fetch_pr_metadata(pr_num, repo)
        ok_diff, diff = run_gh(["pr", "diff", str(pr_num)], repo)

        if not ok_diff:
            return {"success": False, "error": diff}

        if ok_meta and isinstance(meta, dict):
            metadata = {
                "title": meta.get("title", ""),
                "author": meta.get("author", {}).get("login", ""),
                "additions": meta.get("additions", 0),
                "deletions": meta.get("deletions", 0),
                "changedFiles": meta.get("changedFiles", 0),
                "diff": diff
            }
            return {"success": True, "metadata": metadata}
        else:
            metadata = {
                "title": f"PR #{pr_num}",
                "author": "unknown",
                "additions": 0,
                "deletions": 0,
                "changedFiles": 0,
                "diff": diff
            }
            return {"success": True, "metadata": metadata}

    def generate_review(self, diff_text, provider):
        if provider == "council":
            available = get_available_providers()
            if not available:
                return {"success": False, "error": "No supported AI CLIs (claude, agy, codex) found in your PATH."}

            if len(available) == 1:
                single_provider = available[0]
                ok, review = call_ai_cli(single_provider, diff_text)
                if ok:
                    review = f"> **Note:** Council Mode requested, but only `{single_provider}` was found. Running single review.\n\n" + review
                    return {"success": True, "review": review}
                else:
                    return {"success": False, "error": review}

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
                return {"success": False, "error": "All council reviewers failed to generate reviews."}

            if len(reviews) == 1:
                p, r = list(reviews.items())[0]
                skipped = format_skipped_providers(failed)
                note = f"> **Council Mode:** only `{p}` succeeded."
                if skipped:
                    note += f" Skipped providers: {skipped}."
                r = note + "\n\n" + r
                return {"success": True, "review": r}

            # Synthesize using a provider that already completed successfully.
            moderator = next(p for p in available if p in reviews)
            synthesis_input = COUNCIL_PROMPT + "\n\n"
            for p, r in reviews.items():
                synthesis_input += f"### Reviewer: {p}\n\n{r}\n\n---\n\n"

            ok, final_review = call_ai_cli(moderator, synthesis_input)
            if ok:
                participants = ", ".join([f"`{p}`" for p in reviews.keys()])
                header = f"> **Council Review Consensus**\n> Generated by: {participants} | Synthesized by: `{moderator}`\n\n"
                if failed:
                    skipped = format_skipped_providers(failed)
                    header += f"> Skipped providers: {skipped}\n\n"
                return {"success": True, "review": header + final_review}
            else:
                fallback = "> **Note:** Synthesis failed. Appending individual reviews:\n\n"
                if failed:
                    skipped = format_skipped_providers(failed)
                    fallback += f"> Skipped providers: {skipped}\n\n"
                for p, r in reviews.items():
                    fallback += f"## Reviewer: {p}\n\n{r}\n\n"
                return {"success": True, "review": fallback}
        else:
            ok, review = call_ai_cli(provider, diff_text)
            if ok:
                return {"success": True, "review": review}
            else:
                return {"success": False, "error": review}

    def post_review(self, repo, pr_num, review_text):
        ok, result = run_gh(
            ["pr", "review", str(pr_num), "--comment", "--body", review_text],
            repo=repo
        )
        if ok:
            return {"success": True}
        else:
            return {"success": False, "error": result}

    def check_mcp_config(self):
        """Check if MCP server is configured in Claude Desktop config."""
        config_path = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
        if not os.path.exists(config_path):
            return {"configured": False, "exists": False, "path": config_path}
        
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
            
            mcp_servers = config.get("mcpServers", {})
            if "gh-pr-reviewer" in mcp_servers:
                server_config = mcp_servers["gh-pr-reviewer"]
                command_path = server_config.get("command", "")
                return {
                    "configured": bool(command_path),
                    "exists": True,
                    "path": config_path,
                    "command": command_path
                }
            return {"configured": False, "exists": True, "path": config_path}
        except Exception as e:
            return {"configured": False, "exists": True, "path": config_path, "error": str(e)}

    def setup_mcp_config(self):
        """Auto-configure the MCP server inside the user's Claude Desktop config."""
        config_path = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
        config_dir = os.path.dirname(config_path)
        
        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        mcp_executable = os.path.join(project_dir, ".venv", "bin", "pr-reviewer-mcp")
        
        if not os.path.exists(mcp_executable):
            return {
                "success": False,
                "error": f"MCP executable not found at: {mcp_executable}. Make sure .venv is set up."
            }

        try:
            if os.path.exists(config_path):
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        config = json.load(f)
                except Exception:
                    config = {}
            else:
                config = {}

            if "mcpServers" not in config:
                config["mcpServers"] = {}

            config["mcpServers"]["gh-pr-reviewer"] = {
                "command": mcp_executable
            }

            os.makedirs(config_dir, exist_ok=True)

            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)

            return {"success": True, "path": config_path, "command": mcp_executable}
        except Exception as e:
            return {"success": False, "error": f"Failed to write configuration: {str(e)}"}



# ─── Asset Loader helper ────────────────────────────────────────────────────

def get_asset_path(filename):
    """Get absolute path to resource, works for dev and for PyInstaller"""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, filename)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)


# ─── GUI Entrypoint ──────────────────────────────────────────────────────────

def run_gui():
    import argparse
    parser = argparse.ArgumentParser(description="PR Reviewer GUI")
    parser.add_argument("--repo", help="Initial repository (owner/repo)")
    parser.add_argument("--pr", help="Initial PR number")
    args, _ = parser.parse_known_args()

    html_path = get_asset_path("index.html")
    api = API(repo=args.repo, pr=args.pr)

    window = webview.create_window(
        title="Agentic PR Reviewer",
        url=html_path,
        js_api=api,
        width=1200,
        height=800,
        min_size=(1000, 700)
    )
    webview.start()


if __name__ == "__main__":
    run_gui()
