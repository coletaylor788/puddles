"""Explicit registration by operator-installed code, never by request input."""

from collections.abc import Callable

HANDLERS: dict[str, Callable] = {}


def register(tool: str, handler: Callable):
    if tool in HANDLERS or not tool or not tool.replace("_", "").isalnum():
        raise ValueError("Invalid or duplicate tool registration")
    HANDLERS[tool] = handler


def load_extensions():
    """Only distributions installed in the protected host environment participate."""
    from importlib.metadata import entry_points

    for entry in entry_points(group="puddles_cli.providers"):
        entry.load()()
