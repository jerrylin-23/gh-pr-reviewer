"""
Local HTTP API for the Electron desktop app.

Design rules:

* Binds to 127.0.0.1 only. Port 0 by default, so the OS picks a free port.
* Requires a per-launch bearer token supplied through the
  ``PR_REVIEWER_API_TOKEN`` environment variable. The server refuses to start
  without it, and it never writes the token to stdout, stderr, or a log.
* Exposes only typed product operations. There is no generic command endpoint.
* Every response uses the envelope ``{"success", "data", "error"}``.
* Errors carry a stable ``code`` and a short message. Stack traces, secrets,
  and environment values never reach the client.

Startup contract: once the socket is listening, the process writes one JSON
line to stdout::

    {"event": "ready", "port": 51234, "host": "127.0.0.1"}

Electron reads that line to learn the port. All other diagnostics go to stderr.
"""

from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import sys
from typing import Any, Awaitable, Callable

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from gh_pr_reviewer import service

# ─── Limits and validation ──────────────────────────────────────────────────

TOKEN_HEADER = "x-pr-reviewer-token"
MAX_DIFF_BYTES = 4 * 1024 * 1024
MAX_BODY_BYTES = 512 * 1024
MAX_QUERY_LEN = 200
MAX_PR_NUMBER = 10_000_000

REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}$")


