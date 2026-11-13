---
name: manualify
description: Record demo, tutorial and user-manual videos of a web app from short .mul scripts, check them without watching, and run demo-driven development (clickable prototype → demo video the customer approves → build spec → real app tested by the same script). Use when asked for a demo video, screen recording, walkthrough, product tour, tutorial or manual clip, or a quick prototype demo for a customer.
---

# manualify

Scripts in, checked videos out. Pick the cheapest level that does the job, then follow its loop.
Full reference: `node_modules/manualify/docs/` (mul-language.md, config.md, quality.md, demo-driven-development.md).

## 1. Pick a level

| Level | You write | Use when | Cost |
|---|---|---|---|
| **L4 demo-driven** | brief + prototype screens + `demo.mul` | the app doesn't exist yet; the customer must say "yes, that" | low per idea |
| **L3 fill-the-blanks** | a storyboard (markdown) → `plan` → fill `<<blanks>>` | many clips of an existing app (a manual, onboarding) | lowest per clip |
| **L2 .mul** | `.mul` scripts directly | a few clips, you know the app | low |
| **L1 hooks** | `.mul` + `run <hook>` in config | odd flows: seed data, fake a camera, two users, iframes | medium |
| **L0 by hand** | Playwright + ffmpeg yourself (section 8) | the package can't be installed | high — avoid |

## 2. Setup (once per project)

```sh
npm i -D github:geppthailand/manualify        # or a local path / npm name if published
npx manualify init                       # manualify.config.mjs, mul/example.mul, this skill
```
Edit `manualify.config.mjs`: `baseURL`, and `login()` if the app needs one. Start the app.

## 3. The loop (each step is cheap; never skip ahead)

```sh
npx manualify inspect /some/page              # what's on screen, as ready-to-paste targets (text, no screenshot)
npx manualify vibe mul/x.mul                  # score + estimated length + findings, BEFORE recording
npx manualify test mul/x.mul                  # run every action + assertion, no video (seconds)
npx manualify make mul/x.mul                  # record → render → check; skips scripts that didn't change
```
`make` prints a quality score and findings. Only open the contact sheet (`…contact.jpg`, one image) when the
score is < 90 or a finding needs eyes; for one moment use `npx manualify frame mul/x.mul 12.5`.

**When a step fails** you get a failure card: the line, what was looked for, look-alike targets on screen and a
screenshot path. Fix that line, then continue from it instead of re-recording:
`npx manualify record mul/x.mul --from <line>` → `npx manualify render mul/x.mul` → `npx manualify check mul/x.mul`.

**L3:** `npx manualify plan storyboard.md` writes skeletons; `npx manualify fill mul/x.mul` runs to the first
`<<blank>>` and lists candidates for it — paste one, repeat until `vibe` has no `blank` errors.

## 4. .mul in one screen

```
@id      create-invoice          # file name if omitted
@title   Create an invoice       # title card + reports
@user    admin                   # login(page, users.admin) before the script
@state   fresh-demo              # config.state.restore('fresh-demo') before the browser opens
@budget  45                      # target seconds (vibe/check warn when far off)
@assert  warn                    # strict = a failed expect stops the take; off = no checks

cut                              # filmed, then edited out (page loads, setup clicks)
  go /invoices
  wait ready
== Create it                     # section → chapter chip
say Click **New invoice** to start          # caption; stays until read (reading time is automatic)
click button:"New invoice" => expect dialog:"New invoice" visible
type label:"Customer" "Northwind Traders"
pick combobox:"Currency" "EUR"
drag #line-2 to=#line-1          # or by=(0,-80)
zoom #totals pad=40              # camera; `unzoom` to go back (zoom only to make small things readable)
point #totals label="Total incl. VAT" badge=A hold=1.5
click button:"Save" => expect "Invoice saved" visible; expect url ~ /invoices/
shot invoice_saved clip=#totals  # still for docs (`npx manualify stills`)
fast 3                           # speed up a boring stretch
  click button:"Send reminder"
retry 2                          # retry a flaky block; failed tries are cut out
  click? button:"Dismiss"        # `?` = optional: skipped (and cut) if absent
run seedOrders 20                # config.hooks.seedOrders(page, ctx, '20')
use open-settings "Billing"      # mul/macros/open-settings.mul with $1 = Billing
```

