// Screens are (state, h) → HTML; ACTIONS change state (return a string to show a toast).
// Every element the demo touches gets a data-testid — the real app should keep them.
window.BRAND = 'Taskboard';
window.START = 'board';
window.NAV = [['board', 'Board'], ['reports', 'Reports'], ['team', 'Team']];

const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];

window.SCREENS = {
  board: (s, h) => {
    const open = s.tasks.filter((t) => t.col !== 'done').length;
    const pct = Math.round((s.doneThisWeek / s.weeklyGoal) * 100);
    return `
    <div class="top"><div><h1>Board</h1><div class="sub">Everything the team is working on this week</div></div>
      <button class="btn primary" data-open="new-task" data-testid="new-task">+ New task</button></div>
    <div class="grid g4" style="margin-bottom:20px">
      ${h.kpi('Open tasks', open, '', 'kpi-open')}
      ${h.kpi('Due this week', s.tasks.filter((t) => t.col !== 'done').length, '', 'kpi-due')}
      ${h.kpi('Done this week', s.doneThisWeek, '+2 vs last week', 'kpi-done')}
      <div class="card kpi" data-testid="weekly-goal"><div class="label">Weekly goal</div>
        <div class="value">${pct}%</div>${h.progress(pct)}<div class="muted" style="font-size:13px;margin-top:6px">${s.doneThisWeek} of ${s.weeklyGoal} tasks</div></div>
    </div>
    <div class="board">
      ${COLS.map(([id, label]) => `<section class="col" data-drop="${id}" data-testid="col-${id}" aria-label="${label}">
        <h4>${label}<span>${s.tasks.filter((t) => t.col === id).length}</span></h4>
        ${s.tasks.filter((t) => t.col === id).map((t) => `<article class="task" data-drag="${t.id}" data-testid="task-${t.id}">
          <div class="t">${h.esc(t.title)}</div><div class="m"><span>${h.esc(t.who)}</span>${h.badge(t.due, t.due === 'Mon' ? 'warn' : '')}</div></article>`).join('')}
      </section>`).join('')}
    </div>`;
  },
  reports: (s, h) => `
    <div class="top"><div><h1>Reports</h1><div class="sub">How much the team finished, week by week</div></div></div>
    <div class="grid g2">
      <div class="card" data-testid="chart-done"><h3>Tasks done per week</h3>${h.bars(s.weeks)}</div>
      <div class="card" data-testid="table-people"><h3>By person</h3><table class="table"><thead><tr><th>Person</th><th>Open</th><th>Done</th></tr></thead><tbody>
        ${s.people.map((p) => `<tr><td>${p}</td><td>${s.tasks.filter((t) => t.who === p && t.col !== 'done').length}</td><td>${s.tasks.filter((t) => t.who === p && t.col === 'done').length}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`,
  team: (s, h) => `<div class="top"><div><h1>Team</h1></div></div><div class="card">${s.people.map((p) => h.badge(p, 'accent')).join(' ')}</div>`,
};

window.MODALS = {
  'new-task': {
    title: 'New task',
    body: (s, h) => `<form data-submit="createTask">
      <div class="field"><label for="f-title">Title</label><input class="input" id="f-title" name="title" placeholder="What needs doing?" autofocus data-testid="task-title"></div>
      <div class="grid g2"><div class="field"><label for="f-who">Assignee</label><select class="select" id="f-who" name="who" data-testid="task-who">${h.options(s.people, s.me)}</select></div>
      <div class="field"><label for="f-due">Due</label><select class="select" id="f-due" name="due" data-testid="task-due">${h.options(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 'Fri')}</select></div></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" data-testid="task-create">Create task</button></div>
    </form>`,
  },
};

window.ACTIONS = {
  createTask(state, f) {
    if (!f.title?.trim()) return 'Give the task a title';
    state.tasks.push({ id: 't' + (state.tasks.length + 1), title: f.title.trim(), who: f.who, due: f.due, col: 'todo' });
    state.modal = null;
    return `Task created for ${f.who}`;
  },
  drop(state, id, col) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.col === col) return;
    if (col === 'done' && t.col !== 'done') state.doneThisWeek++;
    if (t.col === 'done' && col !== 'done') state.doneThisWeek--;
    t.col = col;
    return col === 'done' ? `“${t.title}” is done` : undefined;
  },
};
