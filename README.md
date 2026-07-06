# Org Chart Builder

A single-page, no-build org chart builder styled after the MEC "Presales & Solutions
Design Group" deck: deep-navy slide, gold serif title, teal unit badge, light-blue
name boxes, and cut-out photos placed beside each box (alternating down the spine,
centered below for branch rows).

Everything is static HTML/CSS/JS — no framework, no build step.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page markup + CDN/asset links |
| `styles.css` | All styling |
| `app.js` | Layout, SVG rendering, editing, import/export |
| `.nojekyll` | Tells GitHub Pages to serve files as-is (no Jekyll) |

The only external dependency is [Cropper.js](https://github.com/fengyuanchen/cropperjs),
loaded from a CDN for the photo-crop step. If it can't load (offline), photo upload
still works without the crop UI.

## Using it

- **Add people:** select a node, then use the **+** (below / beside) and **×** buttons.
- **Edit text:** click a name, title, or specialties line — it becomes an input in place.
- **Edit the group title / unit badge:** click them directly.
- **Photos:** click a node's photo to upload and crop. For the deck look, upload a
  background-removed (transparent PNG) cut-out — transparency is preserved.
- **Units:** each tab is a unit (e.g. "Server Storage Unit"); double-click a tab to rename.
- **Save/share:** work autosaves to this browser's `localStorage`. Use **Export All Units
  (JSON)** to back up or hand off, and **Import JSON** to restore. **Export PNG** renders
  the current slide.

## Run locally

Serve the folder over HTTP (the split JS/CSS won't load from a `file://` URL):

```bash
python3 -m http.server 4321
# then open http://localhost:4321/
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (files at the repo root).
2. In the repo: **Settings → Pages**.
3. Under **Build and deployment**, set **Source = Deploy from a branch**.
4. Choose your branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
5. Wait for the build; your site appears at
   `https://<user>.github.io/<repo>/`.

Because `index.html` is at the root, the site loads directly with no extra config.
Autosave data lives per-browser, so each visitor starts with their own blank document
until they import a JSON.
