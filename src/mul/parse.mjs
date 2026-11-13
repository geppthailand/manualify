/**
 * .mul parser — one verb per line, indentation for blocks, `=>` for expectations.
 *
 *   @title  Overview report          header (key value)
 *   == Overview                      section → chip on screen
 *   say  The **Reports** menu …      caption (rest of line)
 *   click button:"Export" label="Export PDF" => expect dialog:"Export" visible
 *   cut                              block: filmed but edited out
 *     wait ready
 *
 * Grammar per statement:  verb[?][@mod…] positional… key=value… [=> expectation (; expectation)*]
 * See docs/mul-language.md for every verb and target form.
 */

export class MulError extends Error {
  constructor(msg, line, hint) {
    super(`line ${line}: ${msg}${hint ? `\n  hint: ${hint}` : ''}`);
    this.line = line;
    this.hint = hint;
  }
}

/** Verbs whose argument is free text (rest of the line) unless it starts with a quote. */
const TEXT_VERBS = new Set(['say', 'chip', 'note', 'go']);
/** Verbs that open an indented block. */
const BLOCK_VERBS = new Set(['setup', 'cut', 'fast', 'quiet', 'retry']);
export const VERBS = new Set([
  'say', 'hush', 'chip', 'note', 'go', 'wait', 'click', 'hover', 'point', 'type', 'pick', 'key', 'drag',
  'scroll', 'zoom', 'unzoom', 'pan', 'shot', 'expect', 'use', 'run', 'mark', 'unpoint', 'spot',
  ...BLOCK_VERBS,
]);
/** Option keys whose value is a target expression, not a scalar. */
const TARGET_OPTS = new Set(['to', 'clip', 'in', 'within']);

// ---------------------------------------------------------------- tokens

/**
 * Split a statement into tokens. Quoted strings, (...) groups and [..] suffixes stay whole.
 * Returns [{v, q}] where q = true for a quoted string (v = unescaped content).
 */
export function tokenize(src, line) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (src.startsWith('<<', i) && src.indexOf('>>', i) > i) {
      // a <<blank to fill>> is one token even with spaces inside
      const j = src.indexOf('>>', i) + 2;
      out.push({ v: src.slice(i, j), q: false });
      i = j;
      continue;
    }
    let j = i;
    let buf = '';
    let quoted = false;
    while (j < src.length && src[j] !== ' ' && src[j] !== '\t') {
      const ch = src[j];
      if (ch === '"') {
        quoted = buf === '' || /[:~=]$/.test(buf);
        const start = j++;
        let s = '';
        while (j < src.length && src[j] !== '"') {
          if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++];
        }
        if (src[j] !== '"') throw new MulError(`unclosed quote at column ${start + 1}`, line);
        j++;
        buf += JSON.stringify(s);
        continue;
      }
      if (ch === '(' || ch === '[') {
        const close = ch === '(' ? ')' : ']';
        let depth = 0;
        const start = j;
        for (; j < src.length; j++) {
          if (src[j] === '"') { j = src.indexOf('"', j + 1); if (j < 0) break; continue; }
          if (src[j] === ch) depth++;
          else if (src[j] === close && --depth === 0) { j++; break; }
        }
        if (depth !== 0) throw new MulError(`unclosed ${ch} at column ${start + 1}`, line);
        buf += src.slice(start, j);
        continue;
      }
      buf += ch;
      j++;
    }
    out.push({ v: buf, q: quoted && /^"/.test(buf) && /"$/.test(buf) && buf.length >= 2 });
    i = j;
  }
  return out;
}

const unq = (s) => (s.startsWith('"') ? JSON.parse(s) : s);

// ---------------------------------------------------------------- targets

