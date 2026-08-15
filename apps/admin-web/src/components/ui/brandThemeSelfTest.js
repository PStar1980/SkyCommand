const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Midnight Gold self-test] ${message}`);
  }
}

const cssPath = path.join(__dirname, '..', '..', 'App.css');
const indexCssPath = path.join(__dirname, '..', '..', 'index.css');
const chartThemePath = path.join(__dirname, '..', 'charts', 'chartTheme.js');
const dashboardVisualsPath = path.join(__dirname, '..', 'charts', 'DashboardVisuals.jsx');
const loginPath = path.join(__dirname, '..', '..', 'pages', 'Login.jsx');

const cssSource = fs.readFileSync(cssPath, 'utf8');
const indexCssSource = fs.readFileSync(indexCssPath, 'utf8');
const chartThemeSource = fs.readFileSync(chartThemePath, 'utf8');
const dashboardVisualsSource = fs.readFileSync(dashboardVisualsPath, 'utf8');
const loginSource = fs.readFileSync(loginPath, 'utf8');

assert(
  cssSource.includes('SkyCommand Midnight Gold brand system') &&
    cssSource.includes('--sky-gold: #dcb13f;') &&
    cssSource.includes('--sky-cyan: #65c8ff;') &&
    cssSource.includes('--sky-surface: #05080b;') &&
    cssSource.includes('--sky-border-soft: rgba(220, 177, 63, 0.2);'),
  'The semantic Midnight Gold design tokens must remain available with the neutral-black surface hierarchy.',
);
assert(
  cssSource.includes('border-color: rgba(220, 177, 63, 0.27);') &&
    cssSource.includes('linear-gradient(135deg, rgba(5, 8, 12, 0.94), rgba(2, 5, 8, 0.9))') &&
    cssSource.includes('.sky-page-kicker,') &&
    cssSource.includes('color: #d9bd70;'),
  'Authenticated page cards and structural labels must use the neutral-black and gold-forward treatment.',
);
assert(
  indexCssSource.includes('background: #010203;') &&
    indexCssSource.includes('rgba(220, 177, 63, 0.045)'),
  'The document root must match the authenticated black-gold shell to avoid a blue loading flash.',
);
assert(
  cssSource.includes('background: linear-gradient(135deg, #fff0ae 0%, #e4b83f 52%, #a97016 100%);'),
  'Primary actions must use the metallic gold treatment.',
);
assert(
  cssSource.includes('inset 3px 0 0 var(--sky-gold)') &&
    cssSource.includes('--bs-table-hover-bg: rgba(220, 177, 63, 0.055);') &&
    cssSource.includes('color: #d9bd70;'),
  'Table exploration and selection must use the restrained Midnight Gold hierarchy.',
);
assert(
  cssSource.includes('.sky-form-control:-webkit-autofill') &&
    cssSource.includes('-webkit-box-shadow: 0 0 0 1000px #050b14 inset;'),
  'Browser autofill must preserve the dark branded form surface.',
);
assert(
  cssSource.includes('.sky-workflow-approval-instructions') &&
    cssSource.includes('border-color: rgba(220, 177, 63, 0.34);'),
  'Human approval surfaces must carry the restrained gold importance treatment.',
);
assert(
  loginSource.includes('<h1 className="h3 sky-page-title">SkyCommand</h1>') &&
    loginSource.includes('<div className="sky-login-brand-tagline">Workflow Automation</div>') &&
    !loginSource.includes('Workflow Automation Engine'),
  'The login card must use the product-first SkyCommand / Workflow Automation brand hierarchy.',
);
assert(
  cssSource.includes('width: 5.65rem;') &&
    cssSource.includes('flex: 0 0 5.65rem;') &&
    cssSource.includes('.sky-login-brand-tagline'),
  'The login-card mark must anchor the full branded header with the dedicated tagline treatment.',
);
assert(
  cssSource.includes('width: min(100%, 710px);') &&
    cssSource.includes('font-size: clamp(1.7rem, 2.1vw, 2.08rem);') &&
    cssSource.includes('opacity: 0.27;'),
  'The final login-card polish must preserve the wider terminal, stronger product title, and darker interior.',
);
assert(
  cssSource.includes('.sky-login-access-button::before') &&
    cssSource.includes('transform: translateY(-2px);') &&
    cssSource.includes('0 0 24px rgba(220, 177, 63, 0.09)'),
  'Login support actions must retain their restrained gold hover and focus treatment.',
);
assert(
  cssSource.includes('select.sky-form-control {') &&
    cssSource.includes('color-scheme: dark;') &&
    cssSource.includes("stroke='%23dcb13f'") &&
    cssSource.includes('select.sky-form-control option:checked'),
  'Native selects must retain the dark Midnight Gold surface, branded chevron, and selected-option treatment.',
);
assert(
  cssSource.includes('.sky-topbar-icon-button-message') &&
    cssSource.includes('.sky-topbar-count-badge-muted') &&
    cssSource.includes('linear-gradient(135deg, #fff0ae, #dcb13f 58%, #a97016)') &&
    cssSource.includes('.sky-navbar-dropdown .dropdown-item:hover'),
  'Topbar messages, account actions, and account dropdowns must use the Midnight Gold interaction treatment.',
);
assert(
  cssSource.includes("url('./assets/sky-net-background.png')") &&
    !cssSource.includes("url('./assets/sky-net-background.svg')"),
  'The login and authenticated shells must use the unified organic PNG sky-net background.',
);
assert(
  cssSource.includes('.sky-workflow-visual-node.is-selected {') &&
    cssSource.includes('border-color: rgba(255, 217, 120, 0.9);') &&
    cssSource.includes('outline: 4px solid rgba(255, 217, 120, 0.98);') &&
    cssSource.includes('border: 1px solid rgba(255, 240, 174, 0.9);') &&
    cssSource.includes('box-shadow: 0 18px 48px rgba(220, 177, 63, 0.09);') &&
    !cssSource.includes('outline: 3px solid rgba(84, 202, 255, 0.98);'),
  'Selected workflow nodes must use a thicker gold focus frame rather than the legacy cyan highlight.',
);
assert(
  cssSource.includes('.sky-sidebar-brand-wrap {') &&
    cssSource.includes('border: 1px solid rgba(220, 177, 63, 0.72);') &&
    cssSource.includes('border-radius: 0;') &&
    cssSource.includes('margin: 0;') &&
    cssSource.includes('padding: 0;'),
  'The SkyCommand sidebar branding frame must sit flush against its outer square gold border.',
);

assert(
  cssSource.includes('.sky-sidebar {') &&
    cssSource.includes('border: 1px solid rgba(220, 177, 63, 0.68);') &&
    cssSource.includes('box-sizing: border-box;') &&
    cssSource.includes("background: linear-gradient(180deg, rgba(255, 255, 255, 0.032), transparent 54%), #010409;") &&
    cssSource.includes("background: linear-gradient(180deg, rgba(220, 177, 63, 0.18), rgba(220, 177, 63, 0.04));"),
  'The sidebar shell must carry its own aligned outer gold rectangle so the branding plaque and navigation frame read as one system.',
);
assert(
  chartThemeSource.includes("cyan: '#77ddff'") &&
    chartThemeSource.includes("gold: '#dcb13f'") &&
    chartThemeSource.includes("green: '#42d69b'"),
  'The shared chart palette must match the Midnight Gold brand system.',
);
assert(
  dashboardVisualsSource.includes('colors={[CHART_COLORS.cyan, CHART_COLORS.gold]}'),
  'Weekly activity must use cyan for tool runs and gold for audit events.',
);

console.log('[SkyCommand] Midnight Gold brand theme self-test passed.');