class ApiError(Exception):
    """An error that maps to a stable client-facing code."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def ok(data: Any) -> JSONResponse:
    return JSONResponse({"success": True, "data": data, "error": None})


def err(code: str, message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(
        {"success": False, "data": None, "error": {"code": code, "message": message}},
        status_code=status,
    )


def validate_repo(value: Any) -> str:
    if not isinstance(value, str) or not REPO_RE.match(value.strip()):
        raise ApiError(
            "INVALID_REPO",
            "Repository must look like owner/repo and use letters, digits, dot, dash, or underscore.",
        )
    return value.strip()


def validate_pr_number(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ApiError("INVALID_PR_NUMBER", "Pull Request number must be a positive integer.")
    try:
        number = int(str(value).strip().lstrip("#"))
    except ValueError:
        raise ApiError("INVALID_PR_NUMBER", "Pull Request number must be a positive integer.") from None
    if number < 1 or number > MAX_PR_NUMBER:
        raise ApiError("INVALID_PR_NUMBER", "Pull Request number is out of range.")
    return number


def validate_provider(value: Any) -> str:
    if not isinstance(value, str) or value not in service.VALID_PROVIDER_VALUES:
        valid = ", ".join(sorted(service.VALID_PROVIDER_VALUES))
        raise ApiError("INVALID_PROVIDER", f"Provider must be one of: {valid}.")
    return value


def validate_diff(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError("INVALID_DIFF", "The diff is empty. Load a Pull Request first.")
    if len(value.encode("utf-8")) > MAX_DIFF_BYTES:
        raise ApiError("DIFF_TOO_LARGE", "The diff is larger than 4 MB. Review a smaller Pull Request.")
    return value


def validate_body(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError("INVALID_REVIEW_BODY", "The review body is empty.")
    if len(value.encode("utf-8")) > MAX_BODY_BYTES:
        raise ApiError("REVIEW_BODY_TOO_LARGE", "The review body is larger than 512 KB.")
    return value


def validate_query(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiError("INVALID_QUERY", "The search query must be text.")
    query = value.strip()
    if len(query) > MAX_QUERY_LEN:
        raise ApiError("INVALID_QUERY", "The search query is too long.")
    return query


async def read_json(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        raise ApiError("INVALID_JSON", "The request body is not valid JSON.") from None
    if not isinstance(payload, dict):
        raise ApiError("INVALID_JSON", "The request body must be a JSON object.")
    return payload


# ─── Auth middleware ────────────────────────────────────────────────────────


def _guard(token: str, handler: Callable[[Request], Awaitable[JSONResponse]]):
    """Wrap a handler with token checking and stable error mapping."""

    async def endpoint(request: Request) -> JSONResponse:
        supplied = request.headers.get(TOKEN_HEADER, "")
        if not supplied:
            return err("TOKEN_MISSING", "The local API token is missing.", 401)
        if not hmac.compare_digest(supplied, token):
            return err("TOKEN_INVALID", "The local API token is not valid.", 403)
        try:
            return await handler(request)
        except ApiError as exc:
            return err(exc.code, exc.message, exc.status)
        except Exception:
            # Never leak the traceback to the renderer.
            print("backend: unhandled error in handler", file=sys.stderr, flush=True)
            return err("INTERNAL_ERROR", "The local backend hit an unexpected error.", 500)

    return endpoint


# ─── Handlers ───────────────────────────────────────────────────────────────


async def health(request: Request) -> JSONResponse:
    return ok({"status": "ok", "service": "gh-pr-reviewer", "pid": os.getpid()})


async def system_health(request: Request) -> JSONResponse:
    executables = {
        name: bool(service.resolve_executable(name))
        for name in ("gh", "claude", "agy", "codex")
    }
    is_authed, info = await run_in_threadpool(service.check_gh_auth)
    return ok(
        {
            "status": "ok",
            "pid": os.getpid(),
            "executables": executables,
            "githubAuthenticated": is_authed,
            "providers": await run_in_threadpool(service.get_available_providers),
            "detail": info if not is_authed else None,
        }
    )


async def auth_status(request: Request) -> JSONResponse:
    is_authed, info = await run_in_threadpool(service.check_gh_auth)
    return ok(
        {
            "authenticated": is_authed,
            "username": info if is_authed else None,
            "detail": None if is_authed else info,
            "ghInstalled": bool(service.resolve_executable("gh")),
        }
    )


async def auth_login(request: Request) -> JSONResponse:
    is_authed, info = await run_in_threadpool(service.run_gh_login)
    return ok({"authenticated": is_authed, "message": info})


async def repos_list(request: Request) -> JSONResponse:
    repos = await run_in_threadpool(service.fetch_user_repos)
    return ok({"repos": repos})


async def repos_search(request: Request) -> JSONResponse:
    payload = await read_json(request)
    query = validate_query(payload.get("query", ""))
    if len(query) < 2:
        return ok({"repos": []})
    repos = await run_in_threadpool(service.search_repos, query)
    return ok({"repos": repos})


async def pulls_list(request: Request) -> JSONResponse:
    payload = await read_json(request)
    repo = validate_repo(payload.get("repo"))
    prs = await run_in_threadpool(service.fetch_open_prs, repo)
    return ok({"repo": repo, "pullRequests": prs})


async def pulls_load(request: Request) -> JSONResponse:
    payload = await read_json(request)
    repo = validate_repo(payload.get("repo"))
    number = validate_pr_number(payload.get("number"))
    result = await run_in_threadpool(service.fetch_pr_details, repo, number)
    if not result.get("success"):
        message = result.get("error", "Could not load the Pull Request.")
        code = "AUTH_REQUIRED" if "auth login" in message else "PR_LOAD_FAILED"
        raise ApiError(code, message, 502 if code == "PR_LOAD_FAILED" else 401)
    metadata = result["metadata"]
    diff = metadata.pop("diff", "")
    return ok({"repo": repo, "number": number, "metadata": metadata, "diff": diff})


async def providers_list(request: Request) -> JSONResponse:
    options = await run_in_threadpool(service.get_provider_options)
    return ok({"providers": options})


async def review_generate(request: Request) -> JSONResponse:
    payload = await read_json(request)
    provider = validate_provider(payload.get("provider"))
    diff = validate_diff(payload.get("diff"))
    result = await run_in_threadpool(service.generate_review, diff, provider)
    if not result.get("success"):
        message = result.get("error", "Review generation failed.")
        raise ApiError(_review_error_code(message), message, 502)
    markdown = result["review"]
    return ok(
        {
            "markdown": markdown,
            "structured": service.parse_review_markdown(markdown),
            "provider": result.get("provider", provider),
            "participants": result.get("participants", []),
            "moderator": result.get("moderator"),
            "skipped": result.get("skipped", []),
        }
    )


def _review_error_code(message: str) -> str:
    lowered = message.lower()
    if "timed out" in lowered or "timeout" in lowered:
        return "PROVIDER_TIMEOUT"
    if "empty response" in lowered:
        return "PROVIDER_EMPTY_RESPONSE"
    if "not found" in lowered:
        return "PROVIDER_NOT_FOUND"
    if "council" in lowered:
        return "COUNCIL_FAILED"
    return "REVIEW_FAILED"


async def review_post(request: Request) -> JSONResponse:
    payload = await read_json(request)
    repo = validate_repo(payload.get("repo"))
    number = validate_pr_number(payload.get("number"))
    body = validate_body(payload.get("body"))
    if payload.get("confirm") is not True:
        raise ApiError(
            "CONFIRMATION_REQUIRED",
            "Posting a review needs an explicit confirmation flag.",
        )
    result = await run_in_threadpool(service.post_review, repo, number, body)
    if not result.get("success"):
        message = result.get("error", "Posting the review failed.")
        raise ApiError("POST_FAILED", message, 502)
    return ok({"repo": repo, "number": number, "posted": True})


async def mcp_status(request: Request) -> JSONResponse:
    return ok(await run_in_threadpool(service.check_mcp_config))


async def mcp_setup(request: Request) -> JSONResponse:
    payload = await read_json(request)
    if payload.get("confirm") is not True:
        raise ApiError(
            "CONFIRMATION_REQUIRED",
            "Writing the MCP configuration needs an explicit confirmation flag.",
        )
    result = await run_in_threadpool(service.setup_mcp_config)
    if not result.get("success"):
        raise ApiError("MCP_SETUP_FAILED", result.get("error", "MCP setup failed."), 500)
    return ok(result)


# ─── App factory ────────────────────────────────────────────────────────────

_ROUTES: list[tuple[str, list[str], Callable]] = [
    ("/health", ["GET"], health),
    ("/api/system/health", ["GET"], system_health),
    ("/api/auth/status", ["GET"], auth_status),
    ("/api/auth/login", ["POST"], auth_login),
    ("/api/repos", ["GET"], repos_list),
    ("/api/repos/search", ["POST"], repos_search),
    ("/api/pulls", ["POST"], pulls_list),
    ("/api/pulls/load", ["POST"], pulls_load),
    ("/api/providers", ["GET"], providers_list),
    ("/api/review/generate", ["POST"], review_generate),
    ("/api/review/post", ["POST"], review_post),
    ("/api/mcp/status", ["GET"], mcp_status),
    ("/api/mcp/setup", ["POST"], mcp_setup),
]


async def _not_found(request: Request, exc: Exception) -> JSONResponse:
    return err("NOT_FOUND", "Unknown endpoint.", 404)


async def _server_error(request: Request, exc: Exception) -> JSONResponse:
    return err("INTERNAL_ERROR", "The local backend hit an unexpected error.", 500)


def create_app(token: str) -> Starlette:
    """Build the Starlette app. ``token`` guards every route."""
    if not token:
        raise ValueError("A non-empty API token is required.")
    routes = [
        Route(path, _guard(token, handler), methods=methods)
        for path, methods, handler in _ROUTES
    ]
    return Starlette(
        routes=routes,
        exception_handlers={404: _not_found, 500: _server_error},
    )


def read_token_from_env(env: dict | None = None) -> str:
    env = os.environ if env is None else env
    token = env.get("PR_REVIEWER_API_TOKEN", "")
    if len(token) < 32:
        raise SystemExit(
            "PR_REVIEWER_API_TOKEN must be set to a random value of at least 32 characters. "
            "The Electron main process generates it per launch."
        )
    return token


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="gh-pr-reviewer local desktop API")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (127.0.0.1 only).")
    parser.add_argument("--port", type=int, default=0, help="Bind port. 0 picks a free port.")
    args = parser.parse_args(argv)

    if args.host != "127.0.0.1":
        raise SystemExit("The local API binds to 127.0.0.1 only.")

    token = read_token_from_env()
    app = create_app(token)

    import uvicorn

    class _ReadyServer(uvicorn.Server):
        def startup_ready(self) -> None:
            port = self.servers[0].sockets[0].getsockname()[1]
            sys.stdout.write(
                json.dumps({"event": "ready", "host": args.host, "port": port}) + "\n"
            )
            sys.stdout.flush()

        async def startup(self, sockets=None):  # type: ignore[override]
            await super().startup(sockets=sockets)
            self.startup_ready()

    config = uvicorn.Config(
        app,
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )
    _ReadyServer(config).run()


if __name__ == "__main__":
    main()
