// Entry point: wire the app together and render the initial view.

import { loadFromStorage, loadPhotosHiddenPref, persist } from './model.js';
import { setupToolbar } from './toolbar.js';
import { setupChartInteraction } from './interaction.js';
import { renderTabbar } from './tabs.js';
import { renderChart } from './render.js';

// Flush any pending debounced save before the page closes.
window.addEventListener('beforeunload', function () { persist(); });

function init() {
  loadFromStorage();
  loadPhotosHiddenPref();
  setupToolbar();
  setupChartInteraction();
  renderTabbar();
  renderChart();
}

// Module scripts are deferred; DOMContentLoaded still fires after they evaluate.
document.addEventListener('DOMContentLoaded', init);
