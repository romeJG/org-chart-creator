// Data model: the document shape, document-level property getters, persistence
// (localStorage autosave), undo/redo, and the node mutations (add/delete/select/
// swap/reparent). Mutations funnel through saveAndRender(All) so layout, render,
// and autosave never drift out of sync.

import {
  SCHEMA_VERSION, STORAGE_KEY, HIDE_PHOTOS_KEY, DEFAULT_GROUP_TITLE,
  DEFAULT_CONNECTOR_LEN, DEFAULT_H_GAP, MAX_UNDO
} from './constants.js';
import { state } from './state.js';
import { uuid } from './util.js';
import { renderChart } from './render.js';
import { renderTabbar } from './tabs.js';
import { syncConnectorLengthControl, syncHorizontalGapControl } from './viewcontrols.js';
import { closeActiveEditors, editNodeField } from './editors.js';

// ---- Document-level property getters (defaults for older/imported data) ----
export function connectorLength() {
  return (state.doc && typeof state.doc.connectorLength === 'number') ? state.doc.connectorLength : DEFAULT_CONNECTOR_LEN;
}
export function horizontalGap() {
  return (state.doc && typeof state.doc.horizontalGap === 'number') ? state.doc.horizontalGap : DEFAULT_H_GAP;
}

// ---- Document / node construction ----
export function createEmptyDocument() {
  var teamId = uuid();
  return {
    version: SCHEMA_VERSION,
    title: DEFAULT_GROUP_TITLE,
    connectorLength: DEFAULT_CONNECTOR_LEN,
    horizontalGap: DEFAULT_H_GAP,
    activeTeamId: teamId,
    teams: [{ id: teamId, name: 'Unit 1', rootId: null, nodes: {} }]
  };
}

export function newNode(parentId) {
  var id = uuid();
  return { id: id, parentId: parentId, name: 'New Person', title: 'Title', specialties: '', photo: null, scale: 1, offsetX: 0, offsetY: 0, childIds: [] };
}

export function getActiveTeam() {
  if (!state.doc || !state.doc.teams) return null;
  for (var i = 0; i < state.doc.teams.length; i++) {
    if (state.doc.teams[i].id === state.doc.activeTeamId) return state.doc.teams[i];
  }
  return null;
}

export function migrateIfNeeded(payload) {
  // No-op for schema version 1. Future schema changes upgrade `payload` in place here.
}

var TRANSIENT_KEYS = ['_x', '_y', '_subtreeWidth', '_depth', '_photoSide', '_photoRect'];
export function stripTransient(team) {
  var clone = JSON.parse(JSON.stringify(team));
  if (clone.nodes) {
    Object.keys(clone.nodes).forEach(function (id) {
      TRANSIENT_KEYS.forEach(function (k) { delete clone.nodes[id][k]; });
    });
  }
  delete clone._layoutBounds;
  return clone;
}

// ---- Undo / redo (whole-document snapshots) ----
export function snapshotDoc() {
  return JSON.stringify({
    version: state.doc.version,
    title: state.doc.title,
    connectorLength: connectorLength(),
    horizontalGap: horizontalGap(),
    activeTeamId: state.doc.activeTeamId,
    teams: state.doc.teams.map(stripTransient)
  });
}

export function restoreSnapshot(json) {
  var parsed = JSON.parse(json);
  state.doc.version = parsed.version;
  state.doc.title = parsed.title;
  state.doc.connectorLength = parsed.connectorLength;
  state.doc.horizontalGap = parsed.horizontalGap;
  state.doc.activeTeamId = parsed.activeTeamId;
  state.doc.teams = parsed.teams;
}

// Call before any mutation to doc/team state so it can be undone.
export function pushUndo() {
  if (!state.doc) return;
  state.undoStack.push(snapshotDoc());
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack.length = 0;
  updateUndoRedoButtons();
}

export function updateUndoRedoButtons() {
  var u = document.getElementById('undo-btn');
  var r = document.getElementById('redo-btn');
  if (u) u.disabled = state.undoStack.length === 0;
  if (r) r.disabled = state.redoStack.length === 0;
}

export function undo() {
  if (!state.undoStack.length) return;
  closeActiveEditors();
  state.redoStack.push(snapshotDoc());
  restoreSnapshot(state.undoStack.pop());
  state.selectedNodeId = null;
  saveAndRenderAll();
  updateUndoRedoButtons();
}

export function redo() {
  if (!state.redoStack.length) return;
  closeActiveEditors();
  state.undoStack.push(snapshotDoc());
  restoreSnapshot(state.redoStack.pop());
  state.selectedNodeId = null;
  saveAndRenderAll();
  updateUndoRedoButtons();
}

