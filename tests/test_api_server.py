"""Tests for the local desktop API.

All GitHub and AI CLI calls are stubbed. Nothing here reaches the network.
"""

from __future__ import annotations

import pytest

from gh_pr_reviewer import api_server, service
from tests.conftest import TEST_TOKEN


# ─── Envelope shape ─────────────────────────────────────────────────────────


def assert_success_envelope(payload):
    assert set(payload) == {"success", "data", "error"}
    assert payload["success"] is True
    assert payload["error"] is None
    assert payload["data"] is not None


def assert_error_envelope(payload, code):
    assert set(payload) == {"success", "data", "error"}
    assert payload["success"] is False
    assert payload["data"] is None
    assert set(payload["error"]) == {"code", "message"}
    assert payload["error"]["code"] == code
    assert payload["error"]["message"]


# ─── Token handling ─────────────────────────────────────────────────────────


def test_health_with_valid_token(client, auth_headers):
    response = client.get("/health", headers=auth_headers)
    assert response.status_code == 200
    assert_success_envelope(response.json())
    assert response.json()["data"]["status"] == "ok"


def test_missing_token_is_rejected(client):
    response = client.get("/health")
    assert response.status_code == 401
    assert_error_envelope(response.json(), "TOKEN_MISSING")


def test_invalid_token_is_rejected(client):
    response = client.get("/health", headers={api_server.TOKEN_HEADER: "wrong-token-value"})
    assert response.status_code == 403
    assert_error_envelope(response.json(), "TOKEN_INVALID")


def test_every_route_requires_a_token(client):
    for path, methods, _ in api_server._ROUTES:
        method = methods[0]
        response = client.request(method, path, json={})
        assert response.status_code == 401, f"{method} {path} did not require a token"


def test_unknown_endpoint_returns_stable_error(client, auth_headers):
    response = client.get("/api/does-not-exist", headers=auth_headers)
    assert response.status_code == 404
    assert_error_envelope(response.json(), "NOT_FOUND")


def test_no_generic_command_endpoint_exists():
    paths = {path for path, _, _ in api_server._ROUTES}
    for forbidden in ("/api/run", "/api/exec", "/api/command", "/api/shell"):
        assert forbidden not in paths


def test_create_app_rejects_empty_token():
    with pytest.raises(ValueError):
        api_server.create_app("")


def test_read_token_from_env_requires_a_long_token():
    with pytest.raises(SystemExit):
        api_server.read_token_from_env({})
    with pytest.raises(SystemExit):
        api_server.read_token_from_env({"PR_REVIEWER_API_TOKEN": "short"})
    assert api_server.read_token_from_env({"PR_REVIEWER_API_TOKEN": TEST_TOKEN}) == TEST_TOKEN


# ─── Input validation ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "repo",
    ["", "no-slash", "owner/repo/extra", "owner/../etc", "own er/repo", "owner/repo;rm -rf /", None, 7],
)
def test_repository_input_validation(client, auth_headers, repo):
    response = client.post("/api/pulls", headers=auth_headers, json={"repo": repo})
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_REPO")


@pytest.mark.parametrize("number", [0, -3, "abc", "", None, 10_000_001, True])
def test_pull_request_number_validation(client, auth_headers, monkeypatch, number):
    monkeypatch.setattr(service, "fetch_pr_details", lambda repo, num: {"success": True, "metadata": {}})
    response = client.post(
        "/api/pulls/load", headers=auth_headers, json={"repo": "owner/repo", "number": number}
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_PR_NUMBER")


def test_provider_validation(client, auth_headers):
    response = client.post(
        "/api/review/generate",
        headers=auth_headers,
        json={"provider": "gpt-fake", "diff": "diff --git a b"},
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_PROVIDER")


def test_empty_diff_is_rejected(client, auth_headers):
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "claude", "diff": "  "}
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_DIFF")


def test_oversized_diff_is_rejected(client, auth_headers):
    big = "x" * (api_server.MAX_DIFF_BYTES + 1)
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "claude", "diff": big}
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "DIFF_TOO_LARGE")


