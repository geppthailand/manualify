import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, tokenize, parseTargetToken, showTarget } from '../src/mul/parse.mjs';

const SRC = `# demo
@title  Overview report
@user   owner
@budget 60

setup
  click? button:"Accept all"

== Overview
say The **Reports** menu sums everything up
point css(.picker)[1] label="Pick dates" badge=A hold=1.4
zoom card:"Recycling rate" + card:"Per person" pad=50
click button:"Export" label="Export PDF" => expect dialog:"Export" visible; expect url ~ /reports
type textbox:"Name" "Ana Lima"
pick combobox:~"period" "Monthly"
drag card:"Task 3" to=column:"Done"   # move it
drag #task-4 by=(0,-120)
say@top caption on top  hold=2
expect! row:"Bangkok" count>=1
cut
  wait ready
fast 3
  click? "Next"[last]
wait 1.5
shot kpi clip=(card:"A" + card:"B")
unzoom
`;

test('parses headers, blocks and statements', () => {
  const doc = parse(SRC);
  assert.equal(doc.meta.title, 'Overview report');
  assert.equal(doc.meta.budget, 60);
  assert.equal(doc.setup.length, 1);
  assert.equal(doc.setup[0].optional, true);
  const verbs = doc.steps.map((s) => s.verb);
  assert.deepEqual(verbs, ['section', 'say', 'point', 'zoom', 'click', 'type', 'pick', 'drag', 'drag', 'say', 'expect', 'cut', 'fast', 'wait', 'shot', 'unzoom']);
  const [, say, point, zoom, click, type, pick, drag1, drag2, sayTop, exp, cut, fast, wait, shot] = doc.steps;
  assert.equal(say.text, 'The **Reports** menu sums everything up');
  assert.equal(point.target.kind, 'css'); assert.equal(point.target.nth, 1);
  assert.equal(point.opts.label, 'Pick dates'); assert.equal(point.opts.hold, 1.4);
  assert.equal(zoom.targets.length, 2); assert.equal(zoom.opts.pad, 50);
  assert.equal(click.expects.length, 2); assert.equal(click.expects[1].page, 'url');
  assert.equal(type.value, 'Ana Lima');
  assert.equal(pick.target.fuzzy, true);
  assert.equal(drag1.opts.to[0].name, 'column');
  assert.deepEqual(drag2.opts.by, { dx: 0, dy: -120 });
  assert.deepEqual(sayTop.mods, ['top']); assert.equal(sayTop.opts.hold, 2); assert.equal(sayTop.text, 'caption on top');
  assert.equal(exp.expects[0].level, 'strict'); assert.deepEqual(exp.expects[0].preds[0], { name: 'count', op: '>=', value: 1 });
  assert.equal(cut.children.length, 1); assert.equal(fast.factor, 3); assert.equal(fast.children[0].target.nth, -1);
  assert.equal(wait.seconds, 1.5);
  assert.equal(shot.opts.clip.length, 2);
});

test('targets round-trip through showTarget', () => {
  for (const s of ['"Save"', '~"บันทึก"', '#save', 'button:"Save"', 'css(.a .b)', 'xy(10,20)', 't:reports.export', '/Sav(e)/i', 'row:"x"[last]'])
    assert.equal(showTarget(parseTargetToken(s, 1)), s);
});

test('tolerant mode collects errors with hints', () => {
  const doc = parse('click\nfrobnicate x\nsay ok', { tolerant: true });
  assert.equal(doc.errors.length, 2);
  assert.match(doc.errors[0].message, /line 1/);
  assert.equal(doc.steps.length, 1);
});

test('tokenizer keeps quotes and groups', () => {
  assert.deepEqual(tokenize('a "b c" css(.x y) d[2]', 1).map((t) => t.v), ['a', '"b c"', 'css(.x y)', 'd[2]']);
});
