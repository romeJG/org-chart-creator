// Inline text editing (name/title/specialties overlaid as an <input>) and the
// photo editor modal (upload / drag-drop / paste, optional white-bg removal, crop).

import { PHOTO_OUT_DIM } from './constants.js';
import { state } from './state.js';
import {
  escapeAttr, scaleDownDataURL, removeWhiteBackgroundDataURL, nodeScale, getSvgScale
} from './util.js';
import { getActiveTeam, pushUndo, saveAndRender } from './model.js';
import { renderChart } from './render.js';

export function closeActiveEditors() {
  if (state.activeInlineEdit) state.activeInlineEdit.commit();
  if (state.activePhotoModal) state.activePhotoModal.close();
}

// Generic inline editor: overlays an <input> exactly over an SVG text element.
// baseFontSize is the target's font-size in SVG user units, scaled to screen px.
function editSvgText(targetEl, value, className, blockId, baseFontSize, onCommit) {
  var r = targetEl.getBoundingClientRect();
  var scale = getSvgScale();
  var input = document.createElement('input');
  input.className = 'inline-edit ' + className;
  input.value = value || '';
  input.style.left = r.left + 'px';
  input.style.top = r.top + 'px';
  input.style.width = Math.max(r.width, 60 * scale) + 'px';
  input.style.height = Math.max(r.height, 14 * scale) + 'px';
  if (baseFontSize) input.style.fontSize = Math.max(8, baseFontSize * scale) + 'px';
  input.style.lineHeight = 'normal';
  input.style.padding = Math.max(1, 4 * scale) + 'px ' + Math.max(1, 6 * scale) + 'px';
  document.body.appendChild(input);
  input.focus();
  try { input.select(); } catch (e) {}

  state.editingNodeId = blockId;
  var settled = false;
  function done(commit) {
    if (settled) return;
    settled = true;
    var val = input.value;
    if (input.parentNode) input.parentNode.removeChild(input);
    if (state.activeInlineEdit && state.activeInlineEdit._input === input) state.activeInlineEdit = null;
    state.editingNodeId = null;
    if (commit) onCommit(val);
    else renderChart();
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    else if (e.key === 'Escape') { e.preventDefault(); done(false); }
  });
  input.addEventListener('blur', function () { done(true); });
  state.activeInlineEdit = { commit: function () { done(true); }, cancel: function () { done(false); }, _input: input };
}

export function editNodeField(nodeId, field) {
  closeActiveEditors();
  var team = getActiveTeam();
  if (!team) return;
  var node = team.nodes[nodeId];
  if (!node) return;
  var g = document.querySelector('#chart-svg [data-node-id="' + nodeId + '"]');
  if (!g) return;

  var el, value, cls, baseFontSize;
  if (field === 'name') {
    el = g.querySelector('.node-name');
    value = node.name;
    cls = 'inline-edit-name';
    baseFontSize = 15;
  } else if (field === 'title') {
    el = g.querySelector('.node-title') || g.querySelector('.node-title-placeholder');
    value = node.title;
    cls = 'inline-edit-title';
    baseFontSize = 12;
  } else {
    el = g.querySelector('.node-spec') || g.querySelector('.node-spec-placeholder');
    value = node.specialties;
    cls = 'inline-edit-spec';
    baseFontSize = 11;
  }
  if (!el) return;
  baseFontSize *= nodeScale(node); // match the node's on-screen scale

  editSvgText(el, value, cls, nodeId, baseFontSize, function (v) {
    v = v.trim();
    var newValue = field === 'name' ? (v || 'Unnamed') : v;
    if (newValue === (node[field] || '')) return; // no-op edit, skip history noise
    pushUndo();
    if (field === 'name') node.name = newValue;
    else if (field === 'title') node.title = newValue;
    else node.specialties = newValue;
    saveAndRender();
  });
}

