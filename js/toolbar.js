// Wires the toolbar buttons/sliders and the Ctrl/Cmd + wheel zoom.

import { ZOOM_STEP } from './constants.js';
import { undo, redo, updateUndoRedoButtons } from './model.js';
import {
  zoomOut, zoomFit, zoomIn, togglePhotos, updatePhotosToggleLabel, updateZoomLabel,
  setConnectorLength, syncConnectorLengthControl, setHorizontalGap, syncHorizontalGapControl,
  effectiveScale, zoomAtPoint
} from './viewcontrols.js';
import { exportTeamJSON, exportAllJSON, exportPNG, exportSVG, importJSON } from './io.js';

export function setupToolbar() {
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);
  document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
  document.getElementById('zoom-fit-btn').addEventListener('click', zoomFit);
  document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
  document.getElementById('toggle-photos-btn').addEventListener('click', togglePhotos);

  var lenRange = document.getElementById('connector-length-range');
  if (lenRange) {
    // Live preview while sliding (no undo spam); commit once on release.
    lenRange.addEventListener('input', function () { setConnectorLength(+lenRange.value, false); });
    lenRange.addEventListener('change', function () { setConnectorLength(+lenRange.value, true); });
  }

  var hgapRange = document.getElementById('horizontal-gap-range');
  if (hgapRange) {
    hgapRange.addEventListener('input', function () { setHorizontalGap(+hgapRange.value, false); });
    hgapRange.addEventListener('change', function () { setHorizontalGap(+hgapRange.value, true); });
  }

  document.getElementById('export-team-json-btn').addEventListener('click', exportTeamJSON);
  document.getElementById('export-all-json-btn').addEventListener('click', exportAllJSON);
  document.getElementById('export-png-btn').addEventListener('click', exportPNG);
  document.getElementById('export-svg-btn').addEventListener('click', exportSVG);

  var fileInput = document.getElementById('import-file-input');
  document.getElementById('import-btn').addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (file) importJSON(file);
    fileInput.value = '';
  });

  updateUndoRedoButtons();
  updateZoomLabel();
  updatePhotosToggleLabel();
  syncConnectorLengthControl();
  syncHorizontalGapControl();

  // Ctrl/Cmd + scroll wheel zooms toward the cursor; plain scroll pans.
  document.getElementById('canvas-wrap').addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    var step = ZOOM_STEP * (e.deltaY > 0 ? -1 : 1);
    zoomAtPoint(effectiveScale() + step, e.clientX, e.clientY);
  }, { passive: false });
}
