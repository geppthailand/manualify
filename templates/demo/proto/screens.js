// Screens: (state, h) → HTML. Modals: { title, body }. Actions: (state, args) → optional toast text.
// Give every element the demo touches a data-testid — the real app should keep the same ids.
window.BRAND = 'Prototype';
window.START = 'home';
window.NAV = [['home', 'Home'], ['settings', 'Settings']];

window.SCREENS = {
  home: (s, h) => `
    <div class="top"><div><h1>Home</h1><div class="sub">One line that says what this screen is for</div></div>
      <button class="btn primary" data-open="new-item" data-testid="primary-action">+ New item</button></div>
    <div class="grid g3" style="margin-bottom:20px">
      ${h.kpi('Items', s.items.length, '', 'kpi-main')}
      ${h.kpi('Total value', s.items.reduce((a, x) => a + x.value, 0), '+12%')}
      <div class="card kpi" data-testid="result"><div class="label">Active</div><div class="value">${s.items.filter((x) => x.status === 'Active').length}</div></div>
    </div>
    <div class="card"><table class="table"><thead><tr><th>Name</th><th>Value</th><th>Status</th></tr></thead><tbody>
      ${s.items.map((x) => `<tr data-testid="row-${x.id}"><td>${h.esc(x.name)}</td><td>${x.value}</td><td>${h.badge(x.status, x.status === 'Active' ? 'good' : '')}</td></tr>`).join('')}
    </tbody></table></div>`,
  settings: () => `<div class="top"><h1>Settings</h1></div><div class="card muted">Not part of this demo.</div>`,
};

window.MODALS = {
  'new-item': {
    title: 'New item',
    body: () => `<form data-submit="createItem">
      <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" name="name" autofocus data-testid="field-name"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`,
  },
};

window.ACTIONS = {
  createItem(state, f) {
    if (!f.name?.trim()) return 'Give it a name';
    state.items.unshift({ id: 'n' + Date.now(), name: f.name.trim(), value: 100, status: 'Active' });
    state.modal = null;
    return 'Saved';
  },
};
