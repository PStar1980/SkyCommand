const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand sidebar accordion self-test] ${message}`);
  }
}

const sidebarPath = path.join(__dirname, 'SidebarNav.jsx');
const navbarPath = path.join(__dirname, '..', 'Navbar.jsx');
const cssPath = path.join(__dirname, '..', '..', 'App.css');
const loginPath = path.join(__dirname, '..', '..', 'pages', 'Login.jsx');

const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');
const navbarSource = fs.readFileSync(navbarPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const loginSource = fs.readFileSync(loginPath, 'utf8');

assert(
  sidebarSource.includes("expandedGroupLabel = 'Dashboards'"),
  'Sidebar must default to the Dashboards category.',
);
assert(
  sidebarSource.includes('aria-expanded={expanded}') &&
    sidebarSource.includes('onClick={() => onGroupSelect?.(group)}'),
  'Category labels must be accessible controls that select a navigation group.',
);
assert(
  sidebarSource.includes("expanded ? 'is-expanded' : 'is-collapsed'"),
  'Only the selected category should be expanded.',
);
assert(
  navbarSource.includes('getNavGroupForPath(navGroups, location.pathname)'),
  'Expanded category must stay synchronized with route navigation.',
);
assert(
  navbarSource.includes("const [expandedNavGroupLabel, setExpandedNavGroupLabel] = useState('Dashboards')"),
  'Authenticated navigation must initialize with Dashboards expanded.',
);
assert(
  navbarSource.includes("const firstItem = group.items?.find((item) => item.to)") &&
    navbarSource.includes('navigate(firstItem.to)'),
  'Selecting a different category must load its first permitted menu item.',
);
assert(
  loginSource.includes("const LOGIN_REDIRECT_PATH = '/dashboard'"),
  'Login must continue to land on Command Center.',
);
assert(
  cssSource.includes('.sky-sidebar-group-panel') &&
    cssSource.includes('.sky-sidebar-group.is-expanded .sky-sidebar-group-panel'),
  'Collapsed and expanded category presentation must be styled.',
);
assert(
  cssSource.includes('border-radius: 0.18rem;') &&
    cssSource.includes('border-color: rgba(236, 190, 74, 0.72);'),
  'Selected navigation cards must use the compact square gold-highlight treatment.',
);
assert(
  cssSource.includes('.sky-sidebar-group.is-expanded .sky-sidebar-group-items::before') &&
    cssSource.includes('width: 100%;'),
  'Expanded child navigation must keep full-width cards with a visible hierarchy guide.',
);

console.log('[SkyCommand] Sidebar accordion navigation self-test passed.');
