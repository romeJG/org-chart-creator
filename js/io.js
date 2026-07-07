// Export (per-unit JSON, whole-document JSON, PNG, SVG) and import (JSON).

import { SCHEMA_VERSION, SVG_NS } from './constants.js';
import { state } from './state.js';
import { sanitizeFilename, downloadJSON, downloadBlob, uuid } from './util.js';
import {
  getActiveTeam, stripTransient, connectorLength, horizontalGap, migrateIfNeeded,
  pushUndo, saveAndRenderAll
} from './model.js';
import { closeActiveEditors } from './editors.js';
import { renderChart } from './render.js';

export function exportTeamJSON() {
  var team = getActiveTeam();
  if (!team) { alert('No active unit to export.'); return; }
  var payload = { schemaKind: 'org-chart-team', schemaVersion: SCHEMA_VERSION, team: stripTransient(team) };
  downloadJSON(payload, sanitizeFilename(team.name) + '-org-chart.json');
}

export function exportAllJSON() {
  if (!state.doc.teams.length) { alert('No units to export.'); return; }
  var payload = {
    schemaKind: 'org-chart-document',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    title: state.doc.title,
    connectorLength: connectorLength(),
    horizontalGap: horizontalGap(),
    teams: state.doc.teams.map(stripTransient),
    activeTeamId: state.doc.activeTeamId
  };
  downloadJSON(payload, 'org-chart-all-units.json');
}

export function exportPNG() {
  var team = getActiveTeam();
  if (!team || !team.rootId) { alert('Nothing to export yet — add at least one person first.'); return; }

  // Render a clean frame (no selection highlight, no overlay, no placeholders).
  var savedSel = state.selectedNodeId;
  state.selectedNodeId = null;
  closeActiveEditors();
  renderChart();

  var svg = document.getElementById('chart-svg');
  var clone = svg.cloneNode(true);
  var overlay = clone.querySelector('#layer-ui-overlay');
  if (overlay) overlay.remove();
  Array.prototype.forEach.call(clone.querySelectorAll('.slide-bg'), function (el) { el.remove(); });
  clone.setAttribute('xmlns', SVG_NS);

  var fullW = +svg.getAttribute('width');
  var fullH = +svg.getAttribute('height');

  var svgString = new XMLSerializer().serializeToString(clone);
  var svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

  // Restore the interactive selection now that the frame is captured.
  state.selectedNodeId = savedSel;
  renderChart();

  var scale = Math.min(window.devicePixelRatio || 1, 2);
  var canvas = document.createElement('canvas');
  canvas.width = fullW * scale;
  canvas.height = fullH * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  var img = new Image();
  img.onload = function () {
    ctx.drawImage(img, 0, 0, fullW, fullH);
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = sanitizeFilename(team.name) + '-org-chart.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  img.onerror = function () {
    alert('PNG export failed to render in this browser. Try again, or use "Export Unit (JSON)" as a fallback.');
  };
  img.src = svgDataUrl;
}

export function exportSVG() {
  var team = getActiveTeam();
  if (!team || !team.rootId) { alert('Nothing to export yet — add at least one person first.'); return; }

  var savedSel = state.selectedNodeId;
  state.selectedNodeId = null;
  closeActiveEditors();
  renderChart();

  var svg = document.getElementById('chart-svg');
  var clone = svg.cloneNode(true);
  var overlay = clone.querySelector('#layer-ui-overlay');
  if (overlay) overlay.remove();
  Array.prototype.forEach.call(clone.querySelectorAll('.slide-bg'), function (el) { el.remove(); });
  clone.setAttribute('xmlns', SVG_NS);
  // Strip any inline pixel size from manual zoom so the file uses natural dims.
  clone.removeAttribute('style');
  clone.setAttribute('width', svg.getAttribute('width'));
  clone.setAttribute('height', svg.getAttribute('height'));

  var svgString = new XMLSerializer().serializeToString(clone);

  state.selectedNodeId = savedSel;
  renderChart();

  downloadBlob(svgString, 'image/svg+xml', sanitizeFilename(team.name) + '-org-chart.svg');
}

export function importJSON(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      alert('This file is not valid JSON.');
      return;
    }

    if (parsed.schemaKind === 'org-chart-document') {
      if (!confirm('Importing this file will REPLACE all current units with its contents. (You can Undo afterward.) Continue?')) return;
      pushUndo();
      migrateIfNeeded(parsed);
      state.doc.teams = parsed.teams || [];
      state.doc.title = parsed.title || state.doc.title;
      if (typeof parsed.connectorLength === 'number') state.doc.connectorLength = parsed.connectorLength;
      if (typeof parsed.horizontalGap === 'number') state.doc.horizontalGap = parsed.horizontalGap;
      state.doc.activeTeamId = parsed.activeTeamId || (state.doc.teams[0] && state.doc.teams[0].id) || null;
    } else if (parsed.schemaKind === 'org-chart-team' && parsed.team) {
      pushUndo();
      migrateIfNeeded(parsed);
      var newTeam = parsed.team;
      newTeam.id = uuid();
      var existingNames = state.doc.teams.map(function (t) { return t.name; });
      if (existingNames.indexOf(newTeam.name) !== -1) newTeam.name = newTeam.name + ' (imported)';
      state.doc.teams.push(newTeam);
      state.doc.activeTeamId = newTeam.id;
    } else {
      alert('Unrecognized file format. Expected a JSON file exported from this tool.');
      return;
    }

    closeActiveEditors();
    state.selectedNodeId = null;
    state.editingNodeId = null;
    saveAndRenderAll();
  };
  reader.readAsText(file);
}