// Photo editor (upload + optional white-bg removal + square-free crop).
export function openPhotoEditor(nodeId) {
  closeActiveEditors();
  var team = getActiveTeam();
  if (!team) return;
  var node = team.nodes[nodeId];
  if (!node) return;

  var hasCropper = (typeof Cropper !== 'undefined');

  var backdrop = document.createElement('div');
  backdrop.className = 'photo-modal-backdrop';
  backdrop.innerHTML =
    '<div class="photo-modal">' +
      '<h3>Edit photo</h3>' +
      '<p class="photo-modal-hint">Choose a file, drag &amp; drop, or paste (Ctrl/Cmd+V) an image. For the deck look, use a photo on a plain white background and tick “Remove background”.</p>' +
      '<div class="photo-crop-area">' +
        (node.photo
          ? '<img class="photo-crop-img" src="' + escapeAttr(node.photo) + '">'
          : '<span class="photo-crop-empty">Choose, drop, or paste an image to begin</span>') +
      '</div>' +
      '<label class="pm-removebg-row">' +
        '<input type="checkbox" class="pm-removebg"> Remove white background ' +
        '<span class="pm-removebg-note">(best on a plain white backdrop)</span>' +
      '</label>' +
      '<div class="photo-modal-actions">' +
        '<button type="button" class="pm-choose">Choose image…</button>' +
        '<input type="file" class="pm-file" accept="image/*" style="display:none">' +
        '<span class="spacer"></span>' +
        '<button type="button" class="pm-remove"' + (node.photo ? '' : ' style="display:none"') + '>Remove</button>' +
        '<button type="button" class="pm-cancel">Cancel</button>' +
        '<button type="button" class="pm-save"' + (node.photo ? '' : ' disabled') + '>Save</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(backdrop);

  var area = backdrop.querySelector('.photo-crop-area');
  var fileInput = backdrop.querySelector('.pm-file');
  var chooseBtn = backdrop.querySelector('.pm-choose');
  var removeBtn = backdrop.querySelector('.pm-remove');
  var cancelBtn = backdrop.querySelector('.pm-cancel');
  var saveBtn = backdrop.querySelector('.pm-save');
  var removeBgCheckbox = backdrop.querySelector('.pm-removebg');
  var imgEl = backdrop.querySelector('.photo-crop-img');
  var cropper = null;

  // originalDataUrl = un-processed source; displayDataUrl = what's shown/cropped
  // (original or its bg-removed version). renderToken guards stale async results.
  var originalDataUrl = node.photo || null;
  var displayDataUrl = node.photo || null;
  var renderToken = 0;

  function initCropper() {
    if (!hasCropper || !imgEl) return;
    if (cropper) { cropper.destroy(); cropper = null; }
    cropper = new Cropper(imgEl, {
      viewMode: 1, autoCropArea: 1, background: false, movable: true, zoomable: true, dragMode: 'move'
    });
  }

  function showImage(dataUrl) {
    if (cropper) { cropper.destroy(); cropper = null; }
    displayDataUrl = dataUrl;
    area.classList.add('has-alpha');
    area.classList.remove('photo-crop-processing');
    area.innerHTML = '<img class="photo-crop-img" src="' + escapeAttr(dataUrl) + '">';
    imgEl = area.querySelector('.photo-crop-img');
    saveBtn.disabled = false;
    removeBtn.style.display = '';
    if (hasCropper) {
      if (imgEl.complete) initCropper();
      else imgEl.addEventListener('load', initCropper);
    }
  }

  function showProcessing() {
    if (cropper) { cropper.destroy(); cropper = null; }
    area.classList.remove('has-alpha');
    area.innerHTML = '<span class="photo-crop-processing">Removing background…</span>';
    imgEl = null;
    saveBtn.disabled = true;
  }

  // Rebuild the preview from originalDataUrl, applying bg removal if ticked.
  function refreshDisplay() {
    var token = ++renderToken;
    if (!originalDataUrl) return;
    if (removeBgCheckbox.checked) {
      showProcessing();
      removeWhiteBackgroundDataURL(originalDataUrl, function (out) {
        if (token !== renderToken || !backdrop.parentNode) return; // superseded/closed
        showImage(out);
      });
    } else {
      showImage(originalDataUrl);
    }
  }

  function handleIncomingFile(file) {
    if (!file || !/^image\//.test(file.type || '')) return;
    var reader = new FileReader();
    reader.onload = function () { originalDataUrl = reader.result; refreshDisplay(); };
    reader.onerror = function () { alert('Could not read that image file.'); };
    reader.readAsDataURL(file);
  }

  chooseBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function (e) {
    if (e.target.files[0]) handleIncomingFile(e.target.files[0]);
  });
  removeBgCheckbox.addEventListener('change', refreshDisplay);

  // Drag & drop onto the preview area.
  ['dragenter', 'dragover'].forEach(function (ev) {
    area.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); area.classList.add('drag-over'); });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    area.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); area.classList.remove('drag-over'); });
  });
  area.addEventListener('drop', function (e) {
    e.preventDefault(); e.stopPropagation();
    area.classList.remove('drag-over');
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) handleIncomingFile(dt.files[0]);
  });

  // Clipboard paste (Ctrl/Cmd+V) anywhere while the modal is open.
  function onPaste(e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        var file = items[i].getAsFile();
        if (file) { e.preventDefault(); handleIncomingFile(file); return; }
      }
    }
  }
  document.addEventListener('paste', onPaste);

  function close() {
    document.removeEventListener('paste', onPaste);
    if (cropper) { cropper.destroy(); cropper = null; }
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (state.activePhotoModal && state.activePhotoModal._backdrop === backdrop) state.activePhotoModal = null;
  }

  function applyPhoto(dataUrl) { pushUndo(); node.photo = dataUrl; close(); saveAndRender(); }

  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
  removeBtn.addEventListener('click', function () { pushUndo(); node.photo = null; close(); saveAndRender(); });

  saveBtn.addEventListener('click', function () {
    if (cropper) {
      var canvas = cropper.getCroppedCanvas({ maxWidth: PHOTO_OUT_DIM, maxHeight: PHOTO_OUT_DIM, imageSmoothingQuality: 'high' });
      if (!canvas) return;
      canvas.toBlob(function (blob) {
        if (!blob) { applyPhoto(canvas.toDataURL('image/png')); return; }
        var reader = new FileReader();
        reader.onload = function () { applyPhoto(reader.result); };
        reader.readAsDataURL(blob);
      }, 'image/png');
    } else if (displayDataUrl) {
      // No cropper (offline): the displayed image already has bg removed if
      // ticked; cap its size here since Cropper normally handles that.
      scaleDownDataURL(displayDataUrl, PHOTO_OUT_DIM, function (out) { applyPhoto(out); });
    }
  });

  if (originalDataUrl) refreshDisplay();

  state.activePhotoModal = { close: close, _backdrop: backdrop };
}
