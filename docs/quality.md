# Quality without watching

Three layers, cheapest first.

## 1. Before recording — `vibe`

Static analysis of the script with the same timing model the recorder uses:

| Rule | Level | Meaning |
|---|---|---|
| `blank` | error | a `<<blank>>` is left |
| `unzoom`, `parse` | error | can't run as written |
| `budget` | warn/info | estimated length far from `@budget` |
| `caption-long` | warn | > 90 characters — split it |
| `silent-open` | warn | first caption after 3 s |
| `unexplained` | warn | > 12 s on one caption (or none) |
| `dead-air` | warn | > 4 s with nothing moving |
| `zoom-long`, `zoom-dizzy` | warn | zoomed > 15 s, > 6 zooms/min |
| `fragile` | warn/info | CSS chains, raw coordinates, long text or deep `[n]` targets |
| `untested` | warn/info | actions without `expect` |
| `load-on-camera`, `abrupt-end`, `sections`, `zoom-empty`, `long-read` | info | polish |

Score = 100 − 15·errors − 5·warns − 1·infos. The strip under the score is the clip at one character per second:
`S` caption, `c` click, `t` type, `k` pick/key, `p` point, `z`/`u` zoom/unzoom, `d` drag, `~` scroll, `.` idle.

## 2. While recording — proofs and expectations

Every action carries **implicit proofs**:

| Proof | Fails when |
|---|---|
| found | the target isn't visible within `locateTimeout` (with fallbacks) |
| not covered | another element would receive the click at every probe point |
| on camera | the target is outside the zoomed frame (the camera follows and it's reported) |
| effect | a click caused no DOM change, navigation or request within 1.5 s |
| typed | the field doesn't contain what was typed |
| picked | the control doesn't show the chosen option |
| moved | after a drag the element neither moved nor landed in the destination |
| precise target | the match needed a fuzzy fallback (warn: tighten the target) |

Explicit `expect`s are the acceptance criteria. `@assert strict` stops the take at the first failure;
`warn` records it and continues. `manualify test` runs all of it without a video, in seconds — the same
script is an end-to-end test.

## 3. After rendering — `check`

From the take and the edit: failed steps, proof/assert failures, captions shorter than their reading time,
highlights off camera or cropped, camera moves under 0.3 s, length vs budget, blocked hosts, console errors.
From the video: frozen stretches (ffmpeg `freezedetect` on a 240-px proxy) that the timeline confirms were idle,
black frames. Plus **one contact sheet** (5×4 tiles) for a human or an LLM to glance at.
