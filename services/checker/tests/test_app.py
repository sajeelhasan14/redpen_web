from fastapi.testclient import TestClient

from checker.app import app
from tests.test_runner import REQ

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"ok": True}


def test_refuses_when_secret_is_not_configured(monkeypatch):
    monkeypatch.delenv("CHECKER_SECRET", raising=False)
    assert client.post("/check", json=REQ).status_code == 503


def test_refuses_wrong_secret(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    assert client.post("/check", json=REQ, headers={"x-checker-secret": "nope"}).status_code == 401
    assert client.post("/check", json=REQ).status_code == 401


def test_checks_with_secret(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    r = client.post("/check", json=REQ, headers={"x-checker-secret": "s3cret"})
    assert r.status_code == 200
    assert r.json()["final"] == "right"


def test_rejects_unknown_kinds(monkeypatch):
    monkeypatch.setenv("CHECKER_SECRET", "s3cret")
    bad = dict(REQ, transitions=[{"to": 1, "kind": "teleport", "substitution": None}])
    assert client.post("/check", json=bad, headers={"x-checker-secret": "s3cret"}).status_code == 422
