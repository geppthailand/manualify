# manualify

**Short scripts in, checked videos out.** Write what a viewer should see in `.mul` — a one-verb-per-line
language for clicks, captions, zooms and assertions — and manualify records the real app in Chromium,
edits the video, and tells you what's wrong with it without anyone watching.

```
== Add a task
say Add work in seconds: a **title**, who owns it and when it's due
click button:"+ New task" => expect dialog:"New task" visible
type #task-title "Prepare Q4 demo"
pick #task-who "Ava"
click button:"Create task" => expect "Prepare Q4 demo" visible
zoom #weekly-goal pad=60
point #weekly-goal label="9 of 12 this week"
unzoom
```

```
$ npx manualify make demo.mul
── taskboard-weekly  (vibe 100, ≈27.7s)
▶ manualify-out/videos/taskboard-weekly.mp4  30.4 s  (3 spans, 0 cuts, 6 captions, rendered in 5.6 s)
taskboard-weekly.mp4  quality 100/100  30.4 s  12 proofs ok · 5 expects ok · 0 failed · 0 warnings
```

It is built for **LLM agents** (Claude Code and friends) as much as for people: every step answers in a few
lines of text, so an agent can plan, record and fix videos without spending tokens on screenshots.

## Use it from Claude Code

Paste this repo's URL into Claude Code with what you want ("make a 45-second demo of our checkout"). The agent
installs it, runs `npx manualify init` (which drops a one-page skill into `.claude/skills/manualify/`) and
follows that skill. Details: [docs/claude-code.md](docs/claude-code.md).

## Quick start (by hand)

Needs Node ≥ 20 and `ffmpeg` on the PATH.

```sh
npm i -D github:geppthailand/manualify
npx playwright install chromium          # if you don't have it yet
npx manualify init                       # config + mul/example.mul + Claude Code skill
# set baseURL (and login, if any) in manualify.config.mjs, start your app, then:
npx manualify inspect /                  # targets on the page, as text
npx manualify vibe mul/example.mul       # judge the script before recording
npx manualify test mul/example.mul       # run it as a test, no video
npx manualify make mul/example.mul       # record → render → check
```

Try the bundled example (no app needed):

```sh
cd examples/taskboard
npx manualify serve proto --port 4873 &
npx manualify make demo.mul
```

## Levels

Use the cheapest level that does the job ([docs/levels.md](docs/levels.md)):

| | You write | Tools do |
|---|---|---|
| **L0** skill only | Playwright + ffmpeg by hand | nothing (the skill describes the method) |
| **L1** hooks | `.mul` + JS hooks for odd flows | everything else |
| **L2** `.mul` | scripts | record, edit, check |
| **L3** fill-the-blanks | a storyboard, then one target per blank | skeletons (`plan`), candidates (`fill`), batch `make` |
| **L4** demo-driven | brief + prototype screens + demo script | prototype runtime, demo video, build spec, acceptance test |

## What makes it fast and cheap

- **Chunked recording.** Chrome's screencast goes straight into 10-second H.264 chunks (keyframe every second).
  No frame folders: ~5 MB per recorded minute at 2880×1620, and any moment is one short seek away.
- **One-pass edit.** Cuts, speed-ups, eased zooms, captions (laid out by Chrome — any script, Thai included) and
  chapter chips in a single ffmpeg run. Captions dodge highlighted targets automatically.
- **Vibe check before recording.** Estimated length, reading time, dead air, zoom pacing, fragile targets,
  missing assertions — from the script alone.
- **Test-driven recording.** Every action proves itself (found, not covered, on camera, had an effect, value
  typed, element moved); `expect` lines are acceptance criteria. `manualify test` runs the same script as an
  end-to-end test in seconds.
- **Resilient targets.** `#testid`, `role:"name"`, text with exact → substring → fuzzy fallbacks (case, spacing,
  accents and Thai tone marks ignored); the take tells you when a fallback was needed.
- **Fast recovery.** A failing step stops with a failure card (look-alike targets + screenshot);
  `record --from <line>` re-records only the rest and stitches it on.
- **Review without watching.** `check` reports in text; one contact sheet when eyes are needed.
- **Safe by default.** Only the app's host is reachable while recording; stub the rest with `routes`.

## Commands

```
init [--skill-only]        new <name>          plan <storyboard.md>     inspect <path> [--near TEXT]
fill <file.mul>            vibe <file.mul…>    test <file.mul> [--base URL]
record <file.mul> [--from LINE|MARK]           render <id|file> [--preview]       check <id|file>
make <file.mul…> [--force] stills <id|file>    frame <id|file> <seconds> [--raw]  join <out.mp4> <id…>
demo new <name>            demo make <dir>     spec <dir>               serve <dir> [--port N]
```

## Docs

[.mul language](docs/mul-language.md) · [config](docs/config.md) · [quality checks](docs/quality.md) ·
[recording format](docs/recording.md) · [demo-driven development](docs/demo-driven-development.md) ·
[levels](docs/levels.md) · [Claude Code](docs/claude-code.md) · [the skill](skill/SKILL.md)

## Limits

Chromium only. No voice-over or audio yet. The zoom uses ffmpeg `zoompan`, which positions the crop on whole
source pixels (recording at `scale: 1.5` keeps any wobble under one output pixel). Native `<select>` popups are
drawn by the OS and don't appear in recordings — the value change does.

## License

MIT