// ---- Persistence (localStorage autosave) ----
export function persist() {
  try {
    var payload = {
      version: state.doc.version,
      title: state.doc.title,
      connectorLength: connectorLength(),
      horizontalGap: horizontalGap(),
      activeTeamId: state.doc.activeTeamId,
      teams: state.doc.teams.map(stripTransient)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    state.quotaWarned = false;
  } catch (e) {
    console.warn('Autosave failed:', e);
    if (!state.quotaWarned) {
      state.quotaWarned = true;
      alert('Your browser\'s storage is full, so this change could not be autosaved.\n\n' +
        'Use "Export All Units (JSON)" now to save your work, or remove some photos to free up space.');
    }
  }
}

export function persistDebounced() {
  clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(persist, 500);
}

export function loadPhotosHiddenPref() {
  try { state.photosHidden = localStorage.getItem(HIDE_PHOTOS_KEY) === '1'; } catch (e) { state.photosHidden = false; }
}

export function savePhotosHiddenPref() {
  try { localStorage.setItem(HIDE_PHOTOS_KEY, state.photosHidden ? '1' : '0'); } catch (e) {}
}

export function loadFromStorage() {
  var raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
  if (!raw) { state.doc = createEmptyDocument(); return; }
  try {
    var parsed = JSON.parse(raw);
    migrateIfNeeded(parsed);
    if (!parsed.teams || !parsed.teams.length) throw new Error('empty document');
    if (!parsed.title) parsed.title = DEFAULT_GROUP_TITLE;
    if (typeof parsed.connectorLength !== 'number') parsed.connectorLength = DEFAULT_CONNECTOR_LEN;
    if (typeof parsed.horizontalGap !== 'number') parsed.horizontalGap = DEFAULT_H_GAP;
    state.doc = parsed;
  } catch (e) {
    console.error('Corrupt autosave data, starting fresh', e);
    state.doc = createEmptyDocument();
  }
}

// ---- Render/save choke points ----
export function saveAndRender() {
  persistDebounced();
  renderChart();
}

export function saveAndRenderAll() {
  persistDebounced();
  renderTabbar();
  renderChart();
  syncConnectorLengthControl();
  syncHorizontalGapControl();
}

// ---- Node mutations ----
export function addRootNode() {
  var team = getActiveTeam();
  if (!team) return;
  pushUndo();
  var node = newNode(null);
  team.nodes[node.id] = node;
  team.rootId = node.id;
  state.selectedNodeId = node.id;
  saveAndRender();
  editNodeField(node.id, 'name');
}

export function addChild(nodeId, position) {
  var team = getActiveTeam();
  if (!team) return;
  var node = team.nodes[nodeId];
  if (!node) return;
  var parentId;
  if (position === 'below') {
    parentId = nodeId;
  } else {
    if (node.parentId === null) {
      alert('The top node cannot have a sibling. Add a person "below" instead, or use another unit tab for a separate hierarchy.');
      return;
    }
    parentId = node.parentId;
  }
  pushUndo();
  var child = newNode(parentId);
  team.nodes[child.id] = child;
  if (position === 'below') {
    team.nodes[parentId].childIds.push(child.id);
  } else {
    var siblings = team.nodes[parentId].childIds;
    siblings.splice(siblings.indexOf(nodeId) + 1, 0, child.id);
  }
  state.selectedNodeId = child.id;
  saveAndRender();
  editNodeField(child.id, 'name');
}

// Deletes a single person, keeping everyone else: their direct reports move up to
// fill the gap. Deleting the root with >1 child promotes the first child.
export function deleteNode(nodeId) {
  var team = getActiveTeam();
  if (!team) return;
  var node = team.nodes[nodeId];
  if (!node) return;

  var msg = 'Delete "' + node.name + '"?' +
    (node.childIds.length > 0 ? ' Their direct report(s) will move up to fill the gap.' : '');
  if (!confirm(msg)) return;

  pushUndo();
  if (node.parentId === null) {
    if (node.childIds.length === 0) {
      team.rootId = null;
    } else {
      var newRootId = node.childIds[0];
      var newRoot = team.nodes[newRootId];
      newRoot.parentId = null;
      node.childIds.slice(1).forEach(function (cid) {
        team.nodes[cid].parentId = newRootId;
        newRoot.childIds.push(cid);
      });
      team.rootId = newRootId;
    }
  } else {
    var parent = team.nodes[node.parentId];
    var idx = parent.childIds.indexOf(nodeId);
    node.childIds.forEach(function (cid) { team.nodes[cid].parentId = node.parentId; });
    parent.childIds.splice.apply(parent.childIds, [idx, 1].concat(node.childIds));
  }
  delete team.nodes[nodeId];
  if (state.selectedNodeId === nodeId) state.selectedNodeId = null;
  saveAndRender();
}

export function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  renderChart();
}

// Swap two people's details between their seats, leaving structure intact.
export function swapNodes(idA, idB) {
  var team = getActiveTeam();
  if (!team) return;
  var a = team.nodes[idA], b = team.nodes[idB];
  if (!a || !b) return;
  pushUndo();
  ['name', 'title', 'specialties', 'photo'].forEach(function (f) {
    var tmp = a[f]; a[f] = b[f]; b[f] = tmp;
  });
  saveAndRender();
}

// True if `candidateId` is anywhere in `ancestorId`'s subtree.
export function isDescendantOf(candidateId, ancestorId, team) {
  var node = team.nodes[ancestorId];
  if (!node) return false;
  var stack = node.childIds.slice();
  while (stack.length) {
    var id = stack.pop();
    if (id === candidateId) return true;
    var n = team.nodes[id];
    if (n) stack = stack.concat(n.childIds);
  }
  return false;
}

// Move a person (and everyone below them) to report to a new manager.
export function reparentNode(nodeId, newParentId) {
  var team = getActiveTeam();
  if (!team) return;
  var node = team.nodes[nodeId];
  var newParent = team.nodes[newParentId];
  if (!node || !newParent || nodeId === newParentId) return;
  if (node.parentId === null) {
    alert('The top person can\'t be moved under someone else. Delete them to promote a report instead, or drag without Shift to swap places.');
    return;
  }
  if (newParentId === node.parentId) return;
  if (isDescendantOf(newParentId, nodeId, team)) {
    alert('Can\'t move someone under one of their own reports.');
    return;
  }
  pushUndo();
  var oldParent = team.nodes[node.parentId];
  oldParent.childIds = oldParent.childIds.filter(function (id) { return id !== nodeId; });
  node.parentId = newParentId;
  newParent.childIds.push(nodeId);
  saveAndRender();
}
