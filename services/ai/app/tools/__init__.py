"""Copilot tool registry.

Tools are deterministic, side-effect-light callables that answer a natural-
language question against a specific data plane (geo, metrics, …) and return
a structured payload the copilot can cite and the UI can render.

Register via ``register_tool`` (or the ``tool`` decorator); the FastAPI
surface exposes the registry at ``GET /v1/tools`` and tools self-register on
import of their module. Importing this package pulls in the built-in tools.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    handler: Callable[..., Any]
    tags: tuple[str, ...] = field(default_factory=tuple)


_REGISTRY: dict[str, ToolSpec] = {}


def register_tool(spec: ToolSpec) -> ToolSpec:
    if spec.name in _REGISTRY and _REGISTRY[spec.name].handler is not spec.handler:
        raise ValueError(f"tool '{spec.name}' already registered")
    _REGISTRY[spec.name] = spec
    return spec


def tool(name: str, description: str, tags: tuple[str, ...] = ()):
    """Decorator form of register_tool."""

    def wrap(fn: Callable[..., Any]) -> Callable[..., Any]:
        register_tool(ToolSpec(name=name, description=description,
                               handler=fn, tags=tags))
        return fn

    return wrap


def get_tool(name: str) -> ToolSpec | None:
    return _REGISTRY.get(name)


def list_tools() -> list[ToolSpec]:
    return [_REGISTRY[k] for k in sorted(_REGISTRY)]


# Built-in tools self-register on import.
from app.tools import geolibre_tool  # noqa: E402,F401
