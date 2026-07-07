// Pure helpers: DOM/SVG construction, text/image utilities, downloads, and small
// per-node getters. Nothing here reads app state (except reading a node object
// that's passed in), so this module has no cyclic dependencies.

import { SVG_NS, SCALE_MIN, SCALE_MAX } from './constants.js';

// Offscreen canvas used only to measure text for wrapping.
export const measureCanvas = document.createElement('canvas');
export const measureCtx = measureCanvas.getContext('2d');

export function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function svgEl(tag, attrs) {
  var e = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    }
  }
  return e;
}

export function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getInitials(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Downscale a data URL so its longest side is at most maxDim, returning a PNG
// data URL (preserves any transparency). Used to cap photo size in the offline
// path where Cropper (which normally does the sizing) isn't available.
export function scaleDownDataURL(dataUrl, maxDim, callback) {
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

// Knock out a white/near-white background in place on an ImageData. Uses a flood
// fill seeded from the image edges, so only background connected to the border is
// removed — a white shirt inside the person is kept. A soft band near the
// threshold feathers the cut so hair/edges don't look jagged.
export function knockoutWhiteBackground(imageData) {
  var w = imageData.width, h = imageData.height, px = imageData.data, n = w * h;
  var HARD = 22;  // whiteness <= this -> fully transparent
  var SOFT = 72;  // whiteness <= this -> part of background (connectivity + feather edge)
  var bg = new Uint8Array(n);
  var stack = new Int32Array(n);
  var sp = 0;

  function whiteness(i) {
    var o = i * 4;
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

// Loads a data URL, removes its white background, returns a PNG data URL (async).
export function removeWhiteBackgroundDataURL(dataUrl, callback) {
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

export function sanitizeFilename(name) {
  var cleaned = String(name || 'team').trim()
    .replace(/[^a-z0-9-_ ]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  return cleaned || 'team';
}

export function wrapText(ctx, text, maxWidth, maxLines) {
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

export function downloadBlob(content, mime, filename) {
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

export function downloadJSON(obj, filename) {
  downloadBlob(JSON.stringify(obj, null, 2), 'application/json', filename);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// A node's display scale (defaults to 1 for older/imported data without it).
export function nodeScale(node) {
  var s = node && node.scale;
  return (typeof s === 'number' && s > 0) ? clamp(s, SCALE_MIN, SCALE_MAX) : 1;
}

// Per-node manual nudge away from the automatic layout position.
export function nodeOffX(node) { return (node && typeof node.offsetX === 'number') ? node.offsetX : 0; }
export function nodeOffY(node) { return (node && typeof node.offsetY === 'number') ? node.offsetY : 0; }

// How many on-screen pixels one SVG user unit currently occupies (accounts for
// the viewBox-to-rendered-size scaling), so overlaid inputs match the zoom.
export function getSvgScale() {
  var svg = document.getElementById('chart-svg');
  var vb = svg.viewBox && svg.viewBox.baseVal;
  if (!vb || !vb.width) return 1;
  return svg.getBoundingClientRect().width / vb.width;
}
