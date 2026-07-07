// View controls that don't change the tree structure: zoom/pan, the connector-
// length and horizontal-gap sliders, and the photo-visibility toggle.

import {
  ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, CONNECTOR_LEN_MIN, CONNECTOR_LEN_MAX, H_GAP_MIN, H_GAP_MAX
} from './constants.js';
import { state } from './state.js';
import { clamp } from './util.js';
import {
  getActiveTeam, pushUndo, persistDebounced, connectorLength, horizontalGap, savePhotosHiddenPref
} from './model.js';
import { renderChart } from './render.js';
import { closeActiveEditors } from './editors.js';

// ---- Zoom / pan ----
// The scale fit-to-view currently renders at (used as the +/- starting point).
export function currentFitScale() {
  var svg = document.getElementById('chart-svg');
  var wrap = document.getElementById('canvas-wrap');
  var vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width || !vb.height) return 1;
  var wrapRect = wrap.getBoundingClientRect();
  if (!wrapRect.width || !wrapRect.height) return 1;
  return Math.min(wrapRect.width / vb.width, wrapRect.height / vb.height);
}

export function updateZoomLabel() {
  var label = document.getElementById('zoom-fit-btn');
  if (!label) return;
  label.textContent = state.zoomLevel === null ? 'Fit' : Math.round(state.zoomLevel * 100) + '%';
}

export function setZoom(newLevel) {
  var team = getActiveTeam();
  if (!team || !team.rootId) return; // nothing to zoom
  state.zoomLevel = newLevel === null ? null : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newLevel));
  renderChart();
  updateZoomLabel();
}

// The scale the chart is actually rendered at right now.
export function effectiveScale() { return state.zoomLevel === null ? currentFitScale() : state.zoomLevel; }

// Zoom so the slide point under (clientX, clientY) stays put. Falls back to
// centered fit-to-view when zooming out to (or below) the fit scale.
export function zoomAtPoint(newScale, clientX, clientY) {
  var team = getActiveTeam();
  if (!team || !team.rootId) return;
  var svg = document.getElementById('chart-svg');
  var wrap = document.getElementById('canvas-wrap');
  var wrapRect = wrap.getBoundingClientRect();
  var fitScale = currentFitScale();
  newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));

  if (newScale <= fitScale + 0.0001) { setZoom(null); return; }

  var slideW = +svg.getAttribute('width') || 1;
  var slideH = +svg.getAttribute('height') || 1;
  var oldScale = effectiveScale();
  var oldW = slideW * oldScale, oldH = slideH * oldScale;

  var contentLeft, contentTop;
  if (state.zoomLevel === null) {
    contentLeft = (wrapRect.width - oldW) / 2;
    contentTop = (wrapRect.height - oldH) / 2;
  } else {
    contentLeft = (oldW < wrap.clientWidth ? (wrap.clientWidth - oldW) / 2 : 0) - wrap.scrollLeft;
    contentTop = (oldH < wrap.clientHeight ? (wrap.clientHeight - oldH) / 2 : 0) - wrap.scrollTop;
  }

  var pointerX = clientX - wrapRect.left;
  var pointerY = clientY - wrapRect.top;
  var fx = Math.max(0, Math.min(1, (pointerX - contentLeft) / oldW));
  var fy = Math.max(0, Math.min(1, (pointerY - contentTop) / oldH));

  state.zoomLevel = newScale;
  renderChart();
  updateZoomLabel();

  var newW = slideW * newScale, newH = slideH * newScale;
  wrap.scrollLeft = Math.max(0, fx * newW - pointerX);
  wrap.scrollTop = Math.max(0, fy * newH - pointerY);
}

export function viewportCenter() {
  var wrap = document.getElementById('canvas-wrap');
  var r = wrap.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Buttons/keys zoom toward the viewport center (so it doesn't jump to a corner).
export function zoomIn() { var c = viewportCenter(); zoomAtPoint(effectiveScale() + ZOOM_STEP, c.x, c.y); }
export function zoomOut() { var c = viewportCenter(); zoomAtPoint(effectiveScale() - ZOOM_STEP, c.x, c.y); }
export function zoomFit() { setZoom(null); }

// ---- Connector length (vertical gap between levels) — document-level ----
export function setConnectorLength(len, commit) {
  if (!state.doc) return;
  var v = clamp(len, CONNECTOR_LEN_MIN, CONNECTOR_LEN_MAX);
  if (commit && v !== connectorLength()) pushUndo();
  state.doc.connectorLength = v;
  renderChart();
  if (commit) persistDebounced();
}

export function syncConnectorLengthControl() {
  var range = document.getElementById('connector-length-range');
  if (range) range.value = connectorLength();
}

// ---- Horizontal gap between siblings — document-level ----
export function setHorizontalGap(gap, commit) {
  if (!state.doc) return;
  var v = clamp(gap, H_GAP_MIN, H_GAP_MAX);
  if (commit && v !== horizontalGap()) pushUndo();
  state.doc.horizontalGap = v;
  renderChart();
  if (commit) persistDebounced();
}

export function syncHorizontalGapControl() {
  var range = document.getElementById('horizontal-gap-range');
  if (range) range.value = horizontalGap();
}

// ---- Photo visibility toggle (view-only; not saved into the chart document) ----
export function updatePhotosToggleLabel() {
  var btn = document.getElementById('toggle-photos-btn');
  if (btn) btn.textContent = state.photosHidden ? 'Show Photos' : 'Hide Photos';
}

export function togglePhotos() {
  closeActiveEditors();
  state.photosHidden = !state.photosHidden;
  savePhotosHiddenPref();
  updatePhotosToggleLabel();
  renderChart();
}
