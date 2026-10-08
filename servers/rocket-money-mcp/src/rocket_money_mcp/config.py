import json

from .errors import GatewayError


def exact_keys(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise GatewayError("INVALID_INPUT")


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise GatewayError("INVALID_INPUT")
            result[key] = value
        return result

    try:
        return json.loads(
            text,
            object_pairs_hook=pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(GatewayError("INVALID_INPUT")),
        )
    except (ValueError, TypeError, RecursionError):
        raise GatewayError("INVALID_INPUT") from None
