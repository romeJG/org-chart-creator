// SVG rendering: builds node groups, the selection overlay (add/delete/move/resize
// handles), connectors, and the full chart frame. renderChart() fully rebuilds the
// SVG from state on every call — simple and fast at chart scale.

import {
  BOX_W, BOX_H, NAME_LH, TITLE_LH, SPEC_LH, XLINK_NS,
  SLIDE_MARGIN, HEADER_H, BRAND_H, MIN_SLIDE_W, MIN_SLIDE_H
} from './constants.js';
import { state } from './state.js';
import { svgEl, nodeScale, getInitials, wrapText, measureCtx } from './util.js';
import { layoutAndMeasure } from './layout.js';
import { getActiveTeam, addRootNode } from './model.js';
import { addTeam } from './tabs.js';

function buildNodeGroup(node, selected) {
  var s = nodeScale(node);
  var boxW = BOX_W * s, boxH = BOX_H * s;
  var boxLeft = node._x - boxW / 2;
  var boxTop = node._y;
  var nameLH = NAME_LH * s, titleLH = TITLE_LH * s, specLH = SPEC_LH * s;
  var nameFS = 15 * s, titleFS = 12 * s, specFS = 11 * s;
  var g = svgEl('g', { 'class': 'node' + (selected ? ' selected' : ''), 'data-node-id': node.id });

  // Box
  g.appendChild(svgEl('rect', {
    'class': 'node-box', x: boxLeft, y: boxTop, width: boxW, height: boxH, rx: 2 * s,
    fill: '#d7e3f7', stroke: selected ? '#2f6df6' : '#aebfe0', 'stroke-width': (selected ? 3 : 1) * s
  }));

  // Photo (drawn after the box so it overlaps the edge) — skipped when hidden.
  var pr = node._photoRect;
  var photoG = svgEl('g', { 'class': 'node-photo' });
  if (state.photosHidden) {
    // no-op: leave photoG empty so click-to-edit-photo simply has no target
  } else if (node.photo) {
    var img = svgEl('image', { x: pr.x, y: pr.y, width: pr.w, height: pr.h, preserveAspectRatio: 'xMidYMax meet' });
    img.setAttribute('href', node.photo);
    img.setAttributeNS(XLINK_NS, 'href', node.photo);
    photoG.appendChild(img);
  } else {
    var cx = pr.x + pr.w / 2, cy = pr.y + pr.h - 46 * s, r = 38 * s;
    photoG.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: '#153567', stroke: '#4a6ba8', 'stroke-width': 1.5 * s, 'stroke-dasharray': (4 * s) + ' ' + (3 * s)
    }));
    var it = svgEl('text', {
      x: cx, y: cy + 5 * s, 'text-anchor': 'middle', 'font-size': 15 * s, 'font-weight': 'bold',
      'font-family': 'Arial, Helvetica, sans-serif', fill: '#9fb6de'
    });
    it.textContent = getInitials(node.name);
    photoG.appendChild(it);
    var pt = svgEl('text', {
      x: cx, y: cy + r + 15 * s, 'text-anchor': 'middle', 'font-size': 10 * s,
      'font-family': 'Arial, Helvetica, sans-serif', fill: '#9fb6de'
    });
    pt.textContent = '+ Photo';
    photoG.appendChild(pt);
  }
  g.appendChild(photoG);

  // Text block (name / title / specialties), vertically centered in the box
  measureCtx.font = 'bold ' + nameFS + 'px Arial, Helvetica, sans-serif';
  var nameLines = wrapText(measureCtx, node.name || 'Unnamed', boxW - 28 * s, 2);
  measureCtx.font = titleFS + 'px Arial, Helvetica, sans-serif';
  var titleLines = node.title ? wrapText(measureCtx, node.title, boxW - 28 * s, 1) : [];
  var specText = node.specialties ? '(' + node.specialties + ')' : '';
  measureCtx.font = 'italic ' + specFS + 'px Arial, Helvetica, sans-serif';
  var specLines = specText ? wrapText(measureCtx, specText, boxW - 24 * s, 1) : [];

  var showTitle = titleLines.length > 0;
  var showTitlePH = !showTitle && selected;
  var showSpec = specLines.length > 0;
  var showSpecPH = !showSpec && selected;

  var nameH = nameLines.length * nameLH;
  var titleH = (showTitle || showTitlePH) ? (4 * s + titleLH) : 0;
  var specH = (showSpec || showSpecPH) ? (2 * s + specLH) : 0;
  var totalH = nameH + titleH + specH;
  var blockTop = boxTop + (boxH - totalH) / 2;
  var cx2 = node._x;

  var nameText = svgEl('text', {
    'class': 'node-name', 'text-anchor': 'middle', 'font-weight': 'bold', 'font-size': nameFS,
    'font-family': 'Arial, Helvetica, sans-serif', fill: '#0c1f45'
  });
  nameLines.forEach(function (line, i) {
    var t = svgEl('tspan', { x: cx2, y: blockTop + nameLH * 0.78 + i * nameLH });
    t.textContent = line;
    nameText.appendChild(t);
  });
  g.appendChild(nameText);

  var titleY = blockTop + nameH + 4 * s + titleLH * 0.82;
  if (showTitle) {
    var titleText = svgEl('text', {
      'class': 'node-title', x: cx2, y: titleY, 'text-anchor': 'middle', 'font-size': titleFS,
      'font-family': 'Arial, Helvetica, sans-serif', fill: '#22375c'
    });
    titleText.textContent = titleLines[0];
    g.appendChild(titleText);
  } else if (showTitlePH) {
    var titlePH = svgEl('text', {
      'class': 'node-title-placeholder', x: cx2, y: titleY, 'text-anchor': 'middle', 'font-size': titleFS,
      'font-style': 'italic', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#93a7c9'
    });
    titlePH.textContent = '+ add title';
    g.appendChild(titlePH);
  }

  var specY = blockTop + nameH + titleH + 2 * s + specLH * 0.82;
  if (showSpec) {
    var specTextEl = svgEl('text', {
      'class': 'node-spec', x: cx2, y: specY, 'text-anchor': 'middle', 'font-size': specFS,
      'font-style': 'italic', 'font-family': 'Arial, Helvetica, sans-serif', fill: '#41598a'
    });
    specTextEl.textContent = specLines[0];
    g.appendChild(specTextEl);
  } else if (showSpecPH) {
    var specPH = svgEl('text', {
      'class': 'node-spec-placeholder', x: cx2, y: specY, 'text-anchor': 'middle', 'font-size': specFS,
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
  var s = nodeScale(node);
  var boxW = BOX_W * s, boxH = BOX_H * s;
  var boxBottom = node._y + boxH, boxRight = node._x + boxW / 2, boxLeft = node._x - boxW / 2;
  var midY = node._y + boxH / 2;
  var buttons = [];
  buttons.push(makeUiBtn(node._x, boxBottom + 18, '+', 'add-below', node.id, '#2563eb'));
  if (node.parentId !== null) {
    var bx = node._photoSide === 'right' ? boxLeft - 18 : boxRight + 18;
    buttons.push(makeUiBtn(bx, midY, '+', 'add-beside', node.id, '#2563eb'));
  }
  buttons.push(makeUiBtn(boxRight, node._y, '×', 'delete', node.id, '#dc2626'));

  // Move handle at the box's top-left corner: drag to nudge this person (and
  // their subtree); double-click to snap back. In the ui-overlay layer, so it's
  // excluded from PNG/SVG export.
  var mg = svgEl('g', { 'class': 'move-handle', 'data-node-id': node.id });
  mg.appendChild(svgEl('circle', { cx: boxLeft, cy: node._y, r: 11, fill: '#475569', stroke: '#ffffff', 'stroke-width': '1.5' }));
  mg.appendChild(svgEl('path', {
    d: 'M ' + boxLeft + ' ' + (node._y - 6) + ' L ' + boxLeft + ' ' + (node._y + 6) +
       ' M ' + (boxLeft - 6) + ' ' + node._y + ' L ' + (boxLeft + 6) + ' ' + node._y +
       ' M ' + (boxLeft - 3) + ' ' + (node._y - 3) + ' L ' + boxLeft + ' ' + (node._y - 6) + ' L ' + (boxLeft + 3) + ' ' + (node._y - 3) +
       ' M ' + (boxLeft - 3) + ' ' + (node._y + 3) + ' L ' + boxLeft + ' ' + (node._y + 6) + ' L ' + (boxLeft + 3) + ' ' + (node._y + 3) +
       ' M ' + (boxLeft - 3) + ' ' + (node._y - 3) + ' L ' + (boxLeft - 6) + ' ' + node._y + ' L ' + (boxLeft - 3) + ' ' + (node._y + 3) +
       ' M ' + (boxLeft + 3) + ' ' + (node._y - 3) + ' L ' + (boxLeft + 6) + ' ' + node._y + ' L ' + (boxLeft + 3) + ' ' + (node._y + 3),
    stroke: '#ffffff', 'stroke-width': '1.2', fill: 'none', 'stroke-linejoin': 'round', style: 'pointer-events:none'
  }));
  buttons.push(mg);

  // Resize handle at the box's bottom-right corner: drag to scale the whole person.
  var hg = svgEl('g', { 'class': 'resize-handle', 'data-node-id': node.id });
  hg.appendChild(svgEl('rect', {
    x: boxRight - 7, y: boxBottom - 7, width: 14, height: 14, rx: 3,
    fill: '#2f6df6', stroke: '#ffffff', 'stroke-width': '1.5'
  }));
  hg.appendChild(svgEl('path', {
    d: 'M ' + (boxRight - 2) + ' ' + (boxBottom + 2) + ' L ' + (boxRight + 2) + ' ' + (boxBottom - 2) +
       ' M ' + (boxRight - 4) + ' ' + (boxBottom + 4) + ' L ' + (boxRight + 4) + ' ' + (boxBottom - 4),
    stroke: '#ffffff', 'stroke-width': '1.2', fill: 'none', style: 'pointer-events:none'
  }));
  buttons.push(hg);
  return buttons;
}

export function renderChart() {
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
  if (state.zoomLevel === null) {
    // Fit-to-view (default): CSS stretches the SVG to its container.
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.marginLeft = '0';
    svg.style.marginTop = '0';
    wrap.classList.remove('zoomed');
  } else {
    // Manual zoom: explicit pixel size + let the container scroll. Center content
    // smaller than the viewport on an axis; otherwise pin to 0 so scroll reaches
    // every edge.
    var cw = slideW * state.zoomLevel, ch = slideH * state.zoomLevel;
    svg.style.width = cw + 'px';
    svg.style.height = ch + 'px';
    svg.style.marginLeft = cw < wrap.clientWidth ? ((wrap.clientWidth - cw) / 2) + 'px' : '0';
    svg.style.marginTop = ch < wrap.clientHeight ? ((wrap.clientHeight - ch) / 2) + 'px' : '0';
    wrap.classList.add('zoomed');
  }

  // Background rect (class 'slide-bg' so PNG/SVG export can drop it for transparency)
  svg.appendChild(svgEl('rect', { 'class': 'slide-bg', x: 0, y: 0, width: slideW, height: slideH, fill: '#ffffff' }));

  var tree = svgEl('g', { transform: 'translate(' + offsetX + ',' + offsetY + ')' });
  var connectorsLayer = svgEl('g', { id: 'layer-connectors' });
  var nodesLayer = svgEl('g', { id: 'layer-nodes' });
  var overlayLayer = svgEl('g', { id: 'layer-ui-overlay' });

  Object.keys(team.nodes).forEach(function (id) {
    var node = team.nodes[id];
    var py = node._y + BOX_H * nodeScale(node);
    node.childIds.forEach(function (cid) {
      var child = team.nodes[cid];
      var px = node._x;
      var cx = child._x, cy = child._y;
      var midY = (py + cy) / 2; // halfway down the (adjustable) gap
      connectorsLayer.appendChild(svgEl('path', {
        'class': 'connector',
        d: 'M ' + px + ' ' + py + ' L ' + px + ' ' + midY + ' L ' + cx + ' ' + midY + ' L ' + cx + ' ' + cy,
        fill: 'none', stroke: '#8aa0cc', 'stroke-width': '1.5'
      }));
    });
  });

  Object.keys(team.nodes).forEach(function (id) {
    nodesLayer.appendChild(buildNodeGroup(team.nodes[id], id === state.selectedNodeId));
  });

  if (state.selectedNodeId && team.nodes[state.selectedNodeId] && state.editingNodeId !== state.selectedNodeId) {
    buildOverlayButtons(team.nodes[state.selectedNodeId]).forEach(function (b) { overlayLayer.appendChild(b); });
  }

  tree.appendChild(connectorsLayer);
  tree.appendChild(nodesLayer);
  tree.appendChild(overlayLayer);
  svg.appendChild(tree);
}
