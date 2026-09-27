"""Validate native GraphQL against an explicit, source-derived selection policy."""

from dataclasses import dataclass
from datetime import date
import json
from importlib.resources import files

from graphql import parse
from graphql.language import ast
from graphql.utilities import value_from_ast_untyped

from .config import exact_keys
from .errors import GatewayError

POLICY = json.loads(files("puddles_cli").joinpath("resources/read-policy.json").read_text())
MUTATIONS = {
    "setTransactionCategory": ("SetTransactionCategoryPayload", "transactionCategoryNodeId"),
    "changeTransactionDate": ("ChangeTransactionDatePayload", "date"),
}
PAYLOADS = {
    "SetTransactionCategoryPayload": {"updatedTransactions": {"type": "Transaction", "args": []}},
    "ChangeTransactionDatePayload": {"transaction": {"type": "Transaction", "args": []}},
}


@dataclass(frozen=True)
class Change:
    transaction: str
    field: str
    value: str


@dataclass(frozen=True)
class Allowed:
    envelope: dict
    changes: tuple[Change, ...]


def reject():
    raise GatewayError("POLICY_DENIED")


def validate(envelope, tool: str) -> Allowed:
    exact_keys(envelope, ["query", "variables", "operationName"], ["query"])
    query = envelope["query"]
    variables = envelope.get("variables") or {}
    if not isinstance(query, str) or len(query) > 262144 or not isinstance(variables, dict):
        reject()
    try:
        document = parse(query, max_tokens=10000)
    except Exception:
        reject()
    operations = [d for d in document.definitions if isinstance(d, ast.OperationDefinitionNode)]
    fragments = {}
    for d in document.definitions:
        if isinstance(d, ast.FragmentDefinitionNode):
            if d.name.value in fragments:
                reject()
            fragments[d.name.value] = d
        elif not isinstance(d, ast.OperationDefinitionNode):
            reject()
    names = [d.name.value for d in operations if d.name]
    if len(set(names)) != len(names) or (len(operations) > 1 and any(not d.name for d in operations)):
        reject()
    chosen = [o for o in operations if o.name and o.name.value == envelope.get("operationName")]
    op = (
        chosen[0]
        if len(chosen) == 1
        else operations[0]
        if len(operations) == 1 and not envelope.get("operationName")
        else None
    )
    if not op or op.operation.value not in ("query", "mutation") or op.directives:
        reject()
    if (op.operation.value == "mutation") != (tool == "rocket_money_write"):
        reject()
    values = dict(variables)
    declared = set()
    for definition in op.variable_definitions or []:
        key = definition.variable.name.value
        if key in declared or definition.directives:
            reject()
        declared.add(key)
        if key not in values and definition.default_value is not None:
            values[key] = value_from_ast_untyped(definition.default_value)
        if isinstance(definition.type, ast.NonNullTypeNode) and values.get(key) is None:
            reject()
    if set(values) - declared:
        reject()
    changes = []
    visited = 0

    def evaluated(node):
        # Unbound variables are invalid, including in directives or nested objects.
        def check(n):
            if isinstance(n, ast.VariableNode) and n.name.value not in values:
                reject()
            for key in getattr(n, "keys", ()):
                child = getattr(n, key, None)
                for item in child if isinstance(child, tuple) else [child]:
                    if isinstance(item, ast.Node):
                        check(item)

        check(node)
        return value_from_ast_untyped(node, values)

    def directives(node):
        for directive in node.directives or []:
            if directive.name.value not in ("include", "skip") or len(directive.arguments) != 1:
                reject()
            arg = directive.arguments[0]
            if arg.name.value != "if" or not isinstance(evaluated(arg.value), bool):
                reject()

    def walk(selection, parent, stack=(), depth=0):
        nonlocal visited
        if depth > 14 or selection is None:
            reject()
        response_names = set()
        for node in selection.selections:
            visited += 1
            if visited > 1000:
                reject()
            directives(node)
            if isinstance(node, ast.FragmentSpreadNode):
                name = node.name.value
                frag = fragments.get(name)
                if not frag or name in stack or frag.directives or frag.type_condition.name.value != parent:
                    reject()
                walk(frag.selection_set, parent, (*stack, name), depth + 1)
                continue
            if isinstance(node, ast.InlineFragmentNode):
                if node.type_condition and node.type_condition.name.value != parent:
                    reject()
                walk(node.selection_set, parent, stack, depth + 1)
                continue
            if not isinstance(node, ast.FieldNode):
                reject()
            name = node.name.value
            alias = node.alias.value if node.alias else name
            if alias in response_names:
                reject()
            response_names.add(alias)
            args = {}
            for arg in node.arguments:
                if arg.name.value in args:
                    reject()
                args[arg.name.value] = evaluated(arg.value)
            if name == "__typename" and not args and not node.selection_set and parent != "Mutation":
                continue
            if parent == "Mutation":
                if name not in MUTATIONS or set(args) != {"input"}:
                    reject()
                inp = args["input"]
                field = MUTATIONS[name][1]
                expected = {"transactionNodeId", field}
                if field != "date":
                    expected.add("categorizeAllRelatedTransactions")
                if not isinstance(inp, dict) or set(inp) != expected:
                    reject()
                if not all(
                    isinstance(inp[k], str) and 0 < len(inp[k]) <= 256 for k in ("transactionNodeId", field)
                ):
                    reject()
                if field == "date":
                    try:
                        if date.fromisoformat(inp[field]).isoformat() != inp[field]:
                            reject()
                    except ValueError:
                        reject()
                elif inp["categorizeAllRelatedTransactions"] is not False:
                    reject()
                changes.append(Change(inp["transactionNodeId"], field, inp[field]))
                if len(changes) > 1:
                    # One mutation per native envelope; batch provides individual outcomes.
                    reject()
                walk(node.selection_set, MUTATIONS[name][0], stack, depth + 1)
                continue
            fields = (
                {"viewer": {"type": POLICY["viewerType"], "args": []}}
                if parent == "RootQueryType"
                else POLICY["viewer"]
                if parent == POLICY["viewerType"]
                else PAYLOADS.get(parent, POLICY["types"].get(parent, {}))
            )
            field = fields.get(name)
            if not field or set(args) - set(field["args"]):
                reject()
            for key, value in args.items():
                if isinstance(value, dict) or (
                    isinstance(value, list) and any(isinstance(x, (dict, list)) for x in value)
                ):
                    reject()
                if key in ("first", "last", "limit", "numMonths", "monthsToLookBack") and (
                    type(value) is not int or not 1 <= value <= 500
                ):
                    reject()
            if name == "budgetPlan" and args.get("createCurrentPlan") is not False:
                # Omission could select a side-effectful server default.
                reject()
            child_type = field["type"]
            if child_type in POLICY["types"] or child_type in PAYLOADS or child_type == POLICY["viewerType"]:
                walk(node.selection_set, child_type, stack, depth + 1)
            elif node.selection_set:
                reject()

    walk(op.selection_set, "Mutation" if op.operation.value == "mutation" else "RootQueryType")
    if tool == "rocket_money_write" and len(changes) != 1:
        reject()
    return Allowed(envelope, tuple(changes))
