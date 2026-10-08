"""Rocket Money business operations. No model-controlled authentication or destination."""

import hashlib
import json
import uuid
from importlib.resources import files
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from puddles_browser_auth import BrowserAuth, Site, now
from puddles_browser_auth.state import account_lock, atomic_json, private_directory, read_private

from .errors import GatewayError
from .policy import project_result, validate

SITE = Site(
    "https://app.rocketmoney.com/",
    "https://client-api.rocketmoney.com/graphql",
    "https://client-api.rocketmoney.com/auth0/auth/oidc/login?silentOnly=true&returnTo=https%3A%2F%2Fapp.rocketmoney.com%2F",
    ("https://auth.rocketaccount.com",),
)
IDENTITY = {"query": "query Identity { viewer { id } }", "operationName": "Identity"}
SNAPSHOT = (
    "query TransactionState($id: ID!) { node(id:$id) { id ... on Transaction { date category { id } } } }"
)
TOOLS = json.loads(files("rocket_money_mcp").joinpath("resources/tools.json").read_text())
SCHEMAS = {t["name"]: Draft202012Validator(t["inputSchema"], format_checker=FormatChecker()) for t in TOOLS}


def error(code):
    return {"status": "error", "error": {"code": code, "message": code.replace("_", " ").lower()}}


