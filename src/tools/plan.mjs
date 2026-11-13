/**
 * Storyboard (markdown) → .mul skeletons with <<blanks>> for every target.
 *
 *   ## board-basics: Move work across the board
 *   start: /board · user: demo · budget: 45
 *   - say: The board shows every task by its stage
 *   - point: Doing column | Work in progress
 *   - click: New task button => New task dialog
 *   - type: Title field = Write the launch post
 *   - pick: Assignee = Mia
 *   - drag: Launch post card -> Done column
 *   - zoom: Weekly goal widget
 *   - shot: board-after
 *   ### Section title
 *
 * Writing a storyboard first is the cheapest place to get the story right; the skeleton
 * then only needs targets, which `manualify fill` finds without screenshots.
 */
import fs from 'node:fs';
import path from 'node:path';

const blank = (s) => `<<${s.trim()}>>`;
const q = (s) => JSON.stringify(s.trim());

export function planFromStoryboard(md, outDir) {
  const topics = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^##\s+([\w.-]+)\s*:\s*(.+)$/))) { cur = { id: m[1], title: m[2], meta: {}, body: [] }; topics.push(cur); continue; }
    if (!cur) continue;
    if ((m = line.match(/^###\s+(.+)$/))) { cur.body.push({ kind: 'section', text: m[1] }); continue; }
    if ((m = line.match(/^(start|user|budget|state)\s*:/i))) {
      for (const part of line.split('·')) { const k = part.match(/^\s*(start|user|budget|state)\s*:\s*(.+?)\s*$/i); if (k) cur.meta[k[1].toLowerCase()] = k[2]; }
      continue;
    }
    if ((m = line.match(/^[-*]\s+(\w+)\s*:\s*(.+)$/))) { cur.body.push({ kind: m[1].toLowerCase(), text: m[2] }); continue; }
    if (line && !line.startsWith('#')) cur.body.push({ kind: 'note', text: line });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const t of topics) {
    const L = [`@id ${t.id}`, `@title ${t.title}`];
    if (t.meta.user) L.push(`@user ${t.meta.user}`);
    if (t.meta.state) L.push(`@state ${t.meta.state}`);
    if (t.meta.budget) L.push(`@budget ${t.meta.budget}`);
    L.push('@assert warn', '');
    if (t.meta.start) L.push('cut', `  go ${t.meta.start}`, '  wait ready', '');
    let zoomed = false;
    const unzoom = () => { if (zoomed) { L.push('unzoom'); zoomed = false; } };
    for (const b of t.body) {
      const [lhs, rhs] = b.text.split(/\s*(?:=>|->|=|\|)\s*/);
      const exp = b.text.includes('=>') ? ` => expect ${blank(b.text.split('=>')[1])} visible` : '';
      switch (b.kind) {
        case 'section': unzoom(); L.push('', `== ${b.text}`); break;
        case 'say': L.push(`say ${b.text}`); break;
        case 'point': L.push(`point ${blank(lhs)}${rhs ? ` label=${q(rhs)}` : ''}`); break;
        case 'click': L.push(`click ${blank(lhs)}${exp}`); break;
        case 'hover': L.push(`hover ${blank(lhs)}`); break;
        case 'type': L.push(`type ${blank(lhs)} ${q(rhs || '<<value>>')}`); break;
        case 'pick': L.push(`pick ${blank(lhs)} ${q(rhs || '<<option>>')}`); break;
        case 'drag': L.push(`drag ${blank(lhs)} to=${blank(rhs || 'destination')} => expect ${blank(lhs)} moved`); break;
        case 'zoom': unzoom(); L.push(`zoom ${blank(lhs)}`); zoomed = true; break;
        case 'unzoom': unzoom(); break;
        case 'shot': L.push(`shot ${b.text.replace(/\W+/g, '_')}`); break;
        case 'wait': L.push(`wait ${b.text}`); break;
        case 'go': L.push('cut', `  go ${b.text}`, '  wait ready'); break;
        case 'expect': L.push(`expect ${blank(b.text)} visible`); break;
        default: L.push(`# ${b.kind === 'note' ? '' : b.kind + ': '}${b.text}`);
      }
    }
    unzoom();
    const f = path.join(outDir, `${t.id}.mul`);
    fs.writeFileSync(f, L.join('\n') + '\n');
    files.push(f);
  }
  return files;
}
