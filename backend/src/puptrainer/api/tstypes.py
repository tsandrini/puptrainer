"""TypeScript types of the API's models, for the web app (`web/src/lib/api/types.ts`).

    python -m puptrainer.api.tstypes > web/src/lib/api/types.ts

A test compares the committed file with what this module renders, so the web app's
types cannot drift from the models.
"""

import sys
from typing import Any, Literal

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from puptrainer.core import schemas

HEADER = """\
// Generated from the API's models by `python -m puptrainer.api.tstypes`.
// Do not edit: change the models in backend/src/puptrainer/core/schemas.py and regenerate.
"""

# NOTE: what the web app sends: fields with a default are optional. Everything else is
# what it receives, where every field is present.
REQUESTS: tuple[type[BaseModel], ...] = (
    schemas.DeviceIn,
    schemas.TakeMeta,
    schemas.TakePatch,
    schemas.JobResult,
    schemas.JobFailure,
)


def ts_type(schema: dict[str, Any]) -> str:
    """The TypeScript type of one JSON-schema node.

    Args:
        schema: A schema as pydantic emits it: a `$ref`, an `anyOf`, an enum, an array, an
            object with `additionalProperties`, or a primitive.

    Returns:
        A TypeScript type expression.

    Raises:
        ValueError: The node uses a construct this renderer does not know.
    """
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[1]
    if "anyOf" in schema:
        return " | ".join(ts_type(option) for option in schema["anyOf"])
    if "enum" in schema:
        return " | ".join(f"'{value}'" for value in schema["enum"])
    kind = schema.get("type")
    if kind == "array":
        inner = ts_type(schema["items"])
        return f"({inner})[]" if " | " in inner else f"{inner}[]"
    if kind == "object":
        values = schema.get("additionalProperties")
        if isinstance(values, dict):
            return f"Record<string, {ts_type(values)}>"
        return "Record<string, unknown>"
    primitives = {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "null": "null",
    }
    if kind in primitives:
        return primitives[kind]
    raise ValueError(f"cannot render schema: {schema}")


def render(definitions: dict[str, dict[str, Any]]) -> str:
    """Render JSON-schema definitions as exported TypeScript types.

    Args:
        definitions: Schemas by model name.

    Returns:
        The file's text: one `export type` per model, in name order. A property is
        optional (`?`) when its schema does not require it.
    """
    blocks = [HEADER]
    for name, schema in sorted(definitions.items()):
        doc = (schema.get("description") or "").strip().split("\n\n")[0].replace("\n", " ")
        comment = f"/** {doc} */\n" if doc else ""
        if "properties" not in schema:
            blocks.append(f"{comment}export type {name} = {ts_type(schema)};\n")
            continue
        required = set(schema.get("required", []))
        lines = [
            f"\t{key}{'' if key in required else '?'}: {ts_type(prop)};"
            for key, prop in schema["properties"].items()
        ]
        blocks.append(f"{comment}export type {name} = {{\n" + "\n".join(lines) + "\n};\n")
    return "\n".join(blocks)


def current() -> str:
    """The types of every model in `puptrainer.core.schemas` as they are now."""
    models = [
        value
        for value in vars(schemas).values()
        if isinstance(value, type)
        and issubclass(value, BaseModel)
        and value.__module__ == schemas.__name__
        and value is not schemas.Schema
    ]
    pairs: list[tuple[type[BaseModel], Literal["validation", "serialization"]]] = [
        (model, "validation" if model in REQUESTS else "serialization") for model in models
    ]
    _, schema = models_json_schema(pairs, ref_template="#/$defs/{model}")
    return render(schema["$defs"])


if __name__ == "__main__":
    sys.stdout.write(current())
