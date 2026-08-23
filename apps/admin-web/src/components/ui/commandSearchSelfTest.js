const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[SkyCommand command search self-test] ${message}`);
  }
}

const navbarPath = path.join(__dirname, '..', 'Navbar.jsx');
const cssPath = path.join(__dirname, '..', '..', 'App.css');
const navbarSource = fs.readFileSync(navbarPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');

assert(
  navbarSource.includes("if (!normalizedQuery) {\n      return [];\n    }") &&
    !navbarSource.includes('return commandSearchTargets.slice(0, 4);'),
  'Blank command search must not expose default navigation suggestions.',
);
assert(
  !navbarSource.includes("onFocus={() => setTopbarPanel('search')}") &&
    navbarSource.includes("setTopbarPanel(nextQuery.trim() ? 'search' : '');"),
  'Command search suggestions must open from typed text rather than input focus alone.',
);
assert(
  navbarSource.includes("commandSearchInputRef.current?.focus();\n      }") &&
    !navbarSource.includes("commandSearchInputRef.current?.focus();\n        setTopbarPanel('search');"),
  'The slash shortcut must focus search without opening an unfiltered suggestion panel.',
);
assert(
  navbarSource.includes("{topbarPanel === 'search' && Boolean(commandQuery.trim()) && (") &&
    navbarSource.includes("aria-expanded={topbarPanel === 'search' && Boolean(commandQuery.trim())}"),
  'Search popover rendering and combobox state must require a non-empty query.',
);
assert(
  cssSource.includes('.sky-topbar-command-search {') &&
    cssSource.includes('border: 1px solid rgba(220, 177, 63, 0.62);') &&
    cssSource.includes('color: #dcb13f;'),
  'Command search default outline and icon color must use the Midnight Gold palette.',
);
assert(
  cssSource.includes('.sky-command-search-key {') &&
    cssSource.includes('border: 1px solid rgba(220, 177, 63, 0.52);') &&
    cssSource.includes('background: rgba(220, 177, 63, 0.1);') &&
    cssSource.includes('color: #ffe59a;'),
  'The slash shortcut badge must use gold border, surface, and text styling.',
);

console.log('[SkyCommand] Command search refinement self-test passed.');
