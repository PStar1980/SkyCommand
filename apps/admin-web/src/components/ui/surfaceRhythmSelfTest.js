const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand surface rhythm self-test] ${message}`);
  }
}

const cssPath = path.join(__dirname, '..', '..', 'App.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');

assert(
  cssSource.includes('--sky-page-gutter: 1rem;') &&
    cssSource.includes('--sky-surface-gap: 1rem;') &&
    cssSource.includes('--sky-card-radius: 0.38rem;'),
  'The authenticated design system must expose canonical page gutter, surface gap, and restrained card-radius tokens.',
);

assert(
  cssSource.includes('Global page rhythm and card geometry — August 2026 human refinement.') &&
    cssSource.includes('gap: var(--sky-surface-gap);') &&
    cssSource.includes('calc(var(--sky-topbar-height) + var(--sky-page-gutter))') &&
    cssSource.includes('var(--sky-page-gutter)\n    var(--sky-page-gutter);'),
  'Authenticated page content must use one shared gutter on every page edge and one shared gap between top-level surfaces.',
);

assert(
  cssSource.includes('Bootstrap rows are deliberately excluded so their internal gutter math remains intact.') &&
    cssSource.includes('.sky-page-header,') &&
    cssSource.includes('.sky-dashboard-visuals,') &&
    cssSource.includes('.sky-worker-hero,') &&
    cssSource.includes('margin-top: 0 !important;') &&
    cssSource.includes('margin-bottom: 0 !important;'),
  'Top-level page surfaces must surrender legacy Bootstrap margins to the shared page rhythm without breaking Bootstrap row gutters.',
);

assert(
  cssSource.includes(':is(.sky-page-shell, .sky-workflow-history-shell, .sky-functional-history-shell)') &&
    cssSource.includes('flex-direction: column;'),
  'Established page-shell wrappers must inherit the same vertical card rhythm as fragment-based pages.',
);

assert(
  cssSource.includes('Primary page/card surfaces are intentionally almost square') &&
    cssSource.includes('.sky-server-status-card,') &&
    cssSource.includes('.sky-source-card,') &&
    cssSource.includes('.sky-worker-command-card,') &&
    cssSource.includes('border-radius: var(--sky-card-radius);'),
  'Primary and nested card surfaces must share the restrained near-square corner treatment.',
);

assert(
  cssSource.includes('@media (max-width: 768px) {\n  .sky-app-shell-authenticated .sky-main {\n    --sky-page-gutter: 0.85rem;\n    --sky-surface-gap: 0.85rem;'),
  'The global rhythm must remain responsive without reverting to page-specific spacing.',
);

console.log('[SkyCommand] Global surface rhythm self-test passed.');
