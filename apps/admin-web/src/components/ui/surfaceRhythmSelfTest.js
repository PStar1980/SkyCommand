const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand surface rhythm self-test] ${message}`);
  }
}

const cssPath = path.join(__dirname, '..', '..', 'App.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const dashboardFilterSource = fs.readFileSync(path.join(__dirname, 'DashboardFilterCard.jsx'), 'utf8');
const dockerOverviewSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'pages', 'DockerOverview.jsx'),
  'utf8',
);
const commandCenterSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'pages', 'Dashboard.jsx'),
  'utf8',
);

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
  cssSource.includes('.sky-app-shell-authenticated .sky-main.sky-main-workbench {') &&
    cssSource.includes('padding-right: var(--sky-page-gutter);') &&
    !cssSource.includes('.sky-app-shell-authenticated .sky-main.sky-main-workbench {\n  max-width: none;\n  padding-right: 2rem;'),
  'Legacy workbench routes must use the canonical authenticated right-side page gutter instead of retaining the older 2rem exception.',
);

assert(
  cssSource.includes('Dashboard-local outer spacing must not stack on top of the shared page rhythm.') &&
    cssSource.includes(':is(.sky-dashboard-filter-card, .sky-dashboard-surface-row)') &&
    cssSource.includes('margin-bottom: 0 !important;'),
  'Dashboard filter cards and dashboard surface rows must not stack legacy bottom margins on top of the canonical page gap.',
);

assert(
  !commandCenterSource.includes('sky-command-center-page') &&
    commandCenterSource.includes('<ServerStatusPanel') &&
    commandCenterSource.includes('<DashboardVisuals') &&
    commandCenterSource.includes('<ApiObservabilityPanel className="mt-4"'),
  'Command Center must keep its major surfaces as direct page children so canonical surface-gap rules can neutralize legacy mb/mt utilities.',
);

assert(
  !dashboardFilterSource.includes('sky-dashboard-filter-card mb-3') &&
    !dockerOverviewSource.includes('row g-3 mb-3') &&
    (dockerOverviewSource.match(/sky-dashboard-surface-row/g) || []).length >= 3,
  'Dashboard pages must not carry local bottom margins that double the canonical surface gap.',
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
