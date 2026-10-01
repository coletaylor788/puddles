import json
import uuid
import httpx
import pytest
from puddles_cli.auth import BrowserSession
from puddles_cli.errors import GatewayError
from puddles_cli.policy import validate
from puddles_cli.rocket_money import RocketMoney
from puddles_cli.state import atomic_json, private_directory, read_private
from test_policy import category, date_request


class Session:
    def __init__(self):
        self.saved = []
        self.renewals = 0

    def cookies(self):
        cookies = httpx.Cookies()
        cookies.set("session", "synthetic-canary", domain="client-api.rocketmoney.com", path="/")
        return cookies

    def save_cookies(self, cookies):
        self.saved.append([(c.name, c.value) for c in cookies.jar])

    def bind_identity(self, value):
        assert value == "user1"

    def renew(self):
        self.renewals += 1


class Provider:
    def __init__(self):
        self.category = "old"
        self.date = "2026-10-08"
        self.writes = 0
        self.fail = False

    def __call__(self, request):
        payload = json.loads(request.content)
        assert request.url.host == "client-api.rocketmoney.com"
        assert request.headers.get("cookie") == "session=synthetic-canary"
        if "PuddlesIdentity" in payload["query"]:
            data = {"viewer": {"id": "user1"}}
        elif "PuddlesTransaction" in payload["query"]:
            data = {
                "node": {
                    "id": "t1",
                    "date": self.date,
                    "category": {"id": self.category, "label": "Old"},
                }
            }
        elif payload["query"].startswith("mutation"):
            self.writes += 1
            change = payload["variables"]["input"]
            if "date" in change:
                self.date = change["date"]
            else:
                self.category = change["transactionCategoryNodeId"]
            if self.fail:
                raise httpx.ReadTimeout("synthetic-canary-secret")
            data = {"updated": True}
        else:
            data = {"viewer": {"id": "user1"}}
        return httpx.Response(
            200,
            json={"data": data},
            headers={"Set-Cookie": "session=rotated; Secure; HttpOnly", "X-Private": "secret"},
        )


def setup(tmp_path):
    private_directory(tmp_path)
    provider = Provider()
    session = Session()
    return RocketMoney(tmp_path, session, httpx.MockTransport(provider)), provider, session


def test_mutation_verification_replay_and_conflict(tmp_path):
    client, provider, session = setup(tmp_path)
    rid = str(uuid.uuid4())
    result = client.execute(
        validate(category(), "rocket_money_write"), "main", rid, {"transactionCategoryNodeId": "old"}
    )
    assert result == {"data": {"updated": True}}
    assert "secret" not in json.dumps(result)
    assert client.status(rid, "main")["outcome"] == "verified"
    with pytest.raises(GatewayError, match="REPLAY_RECORDED"):
        client.execute(
            validate(category(), "rocket_money_write"), "main", rid, {"transactionCategoryNodeId": "old"}
        )
    assert provider.writes == 1
    with pytest.raises(GatewayError, match="REQUEST_ID_CONFLICT"):
        client.execute(
            validate(category(), "rocket_money_write"),
            "main",
            rid,
            {"transactionCategoryNodeId": "different"},
        )
    with pytest.raises(GatewayError, match="NOT_FOUND"):
        client.status(rid, "household")


def test_unknown_write_is_not_replayed_after_restart(tmp_path):
    client, provider, session = setup(tmp_path)
    rid = str(uuid.uuid4())
    provider.fail = True
    with pytest.raises(GatewayError, match="OUTCOME_UNKNOWN"):
        client.execute(validate(date_request(), "rocket_money_write"), "main", rid, {"date": "2026-10-08"})
    assert provider.date == "2026-09-01"
    restarted = RocketMoney(tmp_path, session, httpx.MockTransport(provider))
    assert restarted.status(rid, "main")["outcome"] == "unknown"
    with pytest.raises(GatewayError, match="REPLAY_RECORDED"):
        restarted.execute(validate(date_request(), "rocket_money_write"), "main", rid, {"date": "2026-10-08"})
    assert provider.writes == 1


def test_stale_expected_state_never_writes(tmp_path):
    client, provider, _ = setup(tmp_path)
    with pytest.raises(GatewayError, match="STATE_CONFLICT"):
        client.execute(
            validate(category(), "rocket_money_write"),
            "main",
            str(uuid.uuid4()),
            {"transactionCategoryNodeId": "not-current"},
        )
    assert provider.writes == 0


def test_batch_validates_every_item_before_execution(tmp_path):
    client, provider, _ = setup(tmp_path)
    bad = category(True)
    with pytest.raises(GatewayError):
        client.batch([category(), bad], "rocket_money_write", "main", str(uuid.uuid4()), [{}, {}])
    assert provider.writes == 0


def test_cookie_rotation_preserves_identity_cookie_and_origins(tmp_path):
    session = BrowserSession(tmp_path)
    atomic_json(
        session.file,
        {
            "cookies": [
                {
                    "name": "api",
                    "value": "old",
                    "domain": "client-api.rocketmoney.com",
                    "path": "/",
                    "expires": -1,
                    "secure": True,
                    "httpOnly": True,
                },
                {
                    "name": "idp",
                    "value": "private",
                    "domain": "auth.rocketaccount.com",
                    "path": "/",
                    "expires": -1,
                    "secure": True,
                    "httpOnly": True,
                },
            ],
            "origins": [{"origin": "https://auth.rocketaccount.com", "localStorage": []}],
        },
    )
    cookies = session.cookies()
    assert all(c.name != "idp" for c in cookies.jar)
    cookies.set("api", "new", domain="client-api.rocketmoney.com", path="/")
    session.save_cookies(cookies)
    after = read_private(session.file)
    assert {c["name"]: c["value"] for c in after["cookies"]} == {"api": "new", "idp": "private"}
    assert after["origins"]
    session.bind_identity("u", initial=True)
    with pytest.raises(GatewayError, match="ACCOUNT_MISMATCH"):
        session.bind_identity("other")


def test_batch_status_retains_items_and_blocks_replay(tmp_path):
    client, provider, _ = setup(tmp_path)
    rid = str(uuid.uuid4())
    result = client.batch(
        [category(), date_request()],
        "rocket_money_write",
        "main",
        rid,
        [{"transactionCategoryNodeId": "old"}, {"date": "2026-10-08"}],
    )
    assert len(result["results"]) == 2
    assert [x["outcome"] for x in client.status(rid, "main")["items"]] == ["verified", "verified"]
    with pytest.raises(GatewayError, match="REPLAY_RECORDED"):
        client.batch(
            [category(), date_request()],
            "rocket_money_write",
            "main",
            rid,
            [{"transactionCategoryNodeId": "old"}, {"date": "2026-10-08"}],
        )
    assert provider.writes == 2
