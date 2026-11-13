import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/mul/parse.mjs';
import { vibe, formatVibe } from '../src/mul/vibe.mjs';

test('a decent script scores well and estimates duration', () => {
  const doc = parse(`@budget 30
cut
  go /board
  wait ready
== Board
say The board shows every task by stage
point column:"Doing" label="Work in progress" hold=1.5
say Drag a card to move it forward
drag card:"Write spec" to=column:"Done" => expect card:"Write spec" in column:"Done" visible
say Done cards count toward the weekly goal
zoom #weekly-goal pad=30
point #weekly-goal label="Weekly goal"
unzoom
`);
  const v = vibe(doc);
  assert.ok(v.score >= 85, formatVibe('x', v));
  assert.ok(v.seconds > 8 && v.seconds < 30, String(v.seconds));
  assert.equal(v.stats.cutSeconds > 0, true);
});

test('bad habits are flagged', () => {
  const doc = parse(`click css(div > .a .b .c)
wait 6
click xy(10,20)
click "<<button>>"
type #name "x"
unzoom`, { tolerant: true });
  const v = vibe(doc);
  const rules = new Set(v.findings.map((f) => f.rule));
  for (const r of ['fragile', 'dead-air', 'no-captions', 'untested', 'unzoom', 'blank']) assert.ok(rules.has(r), `missing ${r}\n${formatVibe('x', v)}`);
  assert.ok(v.score < 50);
});
