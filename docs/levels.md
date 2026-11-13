# Levels: from "a skill and nothing else" to "fill the blanks"

The same job — a correct, watchable clip — can be done at five levels. Higher levels move work out of the
LLM's context and into code, which is where the time and token savings come from.

| Level | The LLM writes | The tools do | Where tokens go |
|---|---|---|---|
| **L0** skill only | Playwright + ffmpeg code per clip | nothing | exploring the DOM, debugging selectors, editing video code, watching frames |
| **L1** library + hooks | `.mul` + small JS hooks for odd flows | recording, edit, checks | the hooks |
| **L2** `.mul` | ~20–60 lines per clip | everything below the script | choosing targets, wording captions |
| **L3** fill-the-blanks | a storyboard; then one target per blank | skeletons (`plan`), candidates per blank (`fill`) | wording; a few hundred tokens per blank |
| **L4** demo-driven | brief + screens + demo script | prototype runtime, demo video, spec, acceptance test | the product idea itself |

What each level adds:

- **L1 → L2:** a language with camera, captions, cuts and assertions built in; resilient targets with
  fallbacks; implicit proofs per action; failure cards; resume from a line.
- **L2 → L3:** storyboards (cheap to review with a human), skeleton generation, `fill`, `make` that skips
  unchanged clips.
- **L3 → L4:** the video comes *before* the software. A prototype kit makes believable screens in minutes;
  the approved demo becomes the build spec and the acceptance test.

## Rough costs per clip (from the project this grew out of)

| | L0 (hand-written Playwright + frame folders) | L2/L3 |
|---|---|---|
| storage per minute | ~400 MB of JPEG frames | ~5 MB of mp4 chunks |
| fixing one bad step | re-record the clip | `record --from <line>` (seconds) |
| finding a target | screenshot + read DOM | `inspect` / `fill` (text) |
| reviewing | look at many frames | `check` (text) + one contact sheet |
| re-run after a copy change | edit selectors by hand | `#testid` / role targets don't break; `make` redoes only changed clips |
