const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand Midnight Gold self-test] ${message}`);
  }
}

const cssPath = path.join(__dirname, '..', '..', 'App.css');
const chartThemePath = path.join(__dirname, '..', 'charts', 'chartTheme.js');
const dashboardVisualsPath = path.join(__dirname, '..', 'charts', 'DashboardVisuals.jsx');
const loginPath = path.join(__dirname, '..', '..', 'pages', 'Login.jsx');

const cssSource = fs.readFileSync(cssPath, 'utf8');
const chartThemeSource = fs.readFileSync(chartThemePath, 'utf8');
const dashboardVisualsSource = fs.readFileSync(dashboardVisualsPath, 'utf8');
const loginSource = fs.readFileSync(loginPath, 'utf8');

assert(
  cssSource.includes('SkyCommand Midnight Gold brand system') &&
    cssSource.includes('--sky-gold: #dcb13f;') &&
    cssSource.includes('--sky-cyan: #65c8ff;'),
  'The semantic Midnight Gold design tokens must remain available.',
);
assert(
  cssSource.includes('background: linear-gradient(135deg, #fff0ae 0%, #e4b83f 52%, #a97016 100%);'),
  'Primary actions must use the metallic gold treatment.',
);
assert(
  cssSource.includes('inset 3px 0 0 var(--sky-gold)') &&
    cssSource.includes('rgba(101, 200, 255, 0.065)'),
  'Table selection must remain gold while exploratory hover remains cyan.',
);
assert(
  cssSource.includes('.sky-form-control:-webkit-autofill') &&
    cssSource.includes('-webkit-box-shadow: 0 0 0 1000px #050b14 inset;'),
  'Browser autofill must preserve the dark branded form surface.',
);
assert(
  cssSource.includes('.sky-workflow-approval-instructions') &&
    cssSource.includes('border-color: rgba(220, 177, 63, 0.3);'),
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
