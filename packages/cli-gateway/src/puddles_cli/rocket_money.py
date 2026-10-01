import hashlib
import json
import time
import uuid
from pathlib import Path

import httpx

from .auth import API, IDENTITY_QUERY, BrowserSession, auth_failed, identity
from .errors import GatewayError
from .policy import Allowed, validate
from .state import atomic_json, read_private

SNAPSHOT = "query PuddlesTransaction($id: ID!) { node(id: $id) { id ... on Transaction { date category { id label } } } }"


class RocketMoney:
    def __init__(self, directory: Path, session=None, transport=None):
        self.directory = directory
        self.session = session or BrowserSession(directory)
        self.transport = transport

    def _post(self, envelope):
        with httpx.Client(
            cookies=self.session.cookies(),
            transport=self.transport,
            trust_env=False,
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=False,
        ) as client:
            try:
                with client.stream(
                    "POST", API, json=envelope, headers={"Accept": "application/json"}
                ) as response:
                    chunks = []
                    length = 0
                    for chunk in response.iter_bytes():
                        length += len(chunk)
                        if length > 16 * 1024 * 1024:
                            raise GatewayError("LIMIT_EXCEEDED")
                        chunks.append(chunk)
                    self.session.save_cookies(client.cookies)
                    try:
                        body = json.loads(b"".join(chunks))
                    except (ValueError, UnicodeError):
                        raise GatewayError("UPSTREAM_ERROR") from None
                    if not isinstance(body, dict) or not ("data" in body or "errors" in body):
                        raise GatewayError("UPSTREAM_ERROR")
                    if auth_failed(response.status_code, body):
                        raise GatewayError("AUTH_REQUIRED")
                    if not 200 <= response.status_code < 300:
                        raise GatewayError("UPSTREAM_ERROR")
                    return body
            except httpx.HTTPError:
                raise GatewayError("UPSTREAM_ERROR") from None

    def ready(self):
        try:
            body = self._post(IDENTITY_QUERY)
        except GatewayError as error:
            if error.code != "AUTH_REQUIRED":
                raise
            self.session.renew()
            body = self._post(IDENTITY_QUERY)
        self.session.bind_identity(identity(body))

    def snapshot(self, transaction):
        body = self._post(
            {"query": SNAPSHOT, "variables": {"id": transaction}, "operationName": "PuddlesTransaction"}
        )
        try:
            node = body["data"]["node"]
            if body.get("errors") or node["id"] != transaction:
                raise ValueError()
            return {"date": node["date"], "transactionCategoryNodeId": node["category"]["id"]}
        except (TypeError, KeyError, ValueError):
            raise GatewayError("UPSTREAM_ERROR") from None

    def status(self, request_id, caller):
        path = self.record_path(request_id)
        record = read_private(path)
        if not record or record["caller"] != caller:
            raise GatewayError("NOT_FOUND")
        result = {
            "requestId": request_id,
            "outcome": "unknown" if record["outcome"] == "in_flight" else record["outcome"],
        }
        if "items" in record:
            result["items"] = []
            for item in record["items"]:
                try:
                    result["items"].append(self.status(item, caller))
                except GatewayError:
                    result["items"].append({"requestId": item, "outcome": "not_dispatched"})
        return result

    def record_path(self, request_id):
        try:
            if str(uuid.UUID(request_id)) != request_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise GatewayError("INVALID_REQUEST") from None
        return self.directory / "operations" / f"{request_id}.json"

    def save_record(self, path, record):
        if not path.exists() and path.parent.exists() and sum(1 for _ in path.parent.iterdir()) >= 10000:
            raise GatewayError("STATE_CAPACITY_REACHED")
        atomic_json(path, record)

    def execute(self, allowed: Allowed, caller: str, request_id=None, expected=None):
        if not allowed.changes:
            self.ready()
            return self._post(allowed.envelope)
        path = self.record_path(request_id)
        change = allowed.changes[0]
        if (
            not isinstance(expected, dict)
            or set(expected) != {change.field}
            or not isinstance(expected[change.field], str)
        ):
            raise GatewayError("EXPECTED_STATE_REQUIRED")
        fingerprint = hashlib.sha256(
            json.dumps(
                {"request": allowed.envelope, "expected": expected}, sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        old = read_private(path)
        if old:
            if old["caller"] != caller or old["fingerprint"] != fingerprint:
                raise GatewayError("REQUEST_ID_CONFLICT")
            raise GatewayError(
                "REPLAY_RECORDED", "unknown" if old["outcome"] == "in_flight" else old["outcome"]
            )
        self.ready()
        before = self.snapshot(change.transaction)
        if before[change.field] != expected[change.field]:
            raise GatewayError("STATE_CONFLICT")
        record = {
            "caller": caller,
            "fingerprint": fingerprint,
            "transaction": change.transaction,
            "field": change.field,
            "before": before[change.field],
            "desired": change.value,
            "createdAt": int(time.time()),
            "outcome": "in_flight",
        }
        self.save_record(path, record)
        try:
            result = self._post(allowed.envelope)
            after = self.snapshot(change.transaction)
            record["outcome"] = (
                "verified"
                if after[change.field] == change.value
                else "not_applied"
                if after[change.field] == before[change.field]
                else "conflict"
            )
            self.save_record(path, record)
            return result
        except Exception:
            record["outcome"] = "unknown"
            self.save_record(path, record)
            raise GatewayError("OUTCOME_UNKNOWN", "unknown") from None

    def batch(self, envelopes, tool, caller, batch_id, expected=None):
        if not isinstance(envelopes, list) or not 1 <= len(envelopes) <= 20:
            raise GatewayError("INVALID_REQUEST")
        # Validate the whole batch before executing any item.
        operations = [validate(item, tool) for item in envelopes]
        if tool == "rocket_money_write":
            self.record_path(batch_id)
            if not isinstance(expected, list) or len(expected) != len(operations):
                raise GatewayError("EXPECTED_STATE_REQUIRED")
            for op, state in zip(operations, expected):
                if (
                    not isinstance(state, dict)
                    or set(state) != {op.changes[0].field}
                    or not isinstance(state[op.changes[0].field], str)
                ):
                    raise GatewayError("EXPECTED_STATE_REQUIRED")
        parent = None
        if tool == "rocket_money_write":
            fingerprint = hashlib.sha256(
                json.dumps({"requests": envelopes, "expected": expected}, sort_keys=True).encode()
            ).hexdigest()
            path = self.record_path(batch_id)
            old = read_private(path)
            if old:
                if old["caller"] != caller or old["fingerprint"] != fingerprint:
                    raise GatewayError("REQUEST_ID_CONFLICT")
                raise GatewayError(
                    "REPLAY_RECORDED", "unknown" if old["outcome"] == "in_flight" else old["outcome"]
                )
            parent = {
                "caller": caller,
                "fingerprint": fingerprint,
                "createdAt": int(time.time()),
                "outcome": "in_flight",
                "items": [str(uuid.uuid5(uuid.UUID(batch_id), str(i))) for i in range(len(operations))],
            }
            self.save_record(path, parent)
        results = []
        for index, operation in enumerate(operations):
            item_id = str(uuid.uuid5(uuid.UUID(batch_id), str(index))) if batch_id else None
            try:
                result = self.execute(operation, caller, item_id, expected[index] if expected else None)
                results.append({"response": result, "requestId": item_id})
            except GatewayError as error:
                results.append(
                    {"gateway_error": {"code": error.code, "outcome": error.outcome}, "requestId": item_id}
                )
        if parent:
            parent["outcome"] = "complete"
            self.save_record(self.record_path(batch_id), parent)
        return {
            "results": results,
            "coverage": {"requested": len(envelopes), "processed": len(results), "atomic": False},
        }
