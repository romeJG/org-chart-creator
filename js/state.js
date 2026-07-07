// Shared mutable state for the whole app. Modules import this single object and
// read/write its fields, so there is one source of truth (ES module bindings
// can't share a mutable primitive across files, but they can share an object).

export const state = {
  doc: null,
  selectedNodeId: null,
  editingNodeId: null,
  activeInlineEdit: null,
  activePhotoModal: null,
  persistTimer: null,
  quotaWarned: false,

  // Undo/redo: JSON snapshots of the whole document, captured before each mutation.
  undoStack: [],
  redoStack: [],

  // null means "fit the chart to the viewport"; a number is a manual zoom multiplier.
  zoomLevel: null,

  // View-only preference (not part of the chart document).
  photosHidden: false,

  // Transient pointer-drag bookkeeping.
  dragState: null,
  resizeState: null,
  moveState: null,
  suppressNextClick: false
};