**Targets** (best first): `#testid` · `role:"Name"` (button, link, tab, textbox, combobox, checkbox, dialog,
row, heading, menuitem, option…) · `label:"…"` `placeholder:"…"` · `"exact text"` · `~"fuzzy text"` (ignores case,
spacing, accents, Thai tone marks) · project macros `card:"Revenue"` · `css(.sel)` · `xy(640,360)`.
Modifiers: `[2]` `[last]`, scoping `A in B`, union for zoom/clip `A + B`.
**Verb options:** `label= badge= hold= side= keep spot` · `speed=slow|fast` or `@slow @fast` · `say@top` ·
`click@double @right` · `pad= scale=` for zoom.
**Expect:** `=> expect T visible|hidden|enabled|disabled|checked|focused|inview|count>=N|text~"x"|value="x"`,
`url ~ /path`, `title ~ "x"`, `download`, `no-errors`; prefix `!` = strict, `?` = warn-only.

## 5. Rules that keep it cheap

1. Never screenshot to find a target — `inspect --near "words"` or `fill` gives paste-ready targets.
2. `vibe` and `test` before `record`. A take costs real time; a vibe costs nothing.
3. Read the failure card, not the logs. Resume with `--from`, never re-record a whole clip for one bad line.
4. Trust `check` + proofs. Look at pixels only for findings that need eyes, one contact sheet at a time.
5. Batch with `make` — unchanged scripts are skipped.
6. Prefer `#testid` targets; if the app lacks them, `role:"name"`; text last. Add `data-testid` to the app when
   you can — scripts then survive copy changes.

## 6. Make the clip good (what reviewers flag)

- One idea per clip (30–90 s), one point per `== section`. Open with what the clip shows within 3 s.
- Captions say **why**, the screen shows **what**. ≤ 90 characters; split longer ones. Bold the UI words.
- Put loads, logins and setup in `cut`. Hold on results (`hold=`), end on the outcome, not on a click.
- Every action that changes data gets an `expect` — a take where the save silently failed must fail.
- Zoom only when text would be too small; unzoom within ~15 s; ≤ 6 zooms a minute.
- Fictional but believable data (names, numbers, units the viewer recognises). Never real customer data.
- External calls (email, payments, AI) are blocked while recording — stub them with `config.routes`.

## 7. Demo-driven development (L4)

1. `npx manualify demo new <name>` → `demos/<name>/{brief.md, proto/, demo.mul}`.
2. Fill `brief.md` (who, problem, ≤ 3 moments). Sketch screens in `proto/screens.js` with the kit
   (`h.kpi`, `h.bars`, `h.badge`, tables, modals, toasts, `data-drag`/`data-drop`); fake data in `proto/data.js`.
   Give every touched element a `data-testid`. Visual first: fake behaviour with `ACTIONS`, skip edge cases.
3. Script `demo.mul` around the moments, `npx manualify demo make demos/<name>` → video + quality report.
4. Show the customer the video. Change screens/script, re-make (minutes, not days) until they say yes.
5. `npx manualify spec demos/<name>` → `spec.md`: story, elements (+ suggested test ids), acceptance criteria.
6. Build the real app from the spec. Acceptance = `npx manualify test demos/<name>/demo.mul --base <real url>`.

## 8. L0 — no package (fallback method)

1. Playwright Chromium, viewport 1920×1080, deviceScaleFactor 1.5 (so zooms stay sharp).
2. Record with CDP `Page.startScreencast` (JPEG) piped to ffmpeg at a fixed 30 fps (repeat the last frame), H.264
   in 10 s segments with a keyframe every second — never a folder of JPEGs.
3. Draw a fake cursor, click ripple and highlight boxes in the page (fixed overlay, pointer-events: none).
4. Log every caption, camera move, cut and highlight rect with a timestamp.
5. Edit from the log: drop cut spans, zoom with `zoompan`, captions as Chrome-rendered PNGs overlaid with fades;
   move a caption to the top when a highlight sits under it.
6. After each action verify it happened (element visible and not covered, DOM changed, value typed, element moved).
7. Review with ffmpeg `freezedetect` and one tiled contact sheet, not by watching.
