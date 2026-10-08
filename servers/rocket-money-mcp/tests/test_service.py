import json
import uuid

import pytest
from puddles_browser_auth.state import atomic_json, read_private

from rocket_money_mcp.errors import GatewayError
from rocket_money_mcp.service import IDENTITY, RocketMoney


class FakeAuth:
    def __init__(self):
        self.current = {"date": "2026-09-03", "categoryId": "old"}
        self.calls = []
        self.fail = None
        self.viewer = "owner"
        self.state = "ready"
        self.renewals = 0
        self.closed = 0

    def status(self):
        return {"status": "ok", "authentication": self.state}

    def mark(self, value):
        self.state = value

    def open_login(self):
        self.renewals += 1

    def close(self):
        self.closed += 1

    def post(self, body):
        self.calls.append(body)
        if body == IDENTITY:
            if self.fail == "auth":
                raise GatewayError("NEEDS_USER_LOGIN")
            return {"data": {"viewer": {"id": self.viewer}}}
        if body.get("operationName") == "TransactionState":
            return {
                "data": {
                    "node": {
                        "id": body["variables"]["id"],
                        "date": self.current["date"],
                        "category": {"id": self.current["categoryId"]},
                    }
                }
            }
        if body["query"].startswith("mutation"):
            inp = body["variables"]["input"]
            if "date" in inp:
                self.current["date"] = inp["date"]
            else:
                assert inp["categorizeAllRelatedTransactions"] is False
                self.current["categoryId"] = inp["transactionCategoryNodeId"]
            if self.fail == "timeout":
                raise TimeoutError("secret-provider-diagnostic")
            return {"data": {"ok": True}}
        return {
            "data": {"viewer": {"id": self.viewer, "password": "canary-secret"}},
            "extensions": {"token": "canary-secret"},
        }


@pytest.fixture
def setup(tmp_path):
    auth = FakeAuth()
    service = RocketMoney(tmp_path, auth)
    atomic_json(service.identity_file, {"viewerId": "owner"})
    return service, auth


def params():
    return {
        "requestId": str(uuid.uuid4()),
        "transactionId": "tx1",
        "expectedCategoryId": "old",
        "categoryId": "new",
    }


def mutations(auth):
    return [r for r in auth.calls if r["query"].startswith("mutation")]


def test_verified_write_and_persistent_duplicate(setup):
    service, auth = setup
    p = params()
    out = service.call("rocket_money_set_category", p)
    assert out["status"] == "verified"
    assert out["observed"] == "new"
    reopened = RocketMoney(service.directory, auth)
    assert reopened.call("rocket_money_set_category", p) == out
    assert len(mutations(auth)) == 1
    assert (
        reopened.call("rocket_money_set_category", {**p, "categoryId": "other"})["error"]["code"]
        == "REQUEST_ID_REUSED"
    )


def test_lost_response_reconciles_without_replay(setup):
    service, auth = setup
    auth.fail = "timeout"
    p = params()
    out = service.call("rocket_money_set_category", p)
    assert out["status"] == "unknown"
    assert "secret-provider" not in json.dumps(out)
    assert service.call("rocket_money_set_category", p)["status"] == "unknown"
    out = service.call("rocket_money_operation_status", {"requestId": p["requestId"]})
    assert out["status"] == "verified"
    assert len(mutations(auth)) == 1


def test_unknown_different_current_value_stays_unknown(setup):
    service, auth = setup
    auth.fail = "timeout"
    p = params()
    service.call("rocket_money_set_category", p)
    auth.current["categoryId"] = "third-party-change"
    assert service.call("rocket_money_operation_status", {"requestId": p["requestId"]})["status"] == "unknown"
    assert len(mutations(auth)) == 1


def test_preflight_conflict_precedes_already_satisfied(setup):
    service, auth = setup
    p = params()
    auth.current["categoryId"] = p["categoryId"]
    assert service.call("rocket_money_set_category", p)["status"] == "conflict"
    assert not mutations(auth)


def test_noop_never_dispatches(setup):
    service, auth = setup
    p = {**params(), "categoryId": "old"}
    assert service.call("rocket_money_set_category", p)["status"] == "unchanged"
    assert not mutations(auth)


def test_login_failure_is_blocked_before_mutation(setup):
    service, auth = setup
    auth.fail = "auth"
    assert service.call("rocket_money_set_category", params())["status"] == "blocked"
    assert auth.renewals == 1
    assert auth.closed == 1
    assert not mutations(auth)


def test_initial_binding_requires_operator_login(setup):
    service, auth = setup
    service.identity_file.unlink()
    assert service.call("rocket_money_read", {"query": "{viewer{id}}"})["error"]["code"] == "NEEDS_USER_LOGIN"
    assert not auth.calls
    assert not service.identity_file.exists()


def test_wrong_account_cannot_read_or_write(setup):
    service, auth = setup
    auth.viewer = "wrong-owner"
    assert service.call("rocket_money_set_category", params())["status"] == "blocked"
    assert auth.closed == 1
    assert auth.state == "needs_user_login"
    assert not mutations(auth)


@pytest.mark.parametrize(
    "extra",
    [{"url": "https://evil.invalid"}, {"account": "other"}, {"headers": {"Cookie": "x"}}, {"mode": "login"}],
)
def test_unknown_arguments_never_reach_auth(setup, extra):
    service, auth = setup
    assert (
        service.call("rocket_money_read", {"query": "{viewer{id}}", **extra})["error"]["code"]
        == "INVALID_INPUT"
    )
    assert not auth.calls


def test_read_projects_only_requested_data(setup):
    service, _auth = setup
    out = service.call("rocket_money_read", {"query": "{viewer{id}}"})
    assert out == {"status": "ok", "result": {"data": {"viewer": {"id": "owner"}}}}
    assert "canary-secret" not in json.dumps(out)


def test_date_write_contract(setup):
    service, auth = setup
    p = {
        "requestId": str(uuid.uuid4()),
        "transactionId": "tx1",
        "expectedDate": "2026-09-03",
        "date": "2026-09-01",
    }
    assert service.call("rocket_money_set_date", p)["status"] == "verified"
    assert auth.current["date"] == "2026-09-01"
    assert (
        service.call("rocket_money_set_date", {**p, "date": "2026-02-30"})["error"]["code"] == "INVALID_INPUT"
    )


def test_status_does_not_start_browser(setup):
    service, auth = setup
    assert service.call("rocket_money_status", {})["status"] == "ok"
    assert not auth.calls


def test_crash_record_reconciles_only_by_read(setup):
    service, auth = setup
    p = params()
    service.call("rocket_money_set_category", p)
    path = service.record_path(p["requestId"])
    record = read_private(path)
    record["result"]["status"] = "in_progress"
    atomic_json(path, record)
    assert service.call("rocket_money_set_category", p)["status"] == "unknown"
    assert (
        service.call("rocket_money_operation_status", {"requestId": p["requestId"]})["status"] == "verified"
    )
    assert len(mutations(auth)) == 1
