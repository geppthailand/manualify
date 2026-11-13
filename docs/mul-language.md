# The .mul language

One verb per line. Indentation opens a block. `=>` adds expectations. `#` starts a comment line (or a
trailing comment after two spaces). Blanks to fill are written `<<like this>>`.

```
verb[?][@mod…] positional… key=value… [=> expectation (; expectation)*]
```

## Headers

| Header | Meaning |
|---|---|
| `@id` | clip id (output file names); defaults to the file name |
| `@title`, `@subtitle` | title card text (when `config.cards` is set) and reports |
| `@user` | name handed to `config.login(page, config.users[name])` |
| `@state` | name handed to `config.state.restore(name)` before the browser starts |
| `@start` | path opened before `setup` runs (not filmed) |
| `@budget` | target length in seconds — `vibe`/`check` warn when far off |
| `@assert` | `warn` (default) · `strict` (a failed expect stops the take) · `off` |

## Verbs

| Verb | Example | Notes |
|---|---|---|
| `say` | `say Click **Save** to keep it` | caption; stays until read (see *Timing*). `say@top` forces the top band; `say@wait` blocks until read |
| `hush` | `hush` | remove the caption |
| `== title` | `== Billing` | section: chapter chip + clears highlights |
| `chip` | `chip Step 2` | chip without a section |
| `go` | `go /settings` | navigate (relative to `baseURL`); usually inside `cut` |
| `wait` | `wait 1.5` · `wait ready` · `wait "Saved"` · `wait gone dialog:"Edit"` | |
| `click` | `click button:"Save" label="Save" badge=A` | `@double`, `@right`, `hold=`, `keep`, `effect=none` |
| `hover` | `hover #avatar` | |
| `point` | `point #total label="Total" badge=B hold=2` | highlight + cursor rest; `spot` dims the rest |
| `spot` | `spot #chart` | spotlight a region |
| `unpoint` | `unpoint` | clear highlights |
| `type` | `type label:"Email" "ana@example.com"` | `clear=false` appends |
| `pick` | `pick combobox:"Country" "Japan"` | native `<select>` or custom dropdowns (types to filter, scrolls virtual lists) |
| `key` | `key Enter` · `key ControlOrMeta+K` | |
| `drag` | `drag card:"Task 4" to=#col-done` · `drag #slider by=(120,0)` | proof: the element really moved |
| `scroll` | `scroll #footer` · `scroll 600` | smooth, filmed |
| `zoom` | `zoom #kpis + #chart pad=40` | camera to the union of targets; `scale=`, `speed=slow|fast`, `snap` |
| `pan` | `pan #next-card` | move the camera, keep the zoom level |
| `unzoom` | `unzoom` | back to the full screen |
| `shot` | `shot step_3 clip=#form` | still for docs (`manualify stills`) |
| `expect` | `expect! row:"Acme" count=1` | stand-alone expectation |
| `mark` | `mark after-login` | named resume point (`--from after-login`) |
| `use` | `use login admin` | inline `mul/macros/login.mul` with `$1 = admin` |
| `run` | `run seedOrders 20` | call `config.hooks.seedOrders(page, ctx, '20')` |
| `note` | `note why this clip exists` | ignored at runtime |

Suffix `?` makes a step optional (`click? button:"Accept cookies"`): if the target is absent within 1.5 s it is
skipped and the attempt is cut from the video.

## Blocks

| Block | Effect |
|---|---|
| `setup` | runs before recording starts (top level only) |
| `cut` | filmed, removed in the edit; actions run fast |
| `fast 3` | sped up ×3 in the edit |
| `retry 2` | re-run the block if a step fails; failed attempts are cut |
| `quiet` | no highlight boxes inside |

## Targets

| Form | Matches | Fallbacks |
|---|---|---|
| `#save` | `data-testid`, `data-test`, `data-tour`, `data-cy`, `id`, `name` | in that order |
| `button:"Save"` | ARIA role + accessible name (any role) | exact → substring → fuzzy |
| `label:"Email"` `placeholder:"…"` `alt:"…"` `title:"…"` `testid:"…"` | Playwright getBy* helpers | |
| `"Save"` | visible text, exact | → substring → fuzzy |
| `~"บันทึก"` | fuzzy text: case, spacing, punctuation, accents and Thai tone marks ignored | |
| `/Sav(e|ing)/i` | regex text | |
| `box:"Revenue"` (also `card:`/`panel:`/`section:`) | the nearest framed container around the text | |
| `name:"…"` | your macro from `config.macros` | |
| `css(.ant-picker)` | CSS selector (fragile — `vibe` warns) | |
| `xy(640,360)` | a viewport point (fragile) | |
| `t:billing.save` | text from `config.i18n` | |

Modifiers: `[2]`, `[last]`; scope `button:"Delete" in row:"Acme"`; union `#a + #b` (zoom, clip).
When a fallback was needed the take reports it ("matched only via text~fuzzy — tighten the target").

## Expectations

```
=> expect dialog:"Edit" visible
=> expect row:"Acme" count=1; expect url ~ /customers/
=> expect "Saved" visible; expect #save disabled
=> expect download
```
Predicates: `visible` (default) `hidden` `gone` `present` `enabled` `disabled` `checked` `unchecked` `focused`
`editable` `inview` (inside the camera frame) · `count=N` `count>=N` · `text~"part"` `text="all"` · `value="x"`.
Page checks: `url ~ /re/` or `url ~ part`, `title ~ "x"`, `download`, `no-errors`.
Prefix `!` → strict, `?` → warn only. Expectations poll for up to 4 s.

## Timing (shared by `vibe` and the recorder)

- A caption stays until it has been readable for `max(1.6 s, characters / readingSpeed)` — the **next** `say`
  waits only for what's left, so actions happen while it's being read.
- Cursor moves: 0.35 / 0.6 / 0.95 s (fast / normal / slow). Click = move + 0.3 s settle + 0.6 s hold.
- `point` holds 1.2 s, zoom moves take 0.5 / 0.8 / 1.2 s. Everything accepts `hold=`.
