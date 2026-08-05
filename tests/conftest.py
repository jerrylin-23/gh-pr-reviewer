"""Shared fixtures. No test may touch real GitHub or a real AI CLI."""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from gh_pr_reviewer import api_server

TEST_TOKEN = "t" * 48


@pytest.fixture(autouse=True)
def block_subprocess(monkeypatch):
    """Fail loudly if a test reaches subprocess without stubbing it."""

    def _forbidden(*args, **kwargs):
        raise AssertionError("A test tried to run a real subprocess. Stub the service call.")

    monkeypatch.setattr("subprocess.run", _forbidden)
    monkeypatch.setattr("subprocess.Popen", _forbidden)


@pytest.fixture
def client() -> TestClient:
    return TestClient(api_server.create_app(TEST_TOKEN))


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {api_server.TOKEN_HEADER: TEST_TOKEN}