/**
 * Parse one target token (with optional [n] suffix):
 *   "Save"            exact text           ~"บันทึก"   fuzzy text (case/space/Thai-tone-mark insensitive)
 *   /Sav(e|ing)/i     regex text           #save        data-testid / data-tour / id
 *   button:"Save"     role or adapter macro (card:"KPI", tab:"Settings", row:"Bangkok" …)
 *   css(.ant-picker)  CSS selector         xy(640,360)  a viewport point
 *   t:reports.export  i18n key resolved through the adapter's locale table
 *   …[2] / …[last]    nth match (1-based)
 */
export function parseTargetToken(tok, line) {
  let s = tok;
  let nth;
  const m = s.match(/\[(\d+|last|first)\]$/);
  if (m) { nth = m[1] === 'last' ? -1 : m[1] === 'first' ? 1 : +m[1]; s = s.slice(0, -m[0].length); }
  let t;
  if (/^~"/.test(s)) t = { kind: 'text', value: unq(s.slice(1)), fuzzy: true };
  else if (/^"/.test(s)) t = { kind: 'text', value: unq(s) };
  else if (/^\/.*\/[a-z]*$/.test(s)) { const k = s.lastIndexOf('/'); t = { kind: 'regex', value: s.slice(1, k), flags: s.slice(k + 1) }; }
  else if (/^#[\w.-]+$/.test(s)) t = { kind: 'id', value: s.slice(1) };
  else if (/^css\(.*\)$/.test(s)) t = { kind: 'css', value: s.slice(4, -1) };
  else if (/^xy\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(s)) { const [x, y] = s.slice(3, -1).split(',').map(Number); t = { kind: 'point', x, y }; }
  else if (/^t:[\w.-]+$/.test(s)) t = { kind: 'i18n', value: s.slice(2) };
  else if (/^\$\w+$/.test(s)) t = { kind: 'var', value: s.slice(1) };
  else if (/^[a-z][\w-]*:~?"/.test(s)) {
    const k = s.indexOf(':');
    const rest = s.slice(k + 1);
    t = { kind: 'macro', name: s.slice(0, k), value: unq(rest.replace(/^~/, '')), fuzzy: rest.startsWith('~') };
  } else if (/^[a-z][\w-]*$/.test(s)) t = { kind: 'macro', name: s, value: null };
  else if (/^<<.*>>$/.test(s)) t = { kind: 'blank', value: s };
  else throw new MulError(`can't read target ${JSON.stringify(tok)}`, line,
    'targets: "text"  ~"fuzzy"  #testid  button:"Name"  css(.sel)  xy(x,y)  t:i18n.key  …[2]');
  if (nth !== undefined) t.nth = nth;
  return t;
}

/** Target expression: a [in b] [+ c [in d] …] — union for zoom/clip, `in` for scoping. */
export function parseTargetExpr(tokens, line) {
  const parts = [];
  let cur = null;
  for (let i = 0; i < tokens.length; i++) {
    const v = tokens[i].v;
    if (v === '+') { if (!cur) throw new MulError('`+` needs a target on its left', line); parts.push(cur); cur = null; continue; }
    if (v === 'in') {
      if (!cur || i + 1 >= tokens.length) throw new MulError('`in` needs targets on both sides', line, 'button:"Save" in dialog:"Edit"');
      cur = { ...cur, within: parseTargetToken(tokens[++i].v, line) };
      continue;
    }
    if (cur) throw new MulError(`unexpected ${JSON.stringify(v)} after a target`, line, 'join targets with + (union) or in (scope)');
    if (v.startsWith('(') && v.endsWith(')')) {
      const inner = parseTargetExpr(tokenize(v.slice(1, -1), line), line);
      cur = inner.length === 1 ? inner[0] : { kind: 'union', parts: inner };
    } else cur = parseTargetToken(v, line);
  }
  if (cur) parts.push(cur);
  return parts;
}

// ---------------------------------------------------------------- expectations

const PRED = /^(visible|hidden|enabled|disabled|checked|unchecked|focused|inview|moved|changed|gone|present|editable)$/;

/** `<target> visible`, `<target> count>=3`, `<target> text~"x"`, `url ~ /reports`, `download`, `title ~ "x"`. */
export function parseExpectation(src, line) {
  const level = src.startsWith('!') ? 'strict' : src.startsWith('?') ? 'warn' : null;
  if (level) src = src.slice(1).trim();
  const toks = tokenize(src, line);
  if (!toks.length) throw new MulError('empty expectation', line);
  const head = toks[0].v;
  if (head === 'url' || head === 'title') {
    const op = toks[1]?.v;
    const val = toks.slice(2).map((t) => t.v).join(' ');
    if (!op || !val) throw new MulError(`expect ${head} needs an operator and a value`, line, `expect ${head} ~ /reports`);
    return { level, page: head, op, value: unq(val) };
  }
  if (head === 'download' || head === 'nothing-broken' || head === 'no-errors') return { level, page: head };
  const preds = [];
  const targetToks = [];
  for (const t of toks) {
    const m = t.v.match(/^(count|text|value|attr)(>=|<=|=|~|>|<)(.+)$/);
    if (m) preds.push({ name: m[1], op: m[2], value: m[1] === 'count' ? +m[3] : unq(m[3]) });
    else if (PRED.test(t.v) && targetToks.length) preds.push({ name: t.v });
    else targetToks.push(t);
  }
  if (!preds.length) preds.push({ name: 'visible' });
  const target = parseTargetExpr(targetToks, line);
  if (target.length !== 1) throw new MulError('an expectation checks one target', line);
  return { level, target: target[0], preds };
}

// ---------------------------------------------------------------- statements

function parseStatement(raw, line) {
  let src = raw;
  let expects = [];
  const arrow = findArrow(src);
  if (arrow >= 0) {
    expects = src.slice(arrow + 2).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((e) => e.trim())
      .filter(Boolean).map((e) => parseExpectation(e.replace(/^expect\s+/, ''), line));
    src = src.slice(0, arrow).trim();
  }
  const head = src.match(/^(\S+)/)[1];
  const vm = head.match(/^([a-z]+)(\??)((?:@[\w-]+)*)(!?)$/);
  if (!vm || !VERBS.has(vm[1])) {
    if (head === '==') return { line, verb: 'section', text: src.slice(2).trim(), args: [], opts: {}, expects };
    throw new MulError(`unknown verb ${JSON.stringify(head)}`, line, `verbs: ${[...VERBS].join(' ')}`);
  }
  const verb = vm[1];
  const node = { line, verb, optional: vm[2] === '?', mods: vm[3] ? vm[3].slice(1).split('@') : [], args: [], opts: {}, expects };
  let rest = src.slice(head.length).trim();

  if (verb === 'expect') {
    node.expects.unshift(parseExpectation((vm[4] ? '!' : '') + rest, line));
    return node;
  }
  if (TEXT_VERBS.has(verb) && rest && !rest.startsWith('"')) {
    // free text; trailing key=value options are allowed after two spaces: `say text  hold=2`
    const m = rest.match(/^(.*?)\s{2,}((?:[a-z]+=\S+\s*)+)$/);
    node.text = (m ? m[1] : rest).trim();
    if (m) Object.assign(node.opts, parseOpts(tokenize(m[2], line), line));
    return node;
  }
  const toks = tokenize(rest, line);
  const pos = [];
  const optToks = [];
  for (const t of toks) {
    if (!t.q && /^[a-z][\w-]*=/.test(t.v)) optToks.push(t);
    else if (!t.q && /^[a-z][\w-]*$/.test(t.v) && FLAG_OPTS.has(t.v) && pos.length) optToks.push(t);
    else pos.push(t);
  }
  Object.assign(node.opts, parseOpts(optToks, line));
  shapeArgs(node, pos, line);
  return node;
}

/** Flags that may follow the target without `=`: `point "x" spot`, `say@top`, `zoom … snap`. */
const FLAG_OPTS = new Set(['spot', 'top', 'snap', 'keep', 'double', 'right', 'slow', 'fast', 'instant']);

function parseOpts(toks, line) {
  const o = {};
  for (const t of toks) {
    const k = t.v.indexOf('=');
    if (k < 0) { o[t.v] = true; continue; }
    const key = t.v.slice(0, k);
    let val = t.v.slice(k + 1);
    if (TARGET_OPTS.has(key)) { o[key] = parseTargetExpr(tokenize(val.replace(/^\((.*)\)$/, '$1'), line), line); continue; }
    if (key === 'by') {
      const m = val.match(/^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
      if (!m) throw new MulError('by= needs (dx,dy)', line, 'drag card:"A" by=(0,-120)');
      o.by = { dx: +m[1], dy: +m[2] };
      continue;
    }
    val = unq(val);
    o[key] = /^-?\d+(\.\d+)?$/.test(val) ? +val : val;
  }
  return o;
}

/** Turn positional tokens into the verb's arguments. */
function shapeArgs(node, pos, line) {
  const v = node.verb;
  const need = (n, ex) => { if (pos.length < n) throw new MulError(`${v} needs ${n === 1 ? 'a target' : `${n} arguments`}`, line, ex); };
  switch (v) {
    case 'say': case 'chip': case 'note': case 'go':
      node.text = pos.length ? unq(pos.map((t) => t.v).join(' ')) : '';
      break;
    case 'wait':
      if (!pos.length) { node.seconds = 1; break; }
      if (/^\d+(\.\d+)?s?$/.test(pos[0].v)) node.seconds = parseFloat(pos[0].v);
      else if (['ready', 'idle', 'network'].includes(pos[0].v)) node.until = pos[0].v;
      else if (pos[0].v === 'gone') { node.until = 'gone'; node.target = parseTargetExpr(pos.slice(1), line)[0]; }
      else { node.until = 'visible'; node.target = parseTargetExpr(pos, line)[0]; }
      break;
    case 'type': case 'pick':
      need(2, `${v} textbox:"Name" "value"`);
      node.target = parseTargetExpr(pos.slice(0, -1), line)[0];
      node.value = unq(pos[pos.length - 1].v);
      break;
    case 'key':
      need(1, 'key Enter   key Control+A');
      node.keys = pos.map((t) => t.v);
      break;
    case 'scroll':
      if (pos.length === 1 && /^-?\d+$/.test(pos[0].v)) node.dy = +pos[0].v;
      else { need(1, 'scroll card:"Chart"   scroll 400'); node.target = parseTargetExpr(pos, line)[0]; }
      break;
    case 'zoom': case 'pan':
      need(1, 'zoom card:"KPI" + card:"Trend" pad=40');
      node.targets = parseTargetExpr(pos, line);
      break;
    case 'shot':
      need(1, 'shot overview_kpi clip=card:"KPI"');
      node.name = pos[0].v;
      break;
    case 'run':
      need(1, 'run seedOrders 20');
      node.name = pos[0].v;
      node.params = pos.slice(1).map((t) => unq(t.v));
      break;
    case 'use':
      need(1, 'use login owner');
      node.name = pos[0].v;
      node.params = pos.slice(1).map((t) => unq(t.v));
      break;
    case 'mark':
      need(1, 'mark after-filter');
      node.name = pos[0].v;
      break;
    case 'fast':
      node.factor = pos.length ? parseFloat(pos[0].v) : 3;
      break;
    case 'retry':
      node.times = pos.length ? parseInt(pos[0].v, 10) : 2;
      break;
    case 'click': case 'hover': case 'point': case 'drag': case 'spot':
      need(1, `${v} button:"Save"`);
      node.target = parseTargetExpr(pos, line)[0];
      if (v === 'drag' && !node.opts.to && !node.opts.by) throw new MulError('drag needs to=<target> or by=(dx,dy)', line);
      break;
    default:
      if (pos.length) throw new MulError(`${v} takes no arguments`, line);
  }
}

/** Index of `=>` outside quotes, or -1. */
function findArrow(s) {
  let q = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '"' && s[i - 1] !== '\\') q = !q;
    else if (!q && s[i] === '=' && s[i + 1] === '>') return i;
  }
  return -1;
}

// ---------------------------------------------------------------- document

/**
 * Parse a whole .mul source → { meta, steps, setup, errors }.
 * With { tolerant: true } bad lines are collected in errors instead of throwing — the vibe
 * check uses this so one typo doesn't hide every other finding.
 */
export function parse(source, { file = '<mul>', tolerant = false } = {}) {
  const meta = {};
  const errors = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const root = { verb: 'root', children: [], indent: -1 };
  const stack = [root];
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const body = stripComment(raw);
    if (!body.trim()) return;
    const indent = body.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    const text = body.trim();
    try {
      if (text.startsWith('@') && stack.length === 1) {
        const m = text.match(/^@([\w-]+)\s*(.*)$/);
        if (!m) throw new MulError('bad header', line, '@title My topic');
        meta[m[1]] = /^-?\d+(\.\d+)?$/.test(m[2]) ? +m[2] : unq(m[2].trim());
        return;
      }
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const node = parseStatement(text, line);
      node.indent = indent;
      stack[stack.length - 1].children.push(node);
      if (BLOCK_VERBS.has(node.verb)) { node.children = []; stack.push(node); }
    } catch (e) {
      if (!tolerant || !(e instanceof MulError)) throw e;
      errors.push({ line, message: e.message, hint: e.hint });
    }
  });
  const setup = [];
  const steps = [];
  for (const n of root.children) (n.verb === 'setup' ? setup.push(...n.children) : steps.push(n));
  return { file, meta, setup, steps, errors };
}

