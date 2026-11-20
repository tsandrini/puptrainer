"""Loads `content/`: passages, protocols, skills, exercises, routines and the metric texts."""

import re
import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from puptrainer.core.evaluation import MEASURES
from puptrainer.core.metrics import REGISTRY
from puptrainer.core.reading import READING_MEASURES
from puptrainer.core.schemas import (
    Content,
    Exercise,
    Item,
    MeasureDef,
    MetricDef,
    MetricRule,
    Passage,
    PitchBandRule,
    PitchHoldRule,
    Protocol,
    Routine,
    SkillDef,
    StepsRule,
)

# NOTE: the language every text must have; the others fall back to it in the web app
BASE_LANGUAGE = "en"

# NOTE: which kinds of take each rule can judge
RULE_ITEMS: dict[type, frozenset[Item]] = {
    PitchBandRule: frozenset({Item.SUSTAIN, Item.PHRASE, Item.PASSAGE, Item.FREE, Item.OTHER}),
    PitchHoldRule: frozenset({Item.SUSTAIN}),
    StepsRule: frozenset({Item.SUSTAIN}),
}


def _read(path: Path) -> dict[str, Any]:
    try:
        return tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ValueError(f"{path}: {exc}") from None


def _load_each[T: BaseModel](folder: Path, model: type[T]) -> list[T]:
    out = []
    for path in sorted(folder.glob("*.toml")):
        try:
            out.append(model.model_validate(_read(path)))
        except ValueError as exc:
            raise ValueError(f"{path}: {exc}") from None
    return out


def load_content(content_dir: Path) -> Content:
    """Read and cross-check everything under `content/` except the metric texts.

    Args:
        content_dir: The repository's `content/` directory.

    Returns:
        The passages, protocols, skills, exercises and routines.

    Raises:
        FileNotFoundError: `content_dir` does not exist.
        ValueError: A file does not have the expected shape, or refers to something that
            does not exist (see `check`); the message names the file or the item.
    """
    if not content_dir.is_dir():
        raise FileNotFoundError(f"content directory not found: {content_dir}")
    skills_file = content_dir / "skills.toml"
    skills = (
        [SkillDef.model_validate(s) for s in _read(skills_file).get("skills", [])]
        if skills_file.exists()
        else []
    )
    content = Content(
        passages=_load_each(content_dir / "passages", Passage),
        protocols=_load_each(content_dir / "protocols", Protocol),
        skills=skills,
        exercises=_load_each(content_dir / "exercises", Exercise),
        routines=_load_each(content_dir / "routines", Routine),
    )
    check(content)
    return content


def check(content: Content) -> None:
    """Cross-check content: every reference resolves, every rule fits its exercise.

    Raises:
        ValueError: The first problem found, naming the item it is in.
    """
    passages = {passage_ref(p): p for p in content.passages}
    for protocol in content.protocols:
        for item in protocol.items:
            if item.content_ref is not None and item.content_ref not in passages:
                raise ValueError(f"protocol {protocol.id}: unknown passage {item.content_ref}")

    _unique("skill", [s.key for s in content.skills])
    _unique("exercise", [e.id for e in content.exercises])
    _unique("routine", [r.id for r in content.routines])
    metrics = {m.key: m for m in REGISTRY}
    skills = {s.key for s in content.skills}
    for exercise in content.exercises:
        where = f"exercise {exercise.id}"
        for field in ("titles", "summaries", "steps", "right", "why"):
            if BASE_LANGUAGE not in getattr(exercise, field):
                raise ValueError(f"{where}: {field} lack the base language ({BASE_LANGUAGE})")
        if exercise.skill not in skills:
            raise ValueError(f"{where}: skill {exercise.skill} is not described in skills.toml")
        for part in exercise.sequence:
            if part.pause == bool(part.labels) or (
                part.labels and BASE_LANGUAGE not in part.labels
            ):
                raise ValueError(
                    f"{where}: a part of the sequence is a pause or has labels ({BASE_LANGUAGE})"
                )
        if exercise.intent not in ("drill", "attempt"):
            raise ValueError(f"{where}: intent must be drill or attempt")
        for language, ref in exercise.texts.items():
            passage = passages.get(ref)
            if passage is None:
                raise ValueError(f"{where}: unknown passage {ref}")
            if passage.language != language:
                raise ValueError(f"{where}: {ref} is not in {language}")
        rule = exercise.rule
        keys = [*exercise.hints, *([rule.key] if isinstance(rule, MetricRule) else [])]
        for key in keys:
            metric = metrics.get(key)
            if metric is None:
                raise ValueError(f"{where}: unknown metric {key}")
            if metric.items is not None and exercise.item not in metric.items:
                raise ValueError(f"{where}: {key} is not measured on {exercise.item} takes")
        allowed = RULE_ITEMS.get(type(rule))
        if allowed is not None and exercise.item not in allowed:
            raise ValueError(f"{where}: a {rule.kind} rule cannot judge {exercise.item} takes")

    exercises = {e.id for e in content.exercises}
    for routine in content.routines:
        if BASE_LANGUAGE not in routine.titles:
            raise ValueError(f"routine {routine.id}: titles lack the base language")
        for step in routine.steps:
            if step.exercise not in exercises:
                raise ValueError(f"routine {routine.id}: unknown exercise {step.exercise}")


