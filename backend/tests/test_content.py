import shutil
from pathlib import Path

import pytest

from puptrainer.core.content import exercise_ref, load_content, routine_ref

from .conftest import CONTENT

LANGUAGES = {"en", "cs"}


@pytest.fixture
def content_copy(tmp_path: Path) -> Path:
    target = tmp_path / "content"
    # NOTE: in the Nix build the content is a read-only store path; the copy is edited
    shutil.copytree(CONTENT, target, copy_function=shutil.copyfile)
    for folder in [target, *target.rglob("*")]:
        if folder.is_dir():
            folder.chmod(0o755)
    return target


def test_catalogue_loads_with_every_text_in_both_languages() -> None:
    content = load_content(CONTENT)
    assert {e.id for e in content.exercises} >= {"slide-down-hold", "note-match", "count-in-band"}
    assert {r.id for r in content.routines} == {"starter", "quick", "size"}
    for exercise in content.exercises:
        for field in ("titles", "summaries", "steps", "right", "why"):
            assert set(getattr(exercise, field)) == LANGUAGES, (exercise.id, field)
        assert set(exercise.safety) in (set(), LANGUAGES), exercise.id
        assert exercise.sources, exercise.id
    for routine in content.routines:
        assert set(routine.titles) == set(routine.summaries) == LANGUAGES
    for skill in content.skills:
        assert set(skill.titles) == set(skill.descriptions) == LANGUAGES
    assert exercise_ref(content.exercises[0]).startswith("exercise:")
    assert routine_ref(content.routines[0]).startswith("routine:")


@pytest.mark.parametrize(
    ("path", "old", "new", "message"),
    [
        ("routines/quick.toml", '"count-in-band"', '"count-to-eleven"', "unknown exercise"),
        ("exercises/anchor-phrases.toml", "anchors-cs@1", "anchors-cs@9", "unknown passage"),
        (
            "exercises/anchor-phrases.toml",
            'cs = "passage:anchors-cs',
            'cs = "passage:anchors-en',
            "not in cs",
        ),
        ("exercises/light-hum.toml", "below = 5", "below = 5\nabove = 1", "exactly one"),
        (
            "exercises/light-hum.toml",
            '"subharmonic_share_pct"',
            '"glide_range_st"',
            "not measured on",
        ),
        ("exercises/light-hum.toml", '"hnr_db"', '"no_such_metric"', "unknown metric"),
        (
            "exercises/count-in-band.toml",
            'kind = "pitch_band"\nmin_share_pct = 50',
            'kind = "steps"\ncount = 3\nmax_drift_st = 1',
            "cannot judge phrase",
        ),
        (
            "exercises/count-in-band.toml",
            'intent = "attempt"',
            'intent = "habitual"',
            "drill or attempt",
        ),
        (
            "exercises/count-in-band.toml",
            'kind = "pitch_band"',
            'kind = "loudest"',
            "count-in-band.toml",
        ),
        ("exercises/note-match.toml", 'id = "note-match"', 'id = "light-hum"', "defined twice"),
        (
            "exercises/note-match.toml",
            'skill = "pitch-weight"',
            'skill = "breathing"',
            "note-match.toml",
        ),
        ("exercises/note-match.toml", "[[sources]]", "[[nope]]", "note-match.toml"),
    ],
)
def test_loader_refuses_broken_content(
    content_copy: Path, path: str, old: str, new: str, message: str
) -> None:
    file = content_copy / path
    text = file.read_text(encoding="utf-8")
    assert text.count(old) == 1, old
    file.write_text(text.replace(old, new), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        load_content(content_copy)


def test_an_exercise_needs_its_skill_described(content_copy: Path) -> None:
    skills = content_copy / "skills.toml"
    text = skills.read_text(encoding="utf-8")
    skills.write_text(text.replace('key = "size"', 'key = "warm-up"'), encoding="utf-8")
    with pytest.raises(ValueError, match="defined twice"):
        load_content(content_copy)
    head, _, _ = text.partition('[[skills]]\nkey = "size"')
    rest = text.split('[[skills]]\nkey = "clarity"', 1)[1]
    skills.write_text(head + '[[skills]]\nkey = "clarity"' + rest, encoding="utf-8")
    with pytest.raises(ValueError, match="skill size is not described"):
        load_content(content_copy)
