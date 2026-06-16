"""
MCP server for gh-pr-reviewer.

This module exposes the existing GitHub PR review flow as stdio MCP tools.
It intentionally keeps GitHub access on the existing `gh` CLI path so the
server reuses the user's current GitHub authentication.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

import typer

from gh_pr_reviewer import main as reviewer


VALID_PROVIDERS = {provider.value for provider in reviewer.Provider}


def _load_fastmcp():
    try:
        from mcp.server.fastmcp import FastMCP
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "The MCP Python package is not installed. Run `pip install -e .` "
            "from the gh-pr-reviewer repo, or install `mcp>=1.0.0` in the "
            "environment that launches `pr-reviewer-mcp`."
        ) from exc
    return FastMCP


def _require_auth() -> str:
    if not reviewer.check_gh_installed():
        raise RuntimeError("GitHub CLI `gh` is not installed. Install it, then run `gh auth login`.")

    is_authed, info = reviewer.check_gh_auth()
    if not is_authed:
        raise RuntimeError(f"GitHub CLI is not authenticated. Run `gh auth login`. Details: {info}")

    return reviewer.get_gh_username() or info


def _run_gh(args: list[str], repo: str | None = None, timeout: int = 120) -> str:
    cmd = ["gh", *args]
    if repo:
        cmd.extend(["-R", repo])

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout,
        )
        return result.stdout.strip()
    except FileNotFoundError as exc:
        raise RuntimeError("GitHub CLI `gh` is not installed. Install it, then run `gh auth login`.") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.strip() if exc.stderr else "No stderr returned."
        raise RuntimeError(f"`{' '.join(cmd)}` failed with exit {exc.returncode}: {stderr}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"`{' '.join(cmd)}` timed out after {timeout} seconds.") from exc


def _parse_provider(provider: str) -> reviewer.Provider:
    try:
        return reviewer.Provider(provider)
    except ValueError as exc:
        valid = ", ".join(sorted(VALID_PROVIDERS))
        raise ValueError(f"Unknown provider `{provider}`. Expected one of: {valid}.") from exc


def _json_from_gh(args: list[str], repo: str | None = None) -> Any:
    output = _run_gh(args, repo=repo)
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"`gh {' '.join(args)}` returned invalid JSON.") from exc


def _review_diff(diff_text: str, provider: str) -> str:
    try:
        return reviewer.analyze_diff(diff_text, _parse_provider(provider))
    except typer.Exit as exc:
        raise RuntimeError(f"Review generation failed with exit code {exc.exit_code}.") from exc


def create_server():
    FastMCP = _load_fastmcp()
    server = FastMCP("gh-pr-reviewer")

    @server.tool()
    def github_auth_status() -> dict[str, Any]:
        """Return whether the GitHub CLI is installed and authenticated."""
        if not reviewer.check_gh_installed():
            return {
                "installed": False,
                "authenticated": False,
                "username": None,
                "message": "GitHub CLI `gh` is not installed.",
            }

        is_authed, info = reviewer.check_gh_auth()
        return {
            "installed": True,
            "authenticated": is_authed,
            "username": reviewer.get_gh_username() if is_authed else None,
            "message": info,
        }

    @server.tool()
    def list_available_providers() -> list[str]:
        """List local AI providers that gh-pr-reviewer can invoke."""
        return get_available_providers()

    @server.tool()
    def list_open_prs(repo: str, limit: int = 20) -> list[dict[str, Any]]:
        """List open pull requests for a repository such as `owner/repo`."""
        _require_auth()
        return _json_from_gh(
            [
                "pr",
                "list",
                "--state",
                "open",
                "--json",
                "number,title,author,headRefName,baseRefName,updatedAt,url",
                "--limit",
                str(limit),
            ],
            repo=repo,
        )

    @server.tool()
    def fetch_pr_metadata(repo: str, pr_number: int) -> dict[str, Any]:
        """Fetch structured pull request metadata for `repo` and `pr_number`."""
        _require_auth()
        return _json_from_gh(
            [
                "pr",
                "view",
                str(pr_number),
                "--json",
                "title,author,headRefName,baseRefName,state,additions,deletions,changedFiles,url",
            ],
            repo=repo,
        )

    @server.tool()
    def fetch_pr_diff(repo: str, pr_number: int) -> str:
        """Fetch the unified diff for a pull request."""
        _require_auth()
        return _run_gh(["pr", "diff", str(pr_number)], repo=repo)

    @server.tool()
    def generate_pr_review(repo: str, pr_number: int, provider: str = "claude") -> dict[str, Any]:
        """Generate a Markdown review for a pull request without posting it."""
        _require_auth()
        diff_text = _run_gh(["pr", "diff", str(pr_number)], repo=repo)
        review = _review_diff(diff_text, provider)
        return {
            "repo": repo,
            "pr_number": pr_number,
            "provider": provider,
            "review": review,
            "posted": False,
        }

    @server.tool()
    def post_pr_review(repo: str, pr_number: int, body: str) -> dict[str, Any]:
        """Post an existing review body as a GitHub PR review comment."""
        _require_auth()
        _run_gh(["pr", "review", str(pr_number), "--comment", "--body", body], repo=repo)
        return {
            "repo": repo,
            "pr_number": pr_number,
            "posted": True,
        }

    @server.tool()
    def review_pr(repo: str, pr_number: int, provider: str = "claude", post: bool = False) -> dict[str, Any]:
        """Fetch metadata and diff, generate a Markdown review, and optionally post it."""
        _require_auth()
        metadata = fetch_pr_metadata(repo, pr_number)
        diff_text = fetch_pr_diff(repo, pr_number)
        review = _review_diff(diff_text, provider)

        posted = False
        if post:
            post_pr_review(repo, pr_number, review)
            posted = True

        return {
            "repo": repo,
            "pr_number": pr_number,
            "provider": provider,
            "metadata": metadata,
            "review": review,
            "posted": posted,
        }

    @server.tool()
    def open_in_desktop_gui(repo: str, pr_number: int) -> dict[str, Any]:
        """Launch the desktop GUI app and load the specific repository and PR on startup."""
        import sys
        import os

        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        app_bundle = os.path.join(project_dir, "dist", "PRReviewer.app")

        if os.path.exists(app_bundle) and sys.platform == "darwin":
            cmd = ["open", app_bundle, "--args", "--repo", repo, "--pr", str(pr_number)]
        else:
            python_exe = sys.executable or os.path.join(project_dir, ".venv", "bin", "python")
            gui_script = os.path.join(project_dir, "gh_pr_reviewer", "gui.py")
            cmd = [python_exe, gui_script, "--repo", repo, "--pr", str(pr_number)]

        try:
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {
                "success": True,
                "message": f"Successfully launched GUI for {repo} PR #{pr_number} using command: {' '.join(cmd)}"
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Failed to launch GUI: {str(e)}"
            }

    return server


def get_available_providers() -> list[str]:
    return reviewer.get_available_providers()


def run() -> None:
    create_server().run()


if __name__ == "__main__":
    run()
