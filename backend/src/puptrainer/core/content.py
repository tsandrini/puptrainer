"""Loads `content/`: passages, protocols and the metric texts."""

import tomllib
from pathlib import Path

from puptrainer.core.metrics import REGISTRY
from puptrainer.core.schemas import Content, MetricDef, Passage, Protocol


def load_content(content_dir: Path) -> Content:
    """Read passages and protocols.

    Args:
        content_dir: The repository's `content/` directory.

    Returns:
        The passages of `passages/*.toml` and the protocols of `protocols/*.toml`.

    Raises:
        FileNotFoundError: `content_dir` does not exist.
        ValueError: A file does not have the expected shape, or a protocol refers to a
            passage that does not exist.
    """
    if not content_dir.is_dir():
        raise FileNotFoundError(f"content directory not found: {content_dir}")
    passages = [
        Passage.model_validate(tomllib.loads(p.read_text(encoding="utf-8")))
        for p in sorted((content_dir / "passages").glob("*.toml"))
    ]
    protocols = [
        Protocol.model_validate(tomllib.loads(p.read_text(encoding="utf-8")))
        for p in sorted((content_dir / "protocols").glob("*.toml"))
    ]
    refs = {passage_ref(p) for p in passages}
    for protocol in protocols:
        for item in protocol.items:
            if item.content_ref is not None and item.content_ref not in refs:
                raise ValueError(f"protocol {protocol.id}: unknown passage {item.content_ref}")
    return Content(passages=passages, protocols=protocols)


def passage_ref(passage: Passage) -> str:
    """The reference takes store for a passage, e.g. `passage:garden-en@1`."""
    return f"passage:{passage.id}@{passage.version}"


def load_metrics(content_dir: Path) -> list[MetricDef]:
    """The registry with the titles and descriptions of `metrics/<lang>.toml` merged in.

    Args:
        content_dir: The repository's `content/` directory.

    Returns:
        One definition per registry entry; texts are empty for languages without a file.
    """
    texts: dict[str, dict[str, dict[str, str]]] = {}
    for path in sorted((content_dir / "metrics").glob("*.toml")):
        texts[path.stem] = tomllib.loads(path.read_text(encoding="utf-8"))
    out = []
    for metric in REGISTRY:
        titles = {lang: t[metric.key]["title"] for lang, t in texts.items() if metric.key in t}
        descriptions = {
            lang: t[metric.key].get("description", "")
            for lang, t in texts.items()
            if metric.key in t
        }
        notes = {
            lang: t[metric.key]["note"]
            for lang, t in texts.items()
            if metric.key in t and "note" in t[metric.key]
        }
        out.append(
            metric.model_copy(
                update={"titles": titles, "descriptions": descriptions, "notes": notes}
            )
        )
    return out
