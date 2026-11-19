# Exercises, routines and how takes are judged

The practice part of puptrainer is data: exercises, routines and the texts
around them live in `content/`, the engine in the backend. This document is
for writing or changing that content.

## Where things are

| Path                           | What                                     |
| ------------------------------ | ---------------------------------------- |
| `content/skills.toml`          | The skills, in plain words, with aliases |
| `content/exercises/<id>.toml`  | One exercise each                        |
| `content/routines/<id>.toml`   | Guided sessions: exercises in order      |
| `content/passages/`            | Texts read aloud, the anchor phrases too |
| `content/measures/<lang>.toml` | Texts of the numbers a judgement shows   |

The API checks everything when it starts and refuses to start on a broken
file, naming it: an unknown exercise in a routine, an unknown passage, a
rule that cannot judge the exercise's kind of take, a hint that is not
measured on it, a missing English text.

## The curriculum spine

The order follows the current community model (Sumi's wiki, Selene's
guide): pitch and weight together first, size after, clarity as a gate on
every step rather than a unit of its own, and every session ending in
speech. The vocabulary is the perceptual one (weight, size, clarity); the
aliases in `skills.toml` map the other teachers' terms onto it.

## An exercise

```toml
id = "slide-down-hold"
version = 1                    # raise it when what is asked changes
skill = "pitch-weight"         # a key of skills.toml
item = "sustain"               # the kind of take a rep is
intent = "drill"               # drill (a sound) or attempt (speech in the voice)
seconds = 12                   # rough length of one rep
reps = 3                       # unless a routine says otherwise
live = "pitch"                 # while recording: "pitch" (tuner strip), "formants", "none"
demo = "slide-down"            # a tone that plays the pitch pattern: "slide-down", "glide"
hints = ["hnr_db"]             # registry metrics shown beside the result

[texts]                        # optional: a passage to read, per language
en = "passage:anchors-en@1"

[titles]                       # every text: en required, cs expected
en = "Slide down and hold"

[summaries]
en = "Start high and light, slide down into your band and hold it there."

[steps]                        # what to do, one action per step
en = ["…", "…"]

[right]                        # what it sounds and feels like when it goes right
en = "…"

[mistakes]                     # optional: common mistakes, each with what to do about it
en = ["…"]

[why]                          # what it is for, and what the app checks
en = "…"

[safety]                       # optional: when to stop or back off
en = "…"

[rule]                         # how a take is judged, see below
kind = "pitch_hold"
at = "band"
min_hold_s = 1.5

[[sources]]                    # at least one
author = "Scinguistics / CRAMD Voice Lessons"
title = "Course syllabus: slide down to speaking pitch"
url = "https://…"
```

**Kinds of take** decide what the pipeline measures: `sustain` for held
sounds (each held sound of 1.5 s or more is measured on its own), `phrase`
for short speech, `glide` for a slide through the range; `vowels`,
`passage` and `free` as in the lab.

**Intent.** `drill` marks a sound made for an exercise, not a voice: it
never draws a line on the Progress page. Speech in the voice being trained
(counting, phrases) is an `attempt`; Progress shows such attempts from
practice only when asked to.

**Versions.** Takes store `exercise:<id>@<version>`. Raise the version when
what the learner is asked to do changes; a fixed typo needs none. Takes are
always judged by the current rule.

**Write for someone with no teacher.** The reader cannot tell whether they
are doing it right, so every exercise says what it is for and what the app
checks (`why`), fixes the vowel where the numbers depend on it ("ah"), and
describes success in sensations (`right`). `live = "pitch"` shows the band,
the note to match and the learner's pitch while recording; `formants` shows
the live spectrogram for size work. Live guidance is on while skills are
new; fading it is the curriculum's job later (M4).

**Czech texts** address the reader without grammatical gender: imperatives
and the present tense, no past participles (`zkuste`, not `zkusil(a) jste`).

## Rules

A take is judged when it is served, from its stored measurements and the
band it was recorded against; nothing of the judgement is stored. A rep
rated strained (comfort 1) is never met, whatever the numbers; one rated
effortful (2) counts, with the advice to go lower or lighter. A miss says
which way to go (above or below the band or the note, or not held).
`pitch_band` with `above_ok = true` only minds the band's lower edge, for
sounds meant to be light and high. Sizes (`vtl_cm` as a hint, the first and
last sound of `steps`) are shown beside the learner's everyday voice on the
same microphone setup: the "a" of the lab's habitual vowels takes for held
sounds, the habitual passages and free speech for phrases.

| `kind`       | Takes         | Met when                                                                                                                           |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `none`       | any           | never judged; the exercise shows its hints only                                                                                    |
| `pitch_band` | speech, held  | the share of voiced time inside the band is at least `min_share_pct`                                                               |
| `pitch_hold` | `sustain`     | a steady stretch lasts `min_hold_s` inside the band (`at = "band"`) or within `tolerance_cents` of the played note (`at = "note"`) |
| `metric`     | as the metric | a registry metric is at most `below`, or at least `above`                                                                          |
| `steps`      | `sustain`     | `count` held sounds whose formant spacing rises step by step while their pitches stay within `max_drift_st`                        |

A **steady stretch** stays within `spread_cents` (default 50) either side of
its middle; dropouts under 50 ms do not end it. When a take has more held
sounds than `steps` asks for, the longest ones count.

Pass bars start low on purpose: most reps should be met. They are tuned
from logged comfort and results, not guessed upwards.

## Sources and wording

Every exercise names where it comes from. Instructions are paraphrased in
our own words, at most a short attributed quote; no third-party audio or
video is in the repository, only links. Where an exercise is adapted (a
held vowel instead of counting, so it can be measured), the source's title
says so. The language stays descriptive: bands and teachers' numbers are
conventions, never "male" or "female" targets.

## Routines

```toml
id = "quick"
version = 1
minutes = 2

[titles]
en = "Quick one"

[summaries]
en = "Two minutes, several times a day: slide into your band and count."

[[steps]]
exercise = "slide-down-hold"
reps = 2                       # optional, else the exercise's own

[[sources]]                    # optional: where the shape comes from
author = "…"
title = "…"
url = "https://…"
```

A session stores `routine:<id>@<version>`; the Practice page lists each
skill's exercises in the order the routines first use them.

## Adding a rule or a measure

A rule is a pydantic model in `puptrainer.core.schemas` (a member of the
`Rule` union) and a function in `puptrainer.core.evaluation`; the kinds of
take it can judge go into `RULE_ITEMS` in `puptrainer.core.content`. A new
number a rule reports goes into `MEASURES` in `puptrainer.core.evaluation`
with its texts in `content/measures/<lang>.toml`.
