"""
Legacy pywebview desktop window.

The Electron app in `desktop/` is the maintained desktop surface. This module
is kept so the existing `pr-reviewer-gui` entry point, the PyInstaller spec,
and `packaging/build-dmg.sh` keep working. All review logic now lives in
`gh_pr_reviewer.service`, which both surfaces share.
"""

import os
import sys

import webview

from gh_pr_reviewer.service import (  # noqa: F401 — re-exported for compatibility
    COMMON_CLI_DIRS,
    COUNCIL_PROMPT,
    REVIEW_PROMPT,
    SUPPORTED_PROVIDERS,
    call_ai_cli,
    check_gh_auth,
    check_mcp_config,
    extract_review_markdown,
    fetch_open_prs,
    fetch_pr_details,
    fetch_pr_metadata,
    fetch_user_repos,
    format_skipped_providers,
    generate_review,
    get_available_providers,
    get_provider_options,
    inject_common_paths,
    looks_like_raw_diff,
    post_review,
    resolve_executable,
    run_gh,
    run_gh_login,
    search_repos,
    setup_mcp_config,
    summarize_provider_error,
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
        return fetch_pr_details(repo, pr_num)

    def generate_review(self, diff_text, provider):
        return generate_review(diff_text, provider)

    def post_review(self, repo, pr_num, review_text):
        return post_review(repo, pr_num, review_text)

    def check_mcp_config(self):
        return check_mcp_config()

    def setup_mcp_config(self):
        return setup_mcp_config()


# ─── Asset Loader helper ────────────────────────────────────────────────────

def get_asset_path(filename):
    """Get absolute path to resource, works for dev and for PyInstaller"""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, filename)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)


# ─── GUI Entrypoint ──────────────────────────────────────────────────────────

def _set_dock_icon():
    """Show the custom app icon in the macOS Dock when running from source.

    The packaged .app gets its icon from the bundle's Info.plist (via the
    PyInstaller --icon flag in build-dmg.sh). When launched from the venv
    script the process is plain Python, so the Dock falls back to the generic
    Python rocket. Point NSApplication at AppIcon.icns to restore the logo.
    """
    if sys.platform != "darwin":
        return
    try:
        from AppKit import NSApplication, NSImage
    except Exception:
        return
    icon_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "packaging", "assets", "AppIcon.icns",
    )
    if not os.path.exists(icon_path):
        return
    image = NSImage.alloc().initByReferencingFile_(icon_path)
    if image is not None:
        NSApplication.sharedApplication().setApplicationIconImage_(image)


def run_gui():
    import argparse
    parser = argparse.ArgumentParser(description="PR Reviewer GUI")
    parser.add_argument("--repo", help="Initial repository (owner/repo)")
    parser.add_argument("--pr", help="Initial PR number")
    args, _ = parser.parse_known_args()

    html_path = get_asset_path("index.html")
    api = API(repo=args.repo, pr=args.pr)

    webview.create_window(
        title="Agentic PR Reviewer",
        url=html_path,
        js_api=api,
        width=1200,
        height=800,
        min_size=(1000, 700)
    )
    _set_dock_icon()
    webview.start()


if __name__ == "__main__":
    run_gui()
