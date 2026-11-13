# Using manualify from Claude Code

Paste the repository link into Claude Code and ask for what you want, e.g.

> Use https://github.com/geppthailand/manualify to make a 45-second demo of our checkout flow.

The agent should:

1. `npm i -D github:geppthailand/manualify` (or `git clone` it next to the project and `npm i -D ../manualify`).
2. `npx manualify init` — creates `manualify.config.mjs`, `mul/`, and `.claude/skills/manualify/SKILL.md`.
3. Read `.claude/skills/manualify/SKILL.md` (one page) and follow its loop:
   `inspect` → write `.mul` → `vibe` → `test` → `make` → read `check` → fix with `record --from`.
4. Report the video path, the quality score and any findings it couldn't fix.

To install only the skill (no package): `npx manualify init --skill-only`, or copy `skill/SKILL.md` into
`.claude/skills/manualify/`. The skill's section 8 describes the method without the package (level L0).