def _unique(kind: str, keys: list[str]) -> None:
    seen: set[str] = set()
    for key in keys:
        if key in seen:
            raise ValueError(f"{kind} {key} is defined twice")
        seen.add(key)


def passage_ref(passage: Passage) -> str:
    """The reference takes store for a passage, e.g. `passage:garden-en@1`."""
    return f"passage:{passage.id}@{passage.version}"


def exercise_ref(exercise: Exercise) -> str:
    """The reference takes store for an exercise, e.g. `exercise:note-match@1`."""
    return f"exercise:{exercise.id}@{exercise.version}"


def routine_ref(routine: Routine) -> str:
    """The reference sessions store for a routine, e.g. `routine:starter@1`."""
    return f"routine:{routine.id}@{routine.version}"


def parse_ref(ref: str, kind: str) -> tuple[str, int] | None:
    """Split a reference like `exercise:note-match@1` into id and version.

    Args:
        ref: The reference.
        kind: The kind it must be (`exercise`, `routine`).

    Returns:
        The id and the version, or `None` when `ref` is not a reference of that kind.
    """
    match = re.fullmatch(rf"{kind}:([a-z0-9][a-z0-9-]*)@([1-9][0-9]*)", ref)
    return None if match is None else (match.group(1), int(match.group(2)))


def load_measures(content_dir: Path) -> list[MeasureDef]:
    """The measures of the evaluation and of a reading, with their texts merged in.

    Args:
        content_dir: The repository's `content/` directory.

    Returns:
        One definition per measure, with the titles and descriptions of
        `measures/<lang>.toml` and the titles of its zones (`zones.<key>` there); texts
        are empty for languages without a file.
    """
    texts: dict[str, dict[str, dict[str, Any]]] = {}
    for path in sorted((content_dir / "measures").glob("*.toml")):
        texts[path.stem] = _read(path)
    return [
        measure.model_copy(
            update={
                "titles": {
                    k: t[measure.key]["title"] for k, t in texts.items() if measure.key in t
                },
                "descriptions": {
                    k: t[measure.key].get("description", "")
                    for k, t in texts.items()
                    if measure.key in t
                },
                "zones": [
                    zone.model_copy(
                        update={
                            "titles": {
                                k: t[measure.key]["zones"][zone.key]
                                for k, t in texts.items()
                                if zone.key in t.get(measure.key, {}).get("zones", {})
                            }
                        }
                    )
                    for zone in measure.zones
                ],
            }
        )
        for measure in (*MEASURES, *READING_MEASURES)
    ]


def load_metrics(content_dir: Path) -> list[MetricDef]:
    """The registry with the titles and descriptions of `metrics/<lang>.toml` merged in.

    Args:
        content_dir: The repository's `content/` directory.

    Returns:
        One definition per registry entry, with its title, description, reliability note
        and how it relates to the two targets; texts are empty for languages without a file.
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
        notes, relates = (
            {
                lang: t[metric.key][field]
                for lang, t in texts.items()
                if metric.key in t and field in t[metric.key]
            }
            for field in ("note", "relates")
        )
        out.append(
            metric.model_copy(
                update={
                    "titles": titles,
                    "descriptions": descriptions,
                    "notes": notes,
                    "relates": relates,
                }
            )
        )
    return out