function stripComment(raw) {
  if (/^\s*#/.test(raw) && !/^\s*#[\w.-]+\s/.test(raw.trimStart() + ' ').valueOf()) return '';
  if (/^\s*#\s/.test(raw) || /^\s*#$/.test(raw)) return '';
  // trailing comment: two+ spaces, then "# "
  const m = raw.match(/^(.*?\S)\s{2,}#\s.*$/);
  return m && !inQuotes(raw, m[1].length) ? m[1] : raw;
}

function inQuotes(s, idx) {
  let q = false;
  for (let i = 0; i < idx; i++) if (s[i] === '"' && s[i - 1] !== '\\') q = !q;
  return q;
}

/** Depth-first walk over steps (blocks included), calling fn(node, ancestors). */
export function walk(steps, fn, anc = []) {
  for (const n of steps) {
    fn(n, anc);
    if (n.children) walk(n.children, fn, [...anc, n]);
  }
}

/** Human-readable form of a target (for logs, failure cards, specs). */
export function showTarget(t) {
  if (!t) return '';
  if (Array.isArray(t)) return t.map(showTarget).join(' + ');
  let s;
  switch (t.kind) {
    case 'text': s = `${t.fuzzy ? '~' : ''}"${t.value}"`; break;
    case 'regex': s = `/${t.value}/${t.flags}`; break;
    case 'id': s = `#${t.value}`; break;
    case 'css': s = `css(${t.value})`; break;
    case 'point': s = `xy(${t.x},${t.y})`; break;
    case 'i18n': s = `t:${t.value}`; break;
    case 'var': s = `$${t.value}`; break;
    case 'macro': s = t.value == null ? t.name : `${t.name}:${t.fuzzy ? '~' : ''}"${t.value}"`; break;
    case 'union': s = `(${t.parts.map(showTarget).join(' + ')})`; break;
    default: s = t.value || t.kind;
  }
  if (t.nth) s += `[${t.nth === -1 ? 'last' : t.nth}]`;
  if (t.within) s += ` in ${showTarget(t.within)}`;
  return s;
}