def test_malformed_json_is_rejected(client, auth_headers):
    response = client.post(
        "/api/pulls",
        headers={**auth_headers, "content-type": "application/json"},
        content=b"{not json",
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_JSON")


# ─── Auth endpoints ─────────────────────────────────────────────────────────


def test_auth_status_when_authenticated(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "check_gh_auth", lambda: (True, "octocat"))
    monkeypatch.setattr(service, "resolve_executable", lambda name: "/usr/bin/" + name)
    response = client.get("/api/auth/status", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["authenticated"] is True
    assert data["username"] == "octocat"


def test_github_authentication_failure(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "check_gh_auth", lambda: (False, "You are not logged into any GitHub hosts."))
    monkeypatch.setattr(service, "resolve_executable", lambda name: None)
    response = client.get("/api/auth/status", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["authenticated"] is False
    assert data["username"] is None
    assert "not logged into" in data["detail"]


def test_pr_load_auth_failure_maps_to_auth_required(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "fetch_pr_details",
        lambda repo, num: {"success": False, "error": "gh failed: run gh auth login first"},
    )
    response = client.post(
        "/api/pulls/load", headers=auth_headers, json={"repo": "owner/repo", "number": 5}
    )
    assert response.status_code == 401
    assert_error_envelope(response.json(), "AUTH_REQUIRED")


# ─── Repository and Pull Request data ───────────────────────────────────────


def test_repos_list(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "fetch_user_repos", lambda: ["octocat/hello", "octocat/world"])
    response = client.get("/api/repos", headers=auth_headers)
    assert_success_envelope(response.json())
    assert response.json()["data"]["repos"] == ["octocat/hello", "octocat/world"]


def test_repo_search_short_query_returns_empty(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "search_repos", lambda q: ["should/not-be-called"])
    response = client.post("/api/repos/search", headers=auth_headers, json={"query": "a"})
    assert response.json()["data"]["repos"] == []


def test_repo_search(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "search_repos", lambda q: ["astral-sh/ruff"])
    response = client.post("/api/repos/search", headers=auth_headers, json={"query": "ruff"})
    assert response.json()["data"]["repos"] == ["astral-sh/ruff"]


def test_pulls_list_empty(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "fetch_open_prs", lambda repo: [])
    response = client.post("/api/pulls", headers=auth_headers, json={"repo": "owner/repo"})
    assert_success_envelope(response.json())
    assert response.json()["data"]["pullRequests"] == []


def test_pulls_load_returns_metadata_and_diff(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "fetch_pr_details",
        lambda repo, num: {
            "success": True,
            "metadata": {
                "title": "Fix the parser",
                "author": "octocat",
                "additions": 12,
                "deletions": 3,
                "changedFiles": 2,
                "url": "https://github.com/owner/repo/pull/5",
                "state": "OPEN",
                "headRefName": "fix",
                "baseRefName": "main",
                "diff": "diff --git a/a.py b/a.py",
            },
        },
    )
    response = client.post(
        "/api/pulls/load", headers=auth_headers, json={"repo": "owner/repo", "number": "#5"}
    )
    data = response.json()["data"]
    assert data["number"] == 5
    assert data["metadata"]["title"] == "Fix the parser"
    assert "diff" not in data["metadata"]
    assert data["diff"].startswith("diff --git")


def test_providers_list(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "get_provider_options",
        lambda: [{"value": "council", "label": "Council Mode"}, {"value": "claude", "label": "Claude CLI"}],
    )
    response = client.get("/api/providers", headers=auth_headers)
    assert response.json()["data"]["providers"][0]["value"] == "council"


# ─── Review generation ──────────────────────────────────────────────────────

SAMPLE_REVIEW = """## Decision
- Status: `Needs changes`
- Risk: `Medium`
- Main reason: The retry loop can spin forever.

## Findings

### [P1] Unbounded retry loop
- File: `app/worker.py:42`
- Evidence: The new `while True` block has no attempt counter.
- Impact: A failing job pins one CPU core.
- Fix: Add a maximum attempt count and back off.

## Summary
The change adds retries but no ceiling.
"""


def test_review_generation_success(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {
            "success": True,
            "review": SAMPLE_REVIEW,
            "provider": provider,
            "participants": ["claude"],
            "moderator": None,
            "skipped": [],
        },
    )
    response = client.post(
        "/api/review/generate",
        headers=auth_headers,
        json={"provider": "claude", "diff": "diff --git a/a.py b/a.py"},
    )
    assert_success_envelope(response.json())
    data = response.json()["data"]
    assert data["markdown"] == SAMPLE_REVIEW
    assert data["structured"]["decision"]["status"] == "Needs changes"
    assert data["structured"]["findings"][0]["priority"] == "P1"
    assert data["structured"]["findings"][0]["file"] == "app/worker.py"
    assert data["structured"]["findings"][0]["line"] == 42


def test_ai_provider_timeout(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {
            "success": False,
            "error": "claude timed out (5 min). The diff may be too large.",
        },
    )
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "claude", "diff": "diff"}
    )
    assert response.status_code == 502
    assert_error_envelope(response.json(), "PROVIDER_TIMEOUT")


def test_empty_ai_response(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {"success": False, "error": "claude returned an empty response."},
    )
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "claude", "diff": "diff"}
    )
    assert response.status_code == 502
    assert_error_envelope(response.json(), "PROVIDER_EMPTY_RESPONSE")