class RocketMoney:
    def __init__(self, directory: Path, auth=None, executable=None):
        self.directory = private_directory(directory)
        self.auth = auth or BrowserAuth(private_directory(directory / "auth"), SITE, executable)
        self.identity_file = directory / "identity.json"

    def post(self, request):
        body = self.auth.post(request)
        errors = body.get("errors", [])
        if not isinstance(errors, list):
            raise GatewayError("PROVIDER_ERROR")
        for entry in errors:
            if (
                isinstance(entry, dict)
                and isinstance(entry.get("extensions"), dict)
                and entry["extensions"].get("code") in ("GRAPHQL_REQUIRES_AUTHENTICATION", "UNAUTHENTICATED")
            ):
                self.auth.mark("expired")
                raise GatewayError("NEEDS_USER_LOGIN")
        if "data" not in body and not errors:
            raise GatewayError("PROVIDER_ERROR")
        return body

    def verify_identity(self, initial=False):
        body = self.post(IDENTITY)
        viewer = (body.get("data") or {}).get("viewer")
        user_id = viewer.get("id") if isinstance(viewer, dict) else None
        if not isinstance(user_id, str) or not user_id or body.get("errors"):
            raise GatewayError("NEEDS_USER_LOGIN")
        old = read_private(self.identity_file)
        if old and old.get("viewerId") != user_id:
            raise GatewayError("ACCOUNT_MISMATCH")
        if not old:
            if not initial:
                raise GatewayError("NEEDS_USER_LOGIN")
            atomic_json(self.identity_file, {"viewerId": user_id})
        self.auth.mark("ready")

    def ready(self):
        if not read_private(self.identity_file):
            self.auth.mark("needs_user_login")
            raise GatewayError("NEEDS_USER_LOGIN")
        try:
            self.verify_identity()
        except GatewayError as exc:
            if exc.code != "NEEDS_USER_LOGIN":
                if exc.code == "ACCOUNT_MISMATCH":
                    self.auth.mark("needs_user_login")
                    self.auth.close()
                raise
            try:
                self.auth.open_login()
                self.verify_identity()
            except GatewayError:
                self.auth.mark("needs_user_login")
                self.auth.close()
                raise GatewayError("NEEDS_USER_LOGIN") from None

    def snapshot(self, tx):
        body = self.post({"query": SNAPSHOT, "variables": {"id": tx}, "operationName": "TransactionState"})
        try:
            node = body["data"]["node"]
            if body.get("errors") or node["id"] != tx:
                raise ValueError()
            state = {"categoryId": node["category"]["id"], "date": node["date"]}
            if not all(isinstance(v, str) and v for v in state.values()):
                raise ValueError()
            return state
        except (KeyError, TypeError, ValueError):
            raise GatewayError("PROVIDER_ERROR") from None

    def record_path(self, request_id):
        if str(uuid.UUID(request_id)) != request_id:
            raise GatewayError("INVALID_INPUT")
        return self.directory / "operations" / (request_id + ".json")

    def write(self, name, params):
        path = self.record_path(params["requestId"])
        fingerprint = hashlib.sha256(json.dumps([name, params], sort_keys=True).encode()).hexdigest()
        old = read_private(path)
        if old:
            if old["fingerprint"] != fingerprint:
                return error("REQUEST_ID_REUSED")
            result = old["result"]
            if result["status"] == "in_progress":
                result = {**result, "status": "unknown"}
            return result
        field = "categoryId" if name.endswith("category") else "date"
        expected = params["expectedCategoryId" if field == "categoryId" else "expectedDate"]
        result = {
            "requestId": params["requestId"],
            "transactionId": params["transactionId"],
            "field": field,
            "expected": expected,
            "requested": params[field],
            "observed": None,
            "observedAt": None,
            "status": "blocked",
        }
        record = {"fingerprint": fingerprint, "result": result}
        # Persist acceptance even when auth/preflight subsequently fails.
        atomic_json(path, record)
        dispatched = False
        try:
            self.ready()
            before = self.snapshot(params["transactionId"])[field]
            result.update(observed=before, observedAt=now())
            if before != expected:
                result["status"] = "conflict"
            elif before == params[field]:
                result["status"] = "unchanged"
            else:
                result["status"] = "in_progress"
                atomic_json(path, record)
                inp = {"transactionNodeId": params["transactionId"]}
                if field == "categoryId":
                    inp.update(
                        transactionCategoryNodeId=params[field], categorizeAllRelatedTransactions=False
                    )
                    query = "mutation Change($input:SetTransactionCategoryInput!){setTransactionCategory(input:$input){updatedTransactions{id category{id}}}}"
                else:
                    inp["date"] = params[field]
                    query = "mutation Change($input:ChangeTransactionDateInput!){changeTransactionDate(input:$input){transaction{id date}}}"
                request = {"query": query, "variables": {"input": inp}, "operationName": "Change"}
                validate(request, "rocket_money_write")
                dispatched = True
                self.post(request)  # Never retry a mutation after transport/auth failure.
                after = self.snapshot(params["transactionId"])[field]
                result.update(
                    observed=after,
                    observedAt=now(),
                    status="verified" if after == params[field] else "unknown",
                )
        except Exception as exc:  # noqa: BLE001 - preserve uncertain write outcomes
            result["status"] = "unknown" if dispatched else "blocked"
            result["error"] = {"code": exc.code if isinstance(exc, GatewayError) else "PROVIDER_ERROR"}
        atomic_json(path, record)
        return result

    def operation_status(self, request_id):
        path = self.record_path(request_id)
        record = read_private(path)
        if not record:
            return {"requestId": request_id, "status": "not_found"}
        result = record["result"]
        if result["status"] in ("unknown", "in_progress"):
            result["status"] = "unknown"
            try:
                self.ready()
                observed = self.snapshot(result["transactionId"])[result["field"]]
                result.update(observed=observed, observedAt=now())
                if observed == result["requested"]:
                    result["status"] = "verified"
                    result.pop("error", None)
            except GatewayError as exc:
                result["error"] = {"code": exc.code}
            atomic_json(path, record)
        return result

    def call(self, name, params):
        try:
            with account_lock(self.directory, timeout=2):
                return self._call(name, params)
        except GatewayError as exc:
            return error(exc.code)

    def _call(self, name, params):
        try:
            if name not in SCHEMAS or not isinstance(params, dict):
                return error("INVALID_INPUT")
            if len(json.dumps(params).encode()) > 1024 * 1024 or not SCHEMAS[name].is_valid(params):
                return error("INVALID_INPUT")
            if name == "rocket_money_status":
                return self.auth.status()
            if name == "rocket_money_read":
                validated = validate(params, "rocket_money_read")
                self.ready()
                body = self.post(validated.envelope)
                # Never relay arbitrary upstream error text or extensions (may contain
                # auth diagnostics). Keep financial data and bounded error codes only.
                data = project_result(validated.envelope, body.get("data"))
                errs = [{"message": "Provider query error"} for _ in body.get("errors", [])[:20]]
                if errs and not data:
                    return error("PROVIDER_ERROR")
                result = {"data": data}
                if errs:
                    result["errors"] = errs
                return {"status": "partial" if errs else "ok", "result": result}
            if name == "rocket_money_operation_status":
                return self.operation_status(params["requestId"])
            return self.write(name, params)
        except GatewayError as exc:
            codes = {"POLICY_DENIED": "UNSUPPORTED_QUERY", "INVALID_REQUEST": "INVALID_INPUT"}
            return error(codes.get(exc.code, exc.code))
        except Exception:  # noqa: BLE001 - sanitize host/provider failures
            return error("PROVIDER_ERROR")

    def close(self):
        self.auth.close()
