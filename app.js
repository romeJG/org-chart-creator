(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  var SCHEMA_VERSION = 1;
  var STORAGE_KEY = 'org-chart-builder:document:v1';
  var HIDE_PHOTOS_KEY = 'org-chart-builder:hide-photos';
  var DEFAULT_GROUP_TITLE = 'Presales & Solutions Design Group';

  // Node box
  var BOX_W = 300;
  var BOX_H = 88;
  var NAME_LH = 18;
  var TITLE_LH = 15;
  var SPEC_LH = 14;

  // Tree spacing
  var H_GAP = 70;
  var V_GAP = 92;

  // Photo slot (cut-out portrait placed beside/below the box)
  var PHOTO_W = 120;
  var PHOTO_H = 150;
  var PHOTO_SIDE_OVERLAP = 30;  // how far the photo overlaps the box edge
  var PHOTO_RISE = 44;          // how far a side photo rises above the box top
  var SIDE_HANG = PHOTO_W - PHOTO_SIDE_OVERLAP; // room a side photo needs beyond the box edge
  var FOOTPRINT_W = BOX_W + SIDE_HANG * 2;      // per-node layout width, reserving photo room on both sides

  // Slide framing
  var SLIDE_MARGIN = 80;
  var HEADER_H = 40;
  var BRAND_H = 64;
  var MIN_SLIDE_W = 1280;
  var MIN_SLIDE_H = 720;

  // Photo processing
  var PHOTO_OUT_DIM = 400; // cropped output max dimension

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var doc = null;
  var selectedNodeId = null;
  var editingNodeId = null;
  var activeInlineEdit = null;
  var activePhotoModal = null;
  var persistTimer = null;
  var quotaWarned = false;

  // Undo/redo: snapshots of the whole document (JSON strings), captured before
  // each mutation so undo/redo just swap `doc` for a previously-seen snapshot.
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 50;

  // Zoom: null means "fit the chart to the viewport" (the original behavior).
  // A number means a manual zoom multiplier against the chart's native size.
  var zoomLevel = null;
  var ZOOM_STEP = 0.15;
  var ZOOM_MIN = 0.25;
  var ZOOM_MAX = 3;

  // View-only preference (not part of the chart document): hides every photo
  // and tightens the layout to just boxes + connectors. Persisted separately
  // from the document so it isn't bundled into JSON exports.
  var photosHidden = false;

  var measureCanvas = document.createElement('canvas');
  var measureCtx = measureCanvas.getContext('2d');

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
      }
    }
    return e;
  }

  function escapeAttr(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function getInitials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Downscale a data URL so its longest side is at most maxDim, returning a PNG
  // data URL (preserves any transparency). Used to cap photo size in the
  // offline path where Cropper (which normally does the sizing) isn't available.
  function scaleDownDataURL(dataUrl, maxDim, callback) {
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/png'));
    };
    img.onerror = function () { callback(dataUrl); };
    img.src = dataUrl;
  }

  // Knock out a white/near-white background in place on an ImageData.
  // Uses a flood fill seeded from the image edges, so only background that is
  // connected to the border is removed — a white shirt or highlight *inside*
  // the person (not touching an edge) is kept. A soft band near the threshold
  // feathers the cut so hair/edges don't look jagged.
  function knockoutWhiteBackground(imageData) {
    var w = imageData.width, h = imageData.height, px = imageData.data, n = w * h;
    var HARD = 22;  // whiteness <= this -> fully transparent
    var SOFT = 72;  // whiteness <= this -> part of background (connectivity + feather edge)
    var bg = new Uint8Array(n);
    var stack = new Int32Array(n);
    var sp = 0;

    function whiteness(i) {
      var o = i * 4;
      // How far the *darkest* channel is below 255. White -> 0; darker/colored -> higher.
      var m = px[o];
      if (px[o + 1] < m) m = px[o + 1];
      if (px[o + 2] < m) m = px[o + 2];
      return 255 - m;
    }
    function seed(i) { if (!bg[i] && whiteness(i) <= SOFT) { bg[i] = 1; stack[sp++] = i; } }

    var x, y;
    for (x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (y = 0; y < h; y++) { seed(y * w); seed(y * w + (w - 1)); }

    while (sp > 0) {
      var i = stack[--sp];
      var ix = i % w, iy = (i - ix) / w;
      if (ix > 0) seed(i - 1);
      if (ix < w - 1) seed(i + 1);
      if (iy > 0) seed(i - w);
      if (iy < h - 1) seed(i + w);
    }

    for (var j = 0; j < n; j++) {
      if (!bg[j]) continue;
      var wv = whiteness(j);
      var o2 = j * 4;
      if (wv <= HARD) {
        px[o2 + 3] = 0;
      } else {
        var a = (wv - HARD) / (SOFT - HARD); // 0..1 across the feather band
        px[o2 + 3] = Math.round(a * px[o2 + 3]);
      }
    }
  }

  // Loads a data URL, removes its white background, returns a PNG data URL
  // (async via callback). Downscales very large sources first so the flood
  // fill stays fast — final org-chart photos are small anyway.
  function removeWhiteBackgroundDataURL(dataUrl, callback) {
    var img = new Image();
    img.onload = function () {
      var maxDim = 1400;
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var data;
      try {
        data = ctx.getImageData(0, 0, w, h);
      } catch (e) { callback(dataUrl); return; }
      knockoutWhiteBackground(data);
      ctx.putImageData(data, 0, 0);
      callback(canvas.toDataURL('image/png'));
    };
    img.onerror = function () { callback(dataUrl); };
    img.src = dataUrl;
  }

  function sanitizeFilename(name) {
    var cleaned = String(name || 'team').trim()
      .replace(/[^a-z0-9-_ ]/gi, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    return cleaned || 'team';
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var lines = [];
    var current = '';
    var i = 0;
    while (i < words.length && lines.length < maxLines) {
      var word = words[i];
      var test = current ? current + ' ' + word : word;
      if (!current || ctx.measureText(test).width <= maxWidth) {
        current = test;
        i++;
      } else {
        lines.push(current);
        current = '';
      }
    }
    if (current) lines.push(current);
    if (i < words.length) {
      var last = lines[lines.length - 1] || '';
      while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = last.replace(/\s+$/, '') + '…';
    }
    return lines;
  }

  function downloadBlob(content, mime, filename) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadJSON(obj, filename) {
    downloadBlob(JSON.stringify(obj, null, 2), 'application/json', filename);
  }

  // ---------------------------------------------------------------------
  // Data model
  // ---------------------------------------------------------------------
  function createEmptyDocument() {
    var teamId = uuid();
    return {
      version: SCHEMA_VERSION,
      title: DEFAULT_GROUP_TITLE,
      activeTeamId: teamId,
      teams: [{ id: teamId, name: 'Unit 1', rootId: null, nodes: {} }]
    };
  }

  function newNode(parentId) {
    var id = uuid();
    return { id: id, parentId: parentId, name: 'New Person', title: 'Title', specialties: '', photo: null, childIds: [] };
  }

  function getActiveTeam() {
    if (!doc || !doc.teams) return null;
    for (var i = 0; i < doc.teams.length; i++) {
      if (doc.teams[i].id === doc.activeTeamId) return doc.teams[i];
    }
    return null;
  }

  function migrateIfNeeded(payload) {
    // No-op for schema version 1. Future schema changes upgrade `payload` in place here.
  }

  var TRANSIENT_KEYS = ['_x', '_y', '_subtreeWidth', '_depth', '_photoSide', '_photoRect'];
  function stripTransient(team) {
    var clone = JSON.parse(JSON.stringify(team));
    if (clone.nodes) {
      Object.keys(clone.nodes).forEach(function (id) {
        TRANSIENT_KEYS.forEach(function (k) { delete clone.nodes[id][k]; });
      });
    }
    delete clone._layoutBounds;
    return clone;
  }

  // ---------------------------------------------------------------------
  // Undo / redo (whole-document snapshots)
  // ---------------------------------------------------------------------
  function snapshotDoc() {
    return JSON.stringify({
      version: doc.version,
      title: doc.title,
      activeTeamId: doc.activeTeamId,
      teams: doc.teams.map(stripTransient)
    });
  }

  function restoreSnapshot(json) {
    var parsed = JSON.parse(json);
    doc.version = parsed.version;
    doc.title = parsed.title;
    doc.activeTeamId = parsed.activeTeamId;
    doc.teams = parsed.teams;
  }

  // Call before any mutation to doc/team state so it can be undone.
  function pushUndo() {
    if (!doc) return;
    undoStack.push(snapshotDoc());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    var u = document.getElementById('undo-btn');
    var r = document.getElementById('redo-btn');
    if (u) u.disabled = undoStack.length === 0;
    if (r) r.disabled = redoStack.length === 0;
  }

  function undo() {
    if (!undoStack.length) return;
    closeActiveEditors();
    redoStack.push(snapshotDoc());
    restoreSnapshot(undoStack.pop());
    selectedNodeId = null;
    saveAndRenderAll();
    updateUndoRedoButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    closeActiveEditors();
    undoStack.push(snapshotDoc());
    restoreSnapshot(redoStack.pop());
    selectedNodeId = null;
    saveAndRenderAll();
    updateUndoRedoButtons();
  }

  // ---------------------------------------------------------------------
  // Persistence (localStorage autosave)
  // ---------------------------------------------------------------------
  function persist() {
    try {
      var payload = {
        version: doc.version,
        title: doc.title,
        activeTeamId: doc.activeTeamId,
        teams: doc.teams.map(stripTransient)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      quotaWarned = false;
    } catch (e) {
      console.warn('Autosave failed:', e);
      // Photos are embedded as base64, so a photo-heavy chart can exceed the
      // browser's localStorage quota. Warn once (not on every debounced write)
      // so the user knows to export rather than assume it's safely saved.
      if (!quotaWarned) {
        quotaWarned = true;
        alert('Your browser\'s storage is full, so this change could not be autosaved.\n\n' +
          'Use "Export All Units (JSON)" now to save your work, or remove some photos to free up space.');
      }
    }
  }

  function persistDebounced() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 500);
  }

  function loadPhotosHiddenPref() {
    try { photosHidden = localStorage.getItem(HIDE_PHOTOS_KEY) === '1'; } catch (e) { photosHidden = false; }
  }

  function savePhotosHiddenPref() {
    try { localStorage.setItem(HIDE_PHOTOS_KEY, photosHidden ? '1' : '0'); } catch (e) {}
  }

  function loadFromStorage() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) { doc = createEmptyDocument(); return; }
    try {
      var parsed = JSON.parse(raw);
      migrateIfNeeded(parsed);
      if (!parsed.teams || !parsed.teams.length) throw new Error('empty document');
      if (!parsed.title) parsed.title = DEFAULT_GROUP_TITLE;
      doc = parsed;
    } catch (e) {
      console.error('Corrupt autosave data, starting fresh', e);
      doc = createEmptyDocument();
    }
  }

  // ---------------------------------------------------------------------
  // Layout algorithm
  // ---------------------------------------------------------------------
  // Leaf footprint: full width (box + room for the photo to hang past its edges)
  // when photos are showing, or just the box when they're hidden — so hiding
  // photos actually tightens the chart instead of leaving empty gaps.
  function currentFootprintW() { return photosHidden ? BOX_W : FOOTPRINT_W; }

  function computeSubtreeWidth(nodeId, nodes) {
    var node = nodes[nodeId];
    if (!node.childIds.length) {
      node._subtreeWidth = currentFootprintW();
      return node._subtreeWidth;
    }
    var total = 0;
    node.childIds.forEach(function (cid, i) {
      total += computeSubtreeWidth(cid, nodes);
      if (i > 0) total += H_GAP;
    });
    node._subtreeWidth = Math.max(currentFootprintW(), total);
    return node._subtreeWidth;
  }

  // Decide each node's photo side up front (independent of positions).
  // A peer row alternates left/right by position; a lone child alternates by depth
  // so the vertical spine zig-zags like the reference deck.
  function assignPhotoSides(nodeId, nodes, depth, siblingCount) {
    var node = nodes[nodeId];
    node._depth = depth;
    var idx = 0;
    if (node.parentId != null) idx = nodes[node.parentId].childIds.indexOf(nodeId);
    node._photoSide = (siblingCount > 1)
      ? (idx % 2 === 0 ? 'left' : 'right')
      : (depth % 2 === 0 ? 'left' : 'right');
    node.childIds.forEach(function (cid) {
      assignPhotoSides(cid, nodes, depth + 1, node.childIds.length);
    });
  }

  function assignPositions(nodeId, nodes, leftEdge, depth) {
    var node = nodes[nodeId];
    node._depth = depth;
    node._y = depth * (BOX_H + V_GAP);
    if (!node.childIds.length) {
      node._x = leftEdge + node._subtreeWidth / 2;
      return;
    }
    var childrenTotalWidth = 0;
    node.childIds.forEach(function (cid, i) {
      childrenTotalWidth += nodes[cid]._subtreeWidth;
      if (i > 0) childrenTotalWidth += H_GAP;
    });
    var cursor = leftEdge + (node._subtreeWidth - childrenTotalWidth) / 2;
    node.childIds.forEach(function (cid) {
      assignPositions(cid, nodes, cursor, depth + 1);
      cursor += nodes[cid]._subtreeWidth + H_GAP;
    });
    var first = nodes[node.childIds[0]];
    var last = nodes[node.childIds[node.childIds.length - 1]];
    node._x = (first._x + last._x) / 2;
  }

  function photoRectFor(node) {
    var boxLeft = node._x - BOX_W / 2;
    var boxRight = node._x + BOX_W / 2;
    var y = node._y - PHOTO_RISE;
    if (node._photoSide === 'left') {
      return { x: boxLeft - (PHOTO_W - PHOTO_SIDE_OVERLAP), y: y, w: PHOTO_W, h: PHOTO_H };
    }
    return { x: boxRight - PHOTO_SIDE_OVERLAP, y: y, w: PHOTO_W, h: PHOTO_H }; // right
  }

  // Runs layout, decides each node's photo placement, and returns content extents.
  function layoutAndMeasure(team) {
    computeSubtreeWidth(team.rootId, team.nodes);
    assignPositions(team.rootId, team.nodes, 0, 0);
    assignPhotoSides(team.rootId, team.nodes, 0, 1);

    var ids = Object.keys(team.nodes);
    ids.forEach(function (id) { team.nodes[id]._photoRect = photoRectFor(team.nodes[id]); });

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var n = team.nodes[id];
      var pr = n._photoRect;
      minX = Math.min(minX, n._x - BOX_W / 2, photosHidden ? Infinity : pr.x);
      maxX = Math.max(maxX, n._x + BOX_W / 2, photosHidden ? -Infinity : pr.x + pr.w);
      minY = Math.min(minY, n._y, photosHidden ? Infinity : pr.y);
      maxY = Math.max(maxY, n._y + BOX_H, photosHidden ? -Infinity : pr.y + pr.h);
    });
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  // ---------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------
  function buildNodeGroup(node, selected) {
    var boxLeft = node._x - BOX_W / 2;
    var boxTop = node._y;
    var g = svgEl('g', { 'class': 'node' + (selected ? ' selected' : ''), 'data-node-id': node.id });

    // Box
    g.appendChild(svgEl('rect', {
      'class': 'node-box', x: boxLeft, y: boxTop, width: BOX_W, height: BOX_H, rx: 2,
      fill: '#d7e3f7', stroke: selected ? '#2f6df6' : '#aebfe0', 'stroke-width': selected ? '3' : '1'
    }));

    // Photo (drawn after the box so it overlaps the edge) — skipped entirely
    // when the "Hide Photos" toggle is on, per the tightened layout above.
    var pr = node._photoRect;
    var photoG = svgEl('g', { 'class': 'node-photo' });
    if (photosHidden) {
      // no-op: leave photoG empty so click-to-edit-photo simply has no target
    } else if (node.photo) {
      var img = svgEl('image', { x: pr.x, y: pr.y, width: pr.w, height: pr.h, preserveAspectRatio: 'xMidYMax meet' });
      img.setAttribute('href', node.photo);
      img.setAttributeNS(XLINK_NS, 'href', node.photo);
      photoG.appendChild(img);
    } else {
      var cx = pr.x + pr.w / 2, cy = pr.y + pr.h - 46, r = 38;
      photoG.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: r, fill: '#153567', stroke: '#4a6ba8', 'stroke-width': '1.5', 'stroke-dasharray': '4 3'
      }));
      var it = svgEl('text', {
        x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': '15', 'font-weight': 'bold',
        'font-family': 'Arial, Helvetica, sans-serif', fill: '#9fb6de'
      });
      it.textContent = getInitials(node.name);
      photoG.appendChild(it);
      var pt = svgEl('text', {
        x: cx, y: cy + r + 15, 'text-anchor': 'middle', 'font-size': '10',
        'font-family': 'Arial, Helvetica, sans-serif', fill: '#9fb6de'
      });
      pt.textContent = '+ Photo';
      photoG.appendChild(pt);
    }
    g.appendChild(photoG);

    // Text block (name / title / specialties), vertically centered in the box
    measureCtx.font = 'bold 15px Arial, Helvetica, sans-serif';
    var nameLines = wrapText(measureCtx, node.name || 'Unnamed', BOX_W - 28, 2);
    measureCtx.font = '12px Arial, Helvetica, sans-serif';
    var titleLines = node.title ? wrapText(measureCtx, node.title, BOX_W - 28, 1) : [];
    var specText = node.specialties ? '(' + node.specialties + ')' : '';
    measureCtx.font = 'italic 11px Arial, Helvetica, sans-serif';
    var specLines = specText ? wrapText(measureCtx, specText, BOX_W - 24, 1) : [];

    var showTitle = titleLines.length > 0;
    var showTitlePH = !showTitle && selected;
    var showSpec = specLines.length > 0;
    var showSpecPH = !showSpec && selected;

    var nameH = nameLines.length * NAME_LH;
    var titleH = (showTitle || showTitlePH) ? (4 + TITLE_LH) : 0;
    var specH = (showSpec || showSpecPH) ? (2 + SPEC_LH) : 0;
    var totalH = nameH + titleH + specH;
    var blockTop = boxTop + (BOX_H - totalH) / 2;
    var cx2 = node._x;

    var nameText = svgEl('text', {
      'class': 'node-name', 'text-anchor': 'middle', 'font-weight': 'bold', 'font-size': '15',
      'font-family': 'Arial, Helvetica, sans-serif', fill: '#0c1f45'
    });
    nameLines.forEach(function (line, i) {
      var t = svgEl('tspan', { x: cx2, y: blockTop + NAME_LH * 0.78 + i * NAME_LH });
      t.textContent = line;
      nameText.appendChild(t);
    });
    g.appendChild(nameText);

    var titleY = blockTop + nameH + 4 + TITLE_LH * 0.82;
    if (showTitle) {
      var titleText = svgEl('text', {
        'class': 'node-title', x: cx2, y: titleY, 'text-anchor': 'middle', 'font-size': '12',
        'font-family': 'Arial, Helvetica, sans-serif', fill: '#22375c'
      });
      titleText.textContent = titleLines[0];
      g.appendChild(titleText);
    } else if (showTitlePH) {
      var titlePH = svgEl('text', {
        'class': 'node-title-placeholder', x: cx2, y: titleY, 'text-anchor': 'middle', 'font-size': '12',
        'font-style': 'italic', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#93a7c9'
      });
      titlePH.textContent = '+ add title';
      g.appendChild(titlePH);
    }

    var specY = blockTop + nameH + titleH + 2 + SPEC_LH * 0.82;
    if (showSpec) {
      var specTextEl = svgEl('text', {
        'class': 'node-spec', x: cx2, y: specY, 'text-anchor': 'middle', 'font-size': '11',
        'font-style': 'italic', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#41598a'
      });
      specTextEl.textContent = specLines[0];
      g.appendChild(specTextEl);
    } else if (showSpecPH) {
      var specPH = svgEl('text', {
        'class': 'node-spec-placeholder', x: cx2, y: specY, 'text-anchor': 'middle', 'font-size': '11',
        'font-style': 'italic', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#93a7c9'
      });
      specPH.textContent = '+ add specialties';
      g.appendChild(specPH);
    }

    return g;
  }

  function makeUiBtn(cx, cy, label, action, nodeId, color) {
    var g = svgEl('g', { 'class': 'ui-btn', 'data-action': action, 'data-node-id': nodeId });
    g.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 11, fill: color, stroke: '#ffffff', 'stroke-width': '1.5' }));
    var text = svgEl('text', {
      x: cx, y: cy + 4, 'text-anchor': 'middle', 'font-size': '14', fill: '#ffffff',
      'font-family': 'Arial, Helvetica, sans-serif', style: 'pointer-events:none'
    });
    text.textContent = label;
    g.appendChild(text);
    return g;
  }

  function buildOverlayButtons(node) {
    var boxBottom = node._y + BOX_H, boxRight = node._x + BOX_W / 2, boxLeft = node._x - BOX_W / 2;
    var midY = node._y + BOX_H / 2;
    var buttons = [];
    buttons.push(makeUiBtn(node._x, boxBottom + 18, '+', 'add-below', node.id, '#2563eb'));
    if (node.parentId !== null) {
      var bx = node._photoSide === 'right' ? boxLeft - 18 : boxRight + 18;
      buttons.push(makeUiBtn(bx, midY, '+', 'add-beside', node.id, '#2563eb'));
    }
    buttons.push(makeUiBtn(boxRight, node._y, '×', 'delete', node.id, '#dc2626'));
    return buttons;
  }


  function renderChart() {
    var svg = document.getElementById('chart-svg');
    var placeholder = document.getElementById('empty-placeholder');
    var team = getActiveTeam();

    if (!team) {
      svg.style.display = 'none';
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<p>No units yet.</p><button id="ph-add-team-btn">+ Add a unit</button>';
      document.getElementById('ph-add-team-btn').addEventListener('click', addTeam);
      return;
    }

    if (!team.rootId) {
      svg.style.display = 'none';
      placeholder.style.display = 'flex';
      placeholder.innerHTML = '<p>This unit has no chart yet.</p><button id="ph-add-root-btn">+ Add top person</button>';
      document.getElementById('ph-add-root-btn').addEventListener('click', addRootNode);
      return;
    }

    placeholder.style.display = 'none';
    svg.style.display = 'block';

    var ext = layoutAndMeasure(team);
    var localW = ext.maxX - ext.minX;
    var localH = ext.maxY - ext.minY;
    var slideW = Math.max(MIN_SLIDE_W, Math.ceil(localW + SLIDE_MARGIN * 2));
    var slideH = Math.max(MIN_SLIDE_H, Math.ceil(HEADER_H + localH + BRAND_H + SLIDE_MARGIN));
    var offsetX = Math.round((slideW - localW) / 2 - ext.minX);
    var offsetY = Math.round(HEADER_H - ext.minY);

    svg.setAttribute('width', slideW);
    svg.setAttribute('height', slideH);
    svg.setAttribute('viewBox', '0 0 ' + slideW + ' ' + slideH);
    svg.innerHTML = '';

    var wrap = document.getElementById('canvas-wrap');
    if (zoomLevel === null) {
      // Fit-to-view (default): CSS stretches the SVG to its container, keeping
      // aspect ratio via the viewBox, so nothing ever needs to scroll.
      svg.style.width = '100%';
      svg.style.height = '100%';
      wrap.classList.remove('zoomed');
    } else {
      // Manual zoom: give the SVG an explicit pixel size at that zoom level and
      // let the container scroll, so panning is just native scrolling.
      svg.style.width = (slideW * zoomLevel) + 'px';
      svg.style.height = (slideH * zoomLevel) + 'px';
      wrap.classList.add('zoomed');
    }

    // Background rect (class 'slide-bg' so PNG export can drop it for transparency)
    svg.appendChild(svgEl('rect', { 'class': 'slide-bg', x: 0, y: 0, width: slideW, height: slideH, fill: '#ffffff' }));

    // Tree (offset into the slide body)
    var tree = svgEl('g', { transform: 'translate(' + offsetX + ',' + offsetY + ')' });
    var connectorsLayer = svgEl('g', { id: 'layer-connectors' });
    var nodesLayer = svgEl('g', { id: 'layer-nodes' });
    var overlayLayer = svgEl('g', { id: 'layer-ui-overlay' });

    Object.keys(team.nodes).forEach(function (id) {
      var node = team.nodes[id];
      node.childIds.forEach(function (cid) {
        var child = team.nodes[cid];
        var px = node._x, py = node._y + BOX_H;
        var cx = child._x, cy = child._y;
        var midY = py + V_GAP / 2;
        connectorsLayer.appendChild(svgEl('path', {
          'class': 'connector',
          d: 'M ' + px + ' ' + py + ' L ' + px + ' ' + midY + ' L ' + cx + ' ' + midY + ' L ' + cx + ' ' + cy,
          fill: 'none', stroke: '#8aa0cc', 'stroke-width': '1.5'
        }));
      });
    });

    Object.keys(team.nodes).forEach(function (id) {
      nodesLayer.appendChild(buildNodeGroup(team.nodes[id], id === selectedNodeId));
    });

    if (selectedNodeId && team.nodes[selectedNodeId] && editingNodeId !== selectedNodeId) {
      buildOverlayButtons(team.nodes[selectedNodeId]).forEach(function (b) { overlayLayer.appendChild(b); });
    }

    tree.appendChild(connectorsLayer);
    tree.appendChild(nodesLayer);
    tree.appendChild(overlayLayer);
    svg.appendChild(tree);
  }

  // ---------------------------------------------------------------------
  // Zoom / pan
  // ---------------------------------------------------------------------
  // The scale that fit-to-view is currently rendering at, used as the
  // starting point for +/- so the first click feels like a natural step
  // from whatever the chart happens to be fit to right now.
  function currentFitScale() {
    var svg = document.getElementById('chart-svg');
    var wrap = document.getElementById('canvas-wrap');
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return 1;
    var wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return 1;
    return Math.min(wrapRect.width / vb.width, wrapRect.height / vb.height);
  }

  function updateZoomLabel() {
    var label = document.getElementById('zoom-fit-btn');
    if (!label) return;
    label.textContent = zoomLevel === null ? 'Fit' : Math.round(zoomLevel * 100) + '%';
  }

  function setZoom(newLevel) {
    var team = getActiveTeam();
    if (!team || !team.rootId) return; // nothing to zoom
    zoomLevel = newLevel === null ? null : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newLevel));
    renderChart();
    updateZoomLabel();
  }

  function zoomIn() { setZoom((zoomLevel === null ? currentFitScale() : zoomLevel) + ZOOM_STEP); }
  function zoomOut() { setZoom((zoomLevel === null ? currentFitScale() : zoomLevel) - ZOOM_STEP); }
  function zoomFit() { setZoom(null); }

  // ---------------------------------------------------------------------
  // Photo visibility toggle (view-only; not saved into the chart document)
  // ---------------------------------------------------------------------
  function updatePhotosToggleLabel() {
    var btn = document.getElementById('toggle-photos-btn');
    if (btn) btn.textContent = photosHidden ? 'Show Photos' : 'Hide Photos';
  }

  function togglePhotos() {
    closeActiveEditors();
    photosHidden = !photosHidden;
    savePhotosHiddenPref();
    updatePhotosToggleLabel();
    renderChart();
  }

  // ---------------------------------------------------------------------
  // Node mutations
  // ---------------------------------------------------------------------
  function saveAndRender() {
    persistDebounced();
    renderChart();
  }

  function saveAndRenderAll() {
    persistDebounced();
    renderTabbar();
    renderChart();
  }

  function addRootNode() {
    var team = getActiveTeam();
    if (!team) return;
    pushUndo();
    var node = newNode(null);
    team.nodes[node.id] = node;
    team.rootId = node.id;
    selectedNodeId = node.id;
    saveAndRender();
    editNodeField(node.id, 'name');
  }

  function addChild(nodeId, position) {
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
    selectedNodeId = child.id;
    saveAndRender();
    editNodeField(child.id, 'name');
  }

  // Deletes a single person, keeping everyone else in the chart: their direct
  // reports move up to fill the gap (re-parented to the deleted node's manager).
  // If the deleted node is the root with more than one child, the first child
  // is promoted to root and the rest become that child's reports, since a
  // team can only have one top node.
  function deleteNode(nodeId) {
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
    if (selectedNodeId === nodeId) selectedNodeId = null;
    saveAndRender();
  }

  // ---------------------------------------------------------------------
  // Editing helpers
  // ---------------------------------------------------------------------
  function closeActiveEditors() {
    if (activeInlineEdit) activeInlineEdit.commit();
    if (activePhotoModal) activePhotoModal.close();
  }

  // The chart's SVG is scaled to fit the viewport (viewBox vs. rendered size), so
  // a fixed CSS font-size on the inline-edit input looks oversized whenever the
  // chart is zoomed out. This returns how much smaller/larger on-screen pixels
  // are than the SVG's own user-unit coordinates, so font sizes can match.
  function getSvgScale() {
    var svg = document.getElementById('chart-svg');
    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) return 1;
    return svg.getBoundingClientRect().width / vb.width;
  }

  // Generic inline editor: overlays an <input> exactly over an SVG text element.
  // The input is position:fixed and placed with the target's viewport rect, so
  // no scroll/translate math is needed (it aligns wherever the text currently is).
  // baseFontSize is the font-size (in SVG user units) the target text was drawn
  // with, so the input's on-screen text size matches it at the current zoom.
  function editSvgText(targetEl, value, className, blockId, baseFontSize, onCommit) {
    var r = targetEl.getBoundingClientRect();
    var scale = getSvgScale();
    var input = document.createElement('input');
    input.className = 'inline-edit ' + className;
    input.value = value || '';
    input.style.left = r.left + 'px';
    input.style.top = r.top + 'px';
    // Floors scale with the chart's zoom so the input never balloons past the
    // shrunk node box at small scales (a fixed px floor would overflow it).
    input.style.width = Math.max(r.width, 60 * scale) + 'px';
    input.style.height = Math.max(r.height, 14 * scale) + 'px';
    if (baseFontSize) input.style.fontSize = Math.max(8, baseFontSize * scale) + 'px';
    input.style.lineHeight = 'normal';
    input.style.padding = Math.max(1, 4 * scale) + 'px ' + Math.max(1, 6 * scale) + 'px';
    document.body.appendChild(input);
    input.focus();
    try { input.select(); } catch (e) {}

    editingNodeId = blockId;
    var settled = false;
    function done(commit) {
      if (settled) return;
      settled = true;
      var val = input.value;
      if (input.parentNode) input.parentNode.removeChild(input);
      if (activeInlineEdit && activeInlineEdit._input === input) activeInlineEdit = null;
      editingNodeId = null;
      if (commit) onCommit(val);
      else renderChart();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
    activeInlineEdit = { commit: function () { done(true); }, cancel: function () { done(false); }, _input: input };
  }

  function editNodeField(nodeId, field) {
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

  // ---------------------------------------------------------------------
  // Photo editing (upload + square-free crop; preserves transparency as PNG)
  // ---------------------------------------------------------------------
  function openPhotoEditor(nodeId) {
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

    // originalDataUrl = the un-processed source (from file/drop/paste, or the
    // node's existing photo). displayDataUrl = what's currently shown/cropped,
    // which is the original or its background-removed version. renderToken guards
    // against stale async results when the user toggles/reloads quickly.
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

    // Rebuild the preview from originalDataUrl, applying background removal if the
    // checkbox is ticked. Called after any new source or a checkbox toggle.
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
      if (activePhotoModal && activePhotoModal._backdrop === backdrop) activePhotoModal = null;
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

    // If the node already had a photo, show it (with cropper) right away.
    if (originalDataUrl) refreshDisplay();

    activePhotoModal = { close: close, _backdrop: backdrop };
  }

  // ---------------------------------------------------------------------
  // Chart interaction
  // ---------------------------------------------------------------------
  function selectNode(nodeId) {
    selectedNodeId = nodeId;
    renderChart();
  }

  // Swap two people's details (name/title/specialties/photo) between their seats,
  // leaving the tree structure intact. Used by a plain drag-and-drop.
  function swapNodes(idA, idB) {
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
  function isDescendantOf(candidateId, ancestorId, team) {
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

  // Moves a person (and everyone below them) to report to a new manager,
  // leaving everyone's own details untouched. Used by a Shift+drag.
  function reparentNode(nodeId, newParentId) {
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

  var dragState = null;
  var suppressNextClick = false;

  function setupChartInteraction() {
    var svg = document.getElementById('chart-svg');

    svg.addEventListener('click', function (e) {
      if (suppressNextClick) { suppressNextClick = false; return; }
      if (!e.target.closest) return;

      var btn = e.target.closest('.ui-btn');
      if (btn) {
        var action = btn.getAttribute('data-action');
        var btnNodeId = btn.getAttribute('data-node-id');
        if (action === 'add-below') addChild(btnNodeId, 'below');
        else if (action === 'add-beside') addChild(btnNodeId, 'beside');
        else if (action === 'delete') deleteNode(btnNodeId);
        return;
      }

      var nodeG = e.target.closest('.node');
      if (!nodeG) {
        if (selectedNodeId) { selectedNodeId = null; renderChart(); }
        return;
      }
      var nodeId = nodeG.getAttribute('data-node-id');
      if (e.target.closest('.node-photo')) {
        selectNode(nodeId);
        openPhotoEditor(nodeId);
      } else if (e.target.closest('.node-name')) {
        selectNode(nodeId);
        editNodeField(nodeId, 'name');
      } else if (e.target.closest('.node-title') || e.target.closest('.node-title-placeholder')) {
        selectNode(nodeId);
        editNodeField(nodeId, 'title');
      } else if (e.target.closest('.node-spec') || e.target.closest('.node-spec-placeholder')) {
        selectNode(nodeId);
        editNodeField(nodeId, 'specialties');
      } else {
        selectNode(nodeId);
      }
    });

    // Drag a node onto another to swap the two people; hold Shift to move the
    // dragged person (and their reports) under the drop target instead.
    function dragOverClass(mode) { return mode === 'reparent' ? 'drag-over-reparent' : 'drag-over'; }

    svg.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !e.target.closest) return;
      if (e.target.closest('.ui-btn')) return;
      var nodeG = e.target.closest('.node');
      if (!nodeG) return;
      suppressNextClick = false;
      dragState = { id: nodeG.getAttribute('data-node-id'), g: nodeG, startX: e.clientX, startY: e.clientY, active: false, ghost: null, targetId: null, mode: 'swap' };
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      var d = dragState;
      if (!d) return;
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 6) return;
        d.active = true;
        closeActiveEditors();
        d.g.classList.add('drag-source');
        d.ghost = document.createElement('div');
        d.ghost.className = 'drag-ghost';
        document.body.appendChild(d.ghost);
        document.body.style.cursor = 'grabbing';
      }
      d.ghost.style.left = (e.clientX + 12) + 'px';
      d.ghost.style.top = (e.clientY + 14) + 'px';
      // Hide the ghost so it doesn't intercept the hit-test.
      d.ghost.style.display = 'none';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      d.ghost.style.display = '';
      var tg = el && el.closest ? el.closest('.node') : null;
      var tid = tg ? tg.getAttribute('data-node-id') : null;
      if (tid === d.id) tid = null;
      var mode = e.shiftKey ? 'reparent' : 'swap';
      if (tid !== d.targetId || mode !== d.mode) {
        var old = d.targetId && svg.querySelector('.node[data-node-id="' + d.targetId + '"]');
        if (old) old.classList.remove(dragOverClass(d.mode));
        d.targetId = tid;
        d.mode = mode;
        if (tid) {
          var ng = svg.querySelector('.node[data-node-id="' + tid + '"]');
          if (ng) ng.classList.add(dragOverClass(mode));
        }
      }
      var team = getActiveTeam();
      var srcNode = team && team.nodes[d.id];
      var name = srcNode ? (srcNode.name || 'Unnamed') : '';
      d.ghost.textContent = mode === 'reparent' ? ('Move ' + name + ' under…') : ('Swap ' + name);
    });

    document.addEventListener('mouseup', function (e) {
      var d = dragState;
      if (!d) return;
      dragState = null;
      document.body.style.cursor = '';
      if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      if (d.g) d.g.classList.remove('drag-source');
      if (d.targetId) {
        var ng = svg.querySelector('.node[data-node-id="' + d.targetId + '"]');
        if (ng) ng.classList.remove(dragOverClass(d.mode));
      }
      if (d.active) {
        suppressNextClick = true; // don't let the trailing click re-open an editor
        if (d.targetId && d.targetId !== d.id) {
          if (e.shiftKey) reparentNode(d.id, d.targetId);
          else swapNodes(d.id, d.targetId);
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+S exports instead of triggering the browser's "Save Page As"
      // dialog — checked first, and regardless of focus, so it works even
      // while a text field is being edited (committing that edit first).
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        closeActiveEditors();
        exportAllJSON();
        return;
      }
      if (editingNodeId || activePhotoModal) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo();
      } else if (mod && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y')) {
        e.preventDefault(); redo();
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault(); zoomIn();
      } else if (mod && e.key === '-') {
        e.preventDefault(); zoomOut();
      } else if (mod && e.key === '0') {
        e.preventDefault(); zoomFit();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      } else if (e.key === 'Escape' && selectedNodeId) {
        selectedNodeId = null;
        renderChart();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Tabs (units)
  // ---------------------------------------------------------------------
  function switchTeam(teamId) {
    if (doc.activeTeamId === teamId) return;
    closeActiveEditors();
    doc.activeTeamId = teamId;
    selectedNodeId = null;
    editingNodeId = null;
    zoomLevel = null; // each unit starts fit-to-view; its own chart may be a very different size
    persistDebounced();
    renderTabbar();
    renderChart();
    updateZoomLabel();
  }

  function addTeam() {
    pushUndo();
    var id = uuid();
    doc.teams.push({ id: id, name: 'New Unit', rootId: null, nodes: {} });
    doc.activeTeamId = id;
    selectedNodeId = null;
    saveAndRenderAll();
  }

  function deleteTeam(teamId) {
    var team = null, idx = -1;
    for (var i = 0; i < doc.teams.length; i++) {
      if (doc.teams[i].id === teamId) { team = doc.teams[i]; idx = i; break; }
    }
    if (!team) return;
    if (!confirm('Delete unit "' + team.name + '" and its entire chart? (You can Undo afterward.)')) return;
    pushUndo();
    doc.teams.splice(idx, 1);
    if (doc.activeTeamId === teamId) {
      var next = doc.teams[idx] || doc.teams[idx - 1] || null;
      doc.activeTeamId = next ? next.id : null;
    }
    selectedNodeId = null;
    saveAndRenderAll();
  }

  function startRenamingTab(teamId, labelEl) {
    var team = null;
    for (var i = 0; i < doc.teams.length; i++) {
      if (doc.teams[i].id === teamId) { team = doc.teams[i]; break; }
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

  function renderTabbar() {
    var tabbar = document.getElementById('tabbar');
    tabbar.innerHTML = '';

    doc.teams.forEach(function (team) {
      var tab = document.createElement('div');
      tab.className = 'tab' + (team.id === doc.activeTeamId ? ' active' : '');
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

  // ---------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------
  function exportTeamJSON() {
    var team = getActiveTeam();
    if (!team) { alert('No active unit to export.'); return; }
    var payload = { schemaKind: 'org-chart-team', schemaVersion: SCHEMA_VERSION, team: stripTransient(team) };
    downloadJSON(payload, sanitizeFilename(team.name) + '-org-chart.json');
  }

  function exportAllJSON() {
    if (!doc.teams.length) { alert('No units to export.'); return; }
    var payload = {
      schemaKind: 'org-chart-document',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      title: doc.title,
      teams: doc.teams.map(stripTransient),
      activeTeamId: doc.activeTeamId
    };
    downloadJSON(payload, 'org-chart-all-units.json');
  }

  function exportPNG() {
    var team = getActiveTeam();
    if (!team || !team.rootId) { alert('Nothing to export yet — add at least one person first.'); return; }

    // Render a clean frame (no selection highlight, no +/× overlay, no placeholders).
    var savedSel = selectedNodeId;
    selectedNodeId = null;
    closeActiveEditors();
    renderChart();

    var svg = document.getElementById('chart-svg');
    var clone = svg.cloneNode(true);
    var overlay = clone.querySelector('#layer-ui-overlay');
    if (overlay) overlay.remove();
    // Drop the background rects so the exported PNG is transparent.
    Array.prototype.forEach.call(clone.querySelectorAll('.slide-bg'), function (el) { el.remove(); });
    clone.setAttribute('xmlns', SVG_NS);

    var fullW = +svg.getAttribute('width');
    var fullH = +svg.getAttribute('height');

    var svgString = new XMLSerializer().serializeToString(clone);
    var svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    // Restore the interactive selection now that the frame is captured.
    selectedNodeId = savedSel;
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

  function exportSVG() {
    var team = getActiveTeam();
    if (!team || !team.rootId) { alert('Nothing to export yet — add at least one person first.'); return; }

    // Render a clean frame (no selection highlight, no +/× overlay, no placeholders).
    var savedSel = selectedNodeId;
    selectedNodeId = null;
    closeActiveEditors();
    renderChart();

    var svg = document.getElementById('chart-svg');
    var clone = svg.cloneNode(true);
    var overlay = clone.querySelector('#layer-ui-overlay');
    if (overlay) overlay.remove();
    // Drop the background rect so the exported SVG is transparent, matching PNG export.
    Array.prototype.forEach.call(clone.querySelectorAll('.slide-bg'), function (el) { el.remove(); });
    clone.setAttribute('xmlns', SVG_NS);
    // The live element may carry an inline pixel size from manual zoom; strip
    // that so the standalone file uses its natural (viewBox) dimensions.
    clone.removeAttribute('style');
    clone.setAttribute('width', svg.getAttribute('width'));
    clone.setAttribute('height', svg.getAttribute('height'));

    var svgString = new XMLSerializer().serializeToString(clone);

    // Restore the interactive selection now that the frame is captured.
    selectedNodeId = savedSel;
    renderChart();

    downloadBlob(svgString, 'image/svg+xml', sanitizeFilename(team.name) + '-org-chart.svg');
  }

  function importJSON(file) {
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
        doc.teams = parsed.teams || [];
        doc.title = parsed.title || doc.title;
        doc.activeTeamId = parsed.activeTeamId || (doc.teams[0] && doc.teams[0].id) || null;
      } else if (parsed.schemaKind === 'org-chart-team' && parsed.team) {
        pushUndo();
        migrateIfNeeded(parsed);
        var newTeam = parsed.team;
        newTeam.id = uuid();
        var existingNames = doc.teams.map(function (t) { return t.name; });
        if (existingNames.indexOf(newTeam.name) !== -1) newTeam.name = newTeam.name + ' (imported)';
        doc.teams.push(newTeam);
        doc.activeTeamId = newTeam.id;
      } else {
        alert('Unrecognized file format. Expected a JSON file exported from this tool.');
        return;
      }

      closeActiveEditors();
      selectedNodeId = null;
      editingNodeId = null;
      saveAndRenderAll();
    };
    reader.readAsText(file);
  }

  function setupToolbar() {
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
    document.getElementById('zoom-fit-btn').addEventListener('click', zoomFit);
    document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
    document.getElementById('toggle-photos-btn').addEventListener('click', togglePhotos);
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

    // Ctrl/Cmd + scroll wheel zooms (mirrors pinch-zoom on trackpads); plain
    // scroll is left alone so it still pans a manually-zoomed, scrollable chart.
    document.getElementById('canvas-wrap').addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var base = zoomLevel === null ? currentFitScale() : zoomLevel;
      setZoom(base + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
    }, { passive: false });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  window.addEventListener('beforeunload', function () { persist(); });

  function init() {
    loadFromStorage();
    loadPhotosHiddenPref();
    setupToolbar();
    setupChartInteraction();
    renderTabbar();
    renderChart();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