def test_council_partial_failure_reports_skipped_providers(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {
            "success": True,
            "review": SAMPLE_REVIEW,
            "provider": "council",
            "participants": ["claude", "codex"],
            "moderator": "claude",
            "skipped": [{"provider": "antigravity", "reason": "quota or usage limit"}],
        },
    )
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "council", "diff": "diff"}
    )
    data = response.json()["data"]
    assert data["participants"] == ["claude", "codex"]
    assert data["moderator"] == "claude"
    assert data["skipped"] == [{"provider": "antigravity", "reason": "quota or usage limit"}]


def test_council_total_failure(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {
            "success": False,
            "error": "All council reviewers failed to generate reviews.",
        },
    )
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "council", "diff": "diff"}
    )
    assert response.status_code == 502
    assert_error_envelope(response.json(), "COUNCIL_FAILED")


def test_unparseable_review_still_returns_markdown(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service,
        "generate_review",
        lambda diff, provider: {
            "success": True,
            "review": "I could not review this diff.",
            "provider": provider,
            "participants": [provider],
            "moderator": None,
            "skipped": [],
        },
    )
    response = client.post(
        "/api/review/generate", headers=auth_headers, json={"provider": "claude", "diff": "diff"}
    )
    data = response.json()["data"]
    assert data["structured"] is None
    assert data["markdown"] == "I could not review this diff."


# ─── Review posting ─────────────────────────────────────────────────────────


def test_posting_without_confirmation_is_refused(client, auth_headers, monkeypatch):
    def _must_not_run(*args, **kwargs):
        raise AssertionError("post_review ran without confirmation")

    monkeypatch.setattr(service, "post_review", _must_not_run)
    response = client.post(
        "/api/review/post",
        headers=auth_headers,
        json={"repo": "owner/repo", "number": 5, "body": "looks good"},
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "CONFIRMATION_REQUIRED")


def test_posting_with_confirmation_succeeds(client, auth_headers, monkeypatch):
    calls = []

    def _post(repo, number, body):
        calls.append((repo, number, body))
        return {"success": True}

    monkeypatch.setattr(service, "post_review", _post)
    response = client.post(
        "/api/review/post",
        headers=auth_headers,
        json={"repo": "owner/repo", "number": 5, "body": "looks good", "confirm": True},
    )
    assert response.status_code == 200
    assert response.json()["data"]["posted"] is True
    assert calls == [("owner/repo", 5, "looks good")]


def test_posting_empty_body_is_rejected(client, auth_headers):
    response = client.post(
        "/api/review/post",
        headers=auth_headers,
        json={"repo": "owner/repo", "number": 5, "body": "", "confirm": True},
    )
    assert response.status_code == 400
    assert_error_envelope(response.json(), "INVALID_REVIEW_BODY")


def test_posting_failure_maps_to_post_failed(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service, "post_review", lambda repo, num, body: {"success": False, "error": "gh failed (exit 1)"}
    )
    response = client.post(
        "/api/review/post",
        headers=auth_headers,
        json={"repo": "owner/repo", "number": 5, "body": "hi", "confirm": True},
    )
    assert response.status_code == 502
    assert_error_envelope(response.json(), "POST_FAILED")


# ─── MCP and diagnostics ────────────────────────────────────────────────────


def test_mcp_status(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        service, "check_mcp_config", lambda: {"configured": True, "exists": True, "path": "/tmp/x.json"}
    )
    response = client.get("/api/mcp/status", headers=auth_headers)
    assert response.json()["data"]["configured"] is True


def test_mcp_setup_needs_confirmation(client, auth_headers, monkeypatch):
    def _must_not_run():
        raise AssertionError("setup_mcp_config ran without confirmation")

    monkeypatch.setattr(service, "setup_mcp_config", _must_not_run)
    response = client.post("/api/mcp/setup", headers=auth_headers, json={})
    assert response.status_code == 400
    assert_error_envelope(response.json(), "CONFIRMATION_REQUIRED")


def test_system_health_reports_diagnostics(client, auth_headers, monkeypatch):
    monkeypatch.setattr(service, "resolve_executable", lambda name: "/usr/bin/gh" if name == "gh" else None)
    monkeypatch.setattr(service, "check_gh_auth", lambda: (True, "octocat"))
    monkeypatch.setattr(service, "get_available_providers", lambda: ["claude"])
    response = client.get("/api/system/health", headers=auth_headers)
    data = response.json()["data"]
    assert data["executables"] == {"gh": True, "claude": False, "agy": False, "codex": False}
    assert data["githubAuthenticated"] is True
    assert data["providers"] == ["claude"]


def test_internal_error_is_not_leaked(client, auth_headers, monkeypatch):
    def _boom():
        raise RuntimeError("secret token abc123 in message")

    monkeypatch.setattr(service, "check_mcp_config", _boom)
    response = client.get("/api/mcp/status", headers=auth_headers)
    assert response.status_code == 500
    assert_error_envelope(response.json(), "INTERNAL_ERROR")
    assert "secret" not in response.text
