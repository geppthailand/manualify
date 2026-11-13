# Demo-driven development

Build the **video of the product** before the product. Customers react to what they see; a one-minute demo of
believable screens answers "is this what you meant?" faster than a spec or a half-built feature.

```
brief.md ──► proto/ (screens + fake data) ──► demo.mul ──► demo video ──► customer: yes / change
                                                                     │
                                       spec.md ◄── manualify spec ◄──┘ (approved)
                                          │
                              real app ──► manualify test demo.mul --base <real app>   (acceptance)
```

## Why it's fast

- **Visual first.** The prototype kit (`kit.css` + `app.js`) gives an app shell, cards, KPIs, bar charts,
  tables, tabs, modals, toasts and pointer drag-and-drop. A screen is a function returning HTML; behaviour is a
  handful of `ACTIONS` that mutate in-memory state. No backend, no validation, no edge cases.
- **Only the moments.** The brief allows at most three moments the demo must land; the script is built around
  them, so nothing else needs to exist.
- **Checked automatically.** `demo make` serves the prototype, records, renders and checks; a missing button
  or a broken flow fails the take instead of reaching the customer.

## Why it carries into the real build

- Every element the demo touches has a `data-testid`; `spec` lists them with the story and the acceptance
  criteria (the `expect` lines).
- The same `demo.mul`, pointed at the real app with `--base`, is the acceptance test. When it passes, the
  real app does what the customer approved.
- Re-recording the demo against the real app gives release notes / onboarding video for free.

## Steps

1. `npx manualify demo new <name>`
2. Write `brief.md`: who, problem, ≤ 3 moments, out of scope, open questions.
3. Sketch `proto/screens.js` + `proto/data.js` (look at `examples/taskboard`).
4. Write `demo.mul` around the moments; `npx manualify vibe demos/<name>/demo.mul`.
5. `npx manualify demo make demos/<name>` → `demos/<name>/manualify-out/videos/<id>.mp4`.
6. Iterate with the customer. Each loop is minutes.
7. `npx manualify spec demos/<name>` → `spec.md`; build; `npx manualify test demos/<name>/demo.mul --base …`.
