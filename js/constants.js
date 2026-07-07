// Fixed configuration values shared across the app. No logic, no state.

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'org-chart-builder:document:v1';
export const HIDE_PHOTOS_KEY = 'org-chart-builder:hide-photos';
export const DEFAULT_GROUP_TITLE = 'Presales & Solutions Design Group';

// Node box
export const BOX_W = 300;
export const BOX_H = 88;
export const NAME_LH = 18;
export const TITLE_LH = 15;
export const SPEC_LH = 14;

// Tree spacing
export const H_GAP = 70;
export const V_GAP = 92;

// Photo slot (cut-out portrait placed beside/below the box)
export const PHOTO_W = 120;
export const PHOTO_H = 150;
export const PHOTO_SIDE_OVERLAP = 30;  // how far the photo overlaps the box edge
export const PHOTO_RISE = 44;          // how far a side photo rises above the box top
export const SIDE_HANG = PHOTO_W - PHOTO_SIDE_OVERLAP; // room a side photo needs beyond the box edge
export const FOOTPRINT_W = BOX_W + SIDE_HANG * 2;      // per-node layout width, reserving photo room on both sides

// Slide framing
export const SLIDE_MARGIN = 80;
export const HEADER_H = 40;
export const BRAND_H = 64;
export const MIN_SLIDE_W = 1280;
export const MIN_SLIDE_H = 720;

// Photo processing
export const PHOTO_OUT_DIM = 400; // cropped output max dimension

// Connector line length: vertical gap between a parent's bottom and its
// children's top (document-level, adjustable). Defaults to V_GAP.
export const DEFAULT_CONNECTOR_LEN = V_GAP;
export const CONNECTOR_LEN_MIN = 24;
export const CONNECTOR_LEN_MAX = 260;

// Horizontal gap between sibling subtrees (document-level, adjustable). Negative
// values let neighbors overlap. Defaults to H_GAP.
export const DEFAULT_H_GAP = H_GAP;
export const H_GAP_MIN = -240;
export const H_GAP_MAX = 160;

// Per-node scale, dragged from a node's bottom-right corner handle.
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 3;

// Undo/redo history depth.
export const MAX_UNDO = 50;

// Zoom: null zoomLevel means fit-to-view; a number is a manual multiplier.
export const ZOOM_STEP = 0.15;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 3;

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
