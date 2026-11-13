# For AI agents

## If a user gave you this repo to use on THEIR project

1. In the user's project: `npm i -D github:geppthailand/manualify` (or clone this repo beside it and `npm i -D ../manualify`).
   Requires Node ≥ 20 and `ffmpeg`; run `npx playwright install chromium` if Chromium is missing.
2. `npx manualify init` → `manualify.config.mjs`, `mul/`, `.claude/skills/manualify/SKILL.md`.
3. Read `.claude/skills/manualify/SKILL.md` and follow it. Don't read the source unless something is broken.
4. Never point recordings at production or real customer data; keep `allow` minimal and stub external calls.

## If you are working ON manualify

- `npm test` (node:test, no browser) must pass. End-to-end: `cd examples/taskboard`, serve `proto` on 4873,
  `node ../../bin/manualify.mjs make demo.mul --force` → quality 100 expected.
- Layout: `src/mul` (parser, timing model, vibe — pure), `src/runtime` (locate, player, overlay, session),
  `src/record` (chunked recorder), `src/render` (EDL, captions, render, stills), `src/check`, `src/tools`
  (plan, fill, spec, serve, inspect), `bin/manualify.mjs` (CLI), `templates/`, `skill/SKILL.md`, `docs/`.
- The timing model (`src/mul/timing.mjs`) is shared by `vibe` and the player — change both behaviours together.
- Keep CLI output to a few lines per step: the users are often LLMs paying per token.
