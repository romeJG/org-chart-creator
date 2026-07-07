// All pointer/keyboard interaction on the chart SVG: click-to-select/edit, the
// move and resize handle drags, double-click resets, node swap/reparent drag, and
// keyboard shortcuts.

import { SCALE_MIN, SCALE_MAX } from './constants.js';
import { state } from './state.js';
import { clamp, nodeScale, nodeOffX, nodeOffY, getSvgScale } from './util.js';
import {
  getActiveTeam, addChild, deleteNode, selectNode, swapNodes, reparentNode,
  pushUndo, persistDebounced, saveAndRender, undo, redo
} from './model.js';
import { editNodeField, openPhotoEditor, closeActiveEditors } from './editors.js';
import { renderChart } from './render.js';
import { zoomIn, zoomOut, zoomFit } from './viewcontrols.js';
import { exportAllJSON } from './io.js';

export function setupChartInteraction() {
  var svg = document.getElementById('chart-svg');

  svg.addEventListener('click', function (e) {
    if (state.suppressNextClick) { state.suppressNextClick = false; return; }
    if (!e.target.closest) return;
    // A resize/move handle click that didn't turn into a drag: ignore it.
    if (e.target.closest('.resize-handle') || e.target.closest('.move-handle')) return;

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
      if (state.selectedNodeId) { state.selectedNodeId = null; renderChart(); }
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

  // Double-click the move handle to snap the node back to its automatic spot,
  // or the resize handle to snap its scale back to the default.
  svg.addEventListener('dblclick', function (e) {
    if (!e.target.closest) return;
    var team = getActiveTeam();

    var mover = e.target.closest('.move-handle');
    if (mover) {
      var mnode = team && team.nodes[mover.getAttribute('data-node-id')];
      if (!mnode || (!nodeOffX(mnode) && !nodeOffY(mnode))) return;
      pushUndo();
      mnode.offsetX = 0;
      mnode.offsetY = 0;
      saveAndRender();
      return;
    }

    var sizer = e.target.closest('.resize-handle');
    if (sizer) {
      var snode = team && team.nodes[sizer.getAttribute('data-node-id')];
      if (!snode || nodeScale(snode) === 1) return;
      pushUndo();
      snode.scale = 1;
      saveAndRender();
    }
  });

  // Drag a node onto another to swap the two people; hold Shift to move the
  // dragged person (and their reports) under the drop target instead.
  function dragOverClass(mode) { return mode === 'reparent' ? 'drag-over-reparent' : 'drag-over'; }

  svg.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !e.target.closest) return;
    // Move handle: begin a position-nudge drag for this node (+ its subtree).
    var mover = e.target.closest('.move-handle');
    if (mover) {
      var mid = mover.getAttribute('data-node-id');
      var mteam = getActiveTeam();
      var mnode = mteam && mteam.nodes[mid];
      if (mnode) {
        state.moveState = {
          id: mid, startOffX: nodeOffX(mnode), startOffY: nodeOffY(mnode),
          px0: e.clientX, py0: e.clientY, moved: false
        };
        state.suppressNextClick = false;
        e.preventDefault();
      }
      return;
    }
    // Corner resize handle: begin a scale drag (takes priority over node drag).
    var handle = e.target.closest('.resize-handle');
    if (handle) {
      var hid = handle.getAttribute('data-node-id');
      var boxEl = svg.querySelector('.node[data-node-id="' + hid + '"] .node-box');
      var team0 = getActiveTeam();
      var hnode = team0 && team0.nodes[hid];
      if (boxEl && hnode) {
        var br = boxEl.getBoundingClientRect();
        var cxs = br.left + br.width / 2, cys = br.top + br.height / 2;
        state.resizeState = {
          id: hid, startScale: nodeScale(hnode),
          cxs: cxs, cys: cys,
          startDist: Math.max(1, Math.hypot(e.clientX - cxs, e.clientY - cys)),
          px0: e.clientX, py0: e.clientY, moved: false
        };
        state.suppressNextClick = false;
        e.preventDefault();
      }
      return;
    }
    if (e.target.closest('.ui-btn')) return;
    var nodeG = e.target.closest('.node');
    if (!nodeG) return;
    state.suppressNextClick = false;
    state.dragState = { id: nodeG.getAttribute('data-node-id'), g: nodeG, startX: e.clientX, startY: e.clientY, active: false, ghost: null, targetId: null, mode: 'swap' };
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    // Position-nudge drag: convert the on-screen delta to SVG user units.
    if (state.moveState) {
      var ms = state.moveState;
      var mvTeam = getActiveTeam();
      var mvNode = mvTeam && mvTeam.nodes[ms.id];
      if (!mvNode) { state.moveState = null; return; }
      if (!ms.moved) {
        if (Math.abs(e.clientX - ms.px0) + Math.abs(e.clientY - ms.py0) < 3) return;
        ms.moved = true;
        closeActiveEditors();
        pushUndo();
      }
      var sc = getSvgScale() || 1;
      mvNode.offsetX = ms.startOffX + (e.clientX - ms.px0) / sc;
      mvNode.offsetY = ms.startOffY + (e.clientY - ms.py0) / sc;
      renderChart();
      return;
    }

    // Resize (scale) drag.
    if (state.resizeState) {
      var rs = state.resizeState;
      var team = getActiveTeam();
      var node = team && team.nodes[rs.id];
      if (!node) { state.resizeState = null; return; }
      if (!rs.moved) {
        if (Math.abs(e.clientX - rs.px0) + Math.abs(e.clientY - rs.py0) < 3) return;
        rs.moved = true;
        closeActiveEditors();
        pushUndo();
      }
      var dist = Math.hypot(e.clientX - rs.cxs, e.clientY - rs.cys);
      node.scale = clamp(rs.startScale * (dist / rs.startDist), SCALE_MIN, SCALE_MAX);
      renderChart();
      return;
    }

    var d = state.dragState;
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
    var dteam = getActiveTeam();
    var srcNode = dteam && dteam.nodes[d.id];
    var name = srcNode ? (srcNode.name || 'Unnamed') : '';
    d.ghost.textContent = mode === 'reparent' ? ('Move ' + name + ' under…') : ('Swap ' + name);
  });

  document.addEventListener('mouseup', function (e) {
    if (state.moveState) {
      var nudged = state.moveState.moved;
      state.moveState = null;
      if (nudged) { state.suppressNextClick = true; persistDebounced(); }
      return;
    }
    if (state.resizeState) {
      var moved = state.resizeState.moved;
      state.resizeState = null;
      if (moved) { state.suppressNextClick = true; persistDebounced(); }
      return;
    }

    var d = state.dragState;
    if (!d) return;
    state.dragState = null;
    document.body.style.cursor = '';
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.g) d.g.classList.remove('drag-source');
    if (d.targetId) {
      var ng = svg.querySelector('.node[data-node-id="' + d.targetId + '"]');
      if (ng) ng.classList.remove(dragOverClass(d.mode));
    }
    if (d.active) {
      state.suppressNextClick = true; // don't let the trailing click re-open an editor
      if (d.targetId && d.targetId !== d.id) {
        if (e.shiftKey) reparentNode(d.id, d.targetId);
        else swapNodes(d.id, d.targetId);
      }
    }
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    // Ctrl/Cmd+S exports instead of the browser's "Save Page As" dialog.
    if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      closeActiveEditors();
      exportAllJSON();
      return;
    }
    if (state.editingNodeId || state.activePhotoModal) return;
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodeId) {
      e.preventDefault();
      deleteNode(state.selectedNodeId);
    } else if (e.key === 'Escape' && state.selectedNodeId) {
      state.selectedNodeId = null;
      renderChart();
    }
  });
}
