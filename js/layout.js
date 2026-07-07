// Tree layout: computes each node's position (_x/_y), photo placement (_photoRect),
// and the overall content extents. Two passes for width then per-depth row tops,
// then manual nudges are applied on top.

import {
  BOX_W, BOX_H, PHOTO_W, PHOTO_H, PHOTO_SIDE_OVERLAP, PHOTO_RISE, FOOTPRINT_W
} from './constants.js';
import { state } from './state.js';
import { nodeScale, nodeOffX, nodeOffY } from './util.js';
import { connectorLength, horizontalGap } from './model.js';

// A node's own footprint width: box + photo hang when photos show, else just the
// box — all times the node's scale so a bigger person reserves more room.
function footprintFor(node) {
  return (state.photosHidden ? BOX_W : FOOTPRINT_W) * nodeScale(node);
}

function computeSubtreeWidth(nodeId, nodes) {
  var node = nodes[nodeId];
  if (!node.childIds.length) {
    node._subtreeWidth = footprintFor(node);
    return node._subtreeWidth;
  }
  var hgap = horizontalGap();
  var total = 0;
  node.childIds.forEach(function (cid, i) {
    total += computeSubtreeWidth(cid, nodes);
    if (i > 0) total += hgap;
  });
  node._subtreeWidth = Math.max(footprintFor(node), total);
  return node._subtreeWidth;
}

// Decide each node's photo side up front. A peer row alternates left/right by
// position; a lone child alternates by depth so the spine zig-zags.
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

// Horizontal-only placement; vertical (_y) is set separately from per-depth row tops.
function assignPositions(nodeId, nodes, leftEdge, depth) {
  var node = nodes[nodeId];
  node._depth = depth;
  if (!node.childIds.length) {
    node._x = leftEdge + node._subtreeWidth / 2;
    return;
  }
  var hgap = horizontalGap();
  var childrenTotalWidth = 0;
  node.childIds.forEach(function (cid, i) {
    childrenTotalWidth += nodes[cid]._subtreeWidth;
    if (i > 0) childrenTotalWidth += hgap;
  });
  var cursor = leftEdge + (node._subtreeWidth - childrenTotalWidth) / 2;
  node.childIds.forEach(function (cid) {
    assignPositions(cid, nodes, cursor, depth + 1);
    cursor += nodes[cid]._subtreeWidth + hgap;
  });
  var first = nodes[node.childIds[0]];
  var last = nodes[node.childIds[node.childIds.length - 1]];
  node._x = (first._x + last._x) / 2;
}

// How far a node's content rises above / drops below its box (photo overhang), scaled.
function contentAbove(node) { return state.photosHidden ? 0 : PHOTO_RISE * nodeScale(node); }
function contentBelow(node) {
  return state.photosHidden ? 0 : Math.max(0, PHOTO_H - PHOTO_RISE - BOX_H) * nodeScale(node);
}

// Sets each node's _y from per-depth row tops. Row height = tallest box in that
// row; the gap between rows = the adjustable connector length, plus photo overhang.
function assignRowYs(team) {
  var ids = Object.keys(team.nodes);
  var boxHMax = {}, aboveMax = {}, belowMax = {}, maxDepth = 0;
  ids.forEach(function (id) {
    var n = team.nodes[id], d = n._depth;
    boxHMax[d] = Math.max(boxHMax[d] || 0, BOX_H * nodeScale(n));
    aboveMax[d] = Math.max(aboveMax[d] || 0, contentAbove(n));
    belowMax[d] = Math.max(belowMax[d] || 0, contentBelow(n));
    if (d > maxDepth) maxDepth = d;
  });
  var gap = connectorLength();
  var top = {}, contentBottom = 0;
  for (var d = 0; d <= maxDepth; d++) {
    var boxTop = (d === 0) ? (aboveMax[0] || 0) : (contentBottom + gap + (aboveMax[d] || 0));
    top[d] = boxTop;
    contentBottom = boxTop + (boxHMax[d] || BOX_H) + (belowMax[d] || 0);
  }
  ids.forEach(function (id) { team.nodes[id]._y = top[team.nodes[id]._depth]; });
}

function photoRectFor(node) {
  var s = nodeScale(node);
  var boxW = BOX_W * s;
  var boxLeft = node._x - boxW / 2;
  var boxRight = node._x + boxW / 2;
  var pw = PHOTO_W * s, ph = PHOTO_H * s;
  var overlap = PHOTO_SIDE_OVERLAP * s;
  var y = node._y - PHOTO_RISE * s;
  if (node._photoSide === 'left') {
    return { x: boxLeft - (pw - overlap), y: y, w: pw, h: ph };
  }
  return { x: boxRight - overlap, y: y, w: pw, h: ph }; // right
}

// Applies each node's manual nudge on top of the automatic layout. Offsets
// accumulate down the tree, so dragging a manager moves their whole subtree.
function applyOffsets(nodeId, nodes, accX, accY) {
  var node = nodes[nodeId];
  accX += nodeOffX(node);
  accY += nodeOffY(node);
  node._x += accX;
  node._y += accY;
  node.childIds.forEach(function (cid) { applyOffsets(cid, nodes, accX, accY); });
}

// Runs layout, decides each node's photo placement, and returns content extents.
export function layoutAndMeasure(team) {
  computeSubtreeWidth(team.rootId, team.nodes);
  assignPositions(team.rootId, team.nodes, 0, 0);
  assignPhotoSides(team.rootId, team.nodes, 0, 1);
  assignRowYs(team);
  applyOffsets(team.rootId, team.nodes, 0, 0);

  var ids = Object.keys(team.nodes);
  ids.forEach(function (id) { team.nodes[id]._photoRect = photoRectFor(team.nodes[id]); });

  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  ids.forEach(function (id) {
    var n = team.nodes[id];
    var pr = n._photoRect;
    var s = nodeScale(n);
    minX = Math.min(minX, n._x - BOX_W * s / 2, state.photosHidden ? Infinity : pr.x);
    maxX = Math.max(maxX, n._x + BOX_W * s / 2, state.photosHidden ? -Infinity : pr.x + pr.w);
    minY = Math.min(minY, n._y, state.photosHidden ? Infinity : pr.y);
    maxY = Math.max(maxY, n._y + BOX_H * s, state.photosHidden ? -Infinity : pr.y + pr.h);
  });
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
}
