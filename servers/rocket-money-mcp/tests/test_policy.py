import pytest

from rocket_money_mcp.config import strict_json
from rocket_money_mcp.errors import GatewayError
from rocket_money_mcp.policy import validate

READ = "rocket_money_read"
WRITE = "rocket_money_write"


def category(value=False):
    return {
        "query": "mutation C($input: SetTransactionCategoryInput!) { setTransactionCategory(input:$input) { updatedTransactions { id category { id label } } } }",
        "variables": {
            "input": {
                "transactionNodeId": "t1",
                "transactionCategoryNodeId": "groceries",
                "categorizeAllRelatedTransactions": value,
            }
        },
        "operationName": "C",
    }


def date_request():
    return {
        "query": "mutation D($input: ChangeTransactionDateInput!) { changeTransactionDate(input:$input) { transaction { id date } } }",
        "variables": {"input": {"transactionNodeId": "t1", "date": "2026-09-01"}},
        "operationName": "D",
    }


def test_source_names_aliases_fragments_variables_are_preserved():
    request = {
        "query": "query Q($n:Int=5) { viewer { rows: transactions(first:$n) { edges { node { ...T } } pageInfo { hasNextPage endCursor } } } } fragment T on Transaction { id name category { id label } }",
        "variables": {},
        "operationName": "Q",
    }
    assert validate(request, READ).envelope is request


@pytest.mark.parametrize(
    "query",
    [
        "{ viewer { accessToken } }",
        "{ viewer { x: authToken } }",
        "{ __schema { queryType { name } } }",
        "{ viewer { accounts { edges { node { data } } } } }",
        "{ viewer { budgetPlan { id } } }",
        "{ viewer { budgetPlan(createCurrentPlan:true) { id } } }",
        "query X($b:Boolean=true) { viewer { budgetPlan(createCurrentPlan:$b) { id } } }",
        "{ viewer { accounts { edges { node { unknownField } } } } }",
        "{ viewer { transactions(first:501) { edges { node { id } } } } }",
        "{ viewer { transactions(first:-1) { edges { node { id } } } } }",
        "{ viewer { id @skip(if:1) } }",
        "{ viewer { id @custom } }",
        "{ viewer { ...F } } fragment F on User { ...F }",
        "{ viewer { id } } mutation H { deleteAccount { id } }",
    ],
)
def test_denied_queries(query):
    with pytest.raises(GatewayError):
        validate({"query": query}, READ)


def test_safe_budget_plan_and_multiple_named_operations():
    query = "query Safe { viewer { budgetPlan(createCurrentPlan:false) { id month amountBudgeted } } } query Other { viewer { id } }"
    validate({"query": query, "operationName": "Safe"}, READ)


@pytest.mark.parametrize("flag", [True, None, "false", 0, 1])
def test_propagation_requires_literal_boolean_false(flag):
    with pytest.raises(GatewayError):
        validate(category(flag), WRITE)


def test_mutations_and_expected_inputs():
    assert validate(category(), WRITE).changes[0].field == "transactionCategoryNodeId"
    assert validate(date_request(), WRITE).changes[0].value == "2026-09-01"
    with pytest.raises(GatewayError):
        validate(category(), READ)
    with pytest.raises(GatewayError):
        validate({"query": "{viewer{id}}"}, WRITE)
    for name in ("categorizeAllRelatedTransactions", "transactionNodeId"):
        request = category()
        del request["variables"]["input"][name]
        with pytest.raises(GatewayError):
            validate(request, WRITE)
    request = category()
    request["variables"]["input"]["createRule"] = True
    with pytest.raises(GatewayError):
        validate(request, WRITE)


@pytest.mark.parametrize("value", ["2026-02-30", "20260901", "2026-9-1", "2026-09-01T00:00:00Z"])
def test_invalid_dates(value):
    request = date_request()
    request["variables"]["input"]["date"] = value
    with pytest.raises(GatewayError):
        validate(request, WRITE)


def test_duplicate_json_and_duplicate_graphql_arguments():
    with pytest.raises(GatewayError):
        strict_json('{"query":"a","query":"b"}')
    with pytest.raises(GatewayError):
        strict_json('{"value":NaN}')
    with pytest.raises(GatewayError):
        validate({"query": "{viewer{transactions(first:1,first:20){edges{node{id}}}}}"}, READ)


def test_selected_operation_only_and_unknown_variables():
    request = {"query": "query Q {viewer{id}} mutation X {deleteAccount{id}}", "operationName": "Q"}
    validate(request, READ)
    with pytest.raises(GatewayError):
        validate({**request, "variables": {"unused": True}}, READ)
