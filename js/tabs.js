// The unit tabs: switch, add, delete, inline-rename, and render the tab bar.

import { state } from './state.js';
import { uuid } from './util.js';
import { pushUndo, persistDebounced, saveAndRenderAll } from './model.js';
import { closeActiveEditors } from './editors.js';
import { renderChart } from './render.js';
import { updateZoomLabel } from './viewcontrols.js';

export function switchTeam(teamId) {
  if (state.doc.activeTeamId === teamId) return;
  closeActiveEditors();
  state.doc.activeTeamId = teamId;
  state.selectedNodeId = null;
  state.editingNodeId = null;
  state.zoomLevel = null; // each unit starts fit-to-view; its chart may differ in size
  persistDebounced();
  renderTabbar();
  renderChart();
  updateZoomLabel();
}

export function addTeam() {
  pushUndo();
  var id = uuid();
  state.doc.teams.push({ id: id, name: 'New Unit', rootId: null, nodes: {} });
  state.doc.activeTeamId = id;
  state.selectedNodeId = null;
  saveAndRenderAll();
}

export function deleteTeam(teamId) {
  var team = null, idx = -1;
  for (var i = 0; i < state.doc.teams.length; i++) {
    if (state.doc.teams[i].id === teamId) { team = state.doc.teams[i]; idx = i; break; }
  }
  if (!team) return;
  if (!confirm('Delete unit "' + team.name + '" and its entire chart? (You can Undo afterward.)')) return;
  pushUndo();
  state.doc.teams.splice(idx, 1);
  if (state.doc.activeTeamId === teamId) {
    var next = state.doc.teams[idx] || state.doc.teams[idx - 1] || null;
    state.doc.activeTeamId = next ? next.id : null;
  }
  state.selectedNodeId = null;
  saveAndRenderAll();
}

function startRenamingTab(teamId, labelEl) {
  var team = null;
  for (var i = 0; i < state.doc.teams.length; i++) {
    if (state.doc.teams[i].id === teamId) { team = state.doc.teams[i]; break; }
  }
  if (!team) return;
  var input = document.createElement('input');
  input.className = 'tab-rename-input';
  input.value = team.name;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  var settled = false;
  function commit() {
    if (settled) return;
    settled = true;
    var newName = input.value.trim() || team.name;
    if (newName !== team.name) pushUndo();
    team.name = newName;
    persistDebounced();
    renderTabbar();
    renderChart();
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); settled = true; renderTabbar(); }
  });
  input.addEventListener('blur', commit);
}

export function renderTabbar() {
  var tabbar = document.getElementById('tabbar');
  tabbar.innerHTML = '';

  state.doc.teams.forEach(function (team) {
    var tab = document.createElement('div');
    tab.className = 'tab' + (team.id === state.doc.activeTeamId ? ' active' : '');
    tab.setAttribute('data-team-id', team.id);

    var label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = team.name;
    tab.appendChild(label);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Delete unit';
    tab.appendChild(closeBtn);

    tabbar.appendChild(tab);

    label.addEventListener('click', function () { switchTeam(team.id); });
    label.addEventListener('dblclick', function (e) { e.stopPropagation(); startRenamingTab(team.id, label); });
    closeBtn.addEventListener('click', function (e) { e.stopPropagation(); deleteTeam(team.id); });
  });

  var addBtn = document.createElement('button');
  addBtn.id = 'add-tab-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add unit';
  addBtn.addEventListener('click', addTeam);
  tabbar.appendChild(addBtn);
}
