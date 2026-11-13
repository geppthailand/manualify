# Recording format

```
manualify-out/
  takes/<id>/<stamp>/
    chunks/0000.mp4 …     10 s H.264 chunks, keyframe every second (≈ 0.2–2 MB each at 2880×1620)
    chunks.csv            chunk index: file,start,end
    take.json             timeline events, steps, proof/assert results, blocked hosts, console errors
    fail.json, fail-N.jpg only when a step failed
  takes/<id>/latest.json  newest take
  videos/<id>.mp4         rendered clip (+ .edl.json, .check.json, .contact.jpg)
  stills/<id>/<name>.png  from `shot`
```

**Why chunks.** Frames go from Chrome's screencast straight into ffmpeg (fixed 30 fps against the wall clock,
the last frame repeated until a new one arrives), so there is no folder of images and no second packing pass.
A static screen costs almost nothing. Any moment is reachable by opening one chunk and decoding at most one
second — stills, frames and the renderer all seek this way.

**Clock.** Video time = seconds since recording started; every timeline event uses the same clock.

**Events** (`take.json` → `events`): `caption`, `chip`, `camera` (rect in CSS px + duration), `focus`
(the rect an action or highlight concerns), `cut` on/off, `cutspan` (failed retries, skipped optional steps),
`fast`, `shot`, `assert`, `proof`, `step`, `nav`, `mark`.

**Edit (render).** Cut spans are dropped, fast spans sped up, the camera eased between keyframes
(`zoompan`), captions/chips laid out by Chrome as PNGs and overlaid with fades, a short flash at each edit
point. One ffmpeg pass. `--preview` renders 960 px wide with a fast preset.

**Resume.** `record --from <line|mark>` replays the steps before the line without filming, records the rest,
and stores `resume: {of, fromLine, at}`; the renderer stitches the previous take up to the resume point with
the new one. Resumes chain.

**Captions placement.** A caption moves to the top band whenever a highlighted target (after camera
transform) would sit under the bottom band during the caption.
