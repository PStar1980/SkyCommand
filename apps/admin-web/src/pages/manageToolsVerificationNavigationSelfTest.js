#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pagesDirectory = __dirname;
const addToolSource = fs.readFileSync(path.join(pagesDirectory, 'AddTool.jsx'), 'utf8');
const manageToolsSource = fs.readFileSync(path.join(pagesDirectory, 'ManageTools.jsx'), 'utf8');

assert.match(
  addToolSource,
  /\/tools\/manage\?toolId=\$\{registration\.tool\?\.toolId \|\| ''\}&view=verification/,
  'Add Tool must deep-link newly registered tools into verification focus mode.',
);
assert.match(
  addToolSource,
  /Open verification & test/,
  'Add Tool must label the handoff as verification and testing rather than generic catalogue navigation.',
);
assert.match(
  manageToolsSource,
  /searchParams\.get\('view'\)/,
  'Manage Tools must read the requested verification view.',
);
assert.match(
  manageToolsSource,
  /id="managed-tool-verification"/,
  'Manage Tools must expose a stable verification-panel anchor.',
);
assert.match(
  manageToolsSource,
  /scrollIntoView\(\{ behavior, block: 'start' \}\)/,
  'Manage Tools must bring the verification panel into view after the deep-link loads.',
);
assert.match(
  manageToolsSource,
  /Verification &amp; test/,
  'Managed tool detail must retain a visible jump action for verification and testing.',
);
assert.match(
  manageToolsSource,
  /Run contract check/,
  'Managed tool verification must expose the contract-check action.',
);
assert.match(
  manageToolsSource,
  /Run controlled test/,
  'Managed tool verification must expose the controlled-test action.',
);

console.log('Managed tool verification navigation self-test passed.');
