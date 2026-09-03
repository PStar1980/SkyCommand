#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const task = fs.readFileSync(path.join(root, 'scripts/powershell/SkyCommand-SupervisorTask.ps1'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts/powershell/Start-SkyCommandSupervisor.ps1'), 'utf8');
const hidden = fs.readFileSync(path.join(root, 'scripts/powershell/Start-SkyCommandSupervisorHidden.vbs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(task, /SkyCommand Supervisor/);
assert.match(task, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(task, /-LogonType Interactive/);
assert.match(task, /Get-CimInstance Win32_Process/);
assert.match(task, /taskkill\.exe/);
assert.match(task, /Stop completed:/);
assert.match(task, /Start-SkyCommandSupervisorHidden\.vbs/);
assert.match(task, /Health proof: npm run supervisor:check/);
assert.match(runner, /packages\\supervisor\\src\\server\.js/);
assert.match(runner, /scheduled-task\.runner\.pid/);
assert.match(runner, /5MB/);
assert.match(hidden, /shell\.Run\(commandLine, 0, True\)/);
assert.match(hidden, /-WindowStyle Hidden/);
assert.ok(packageJson.scripts?.['supervisor:auto-start:install']);
assert.ok(packageJson.scripts?.['supervisor:auto-start:status']);
assert.ok(packageJson.scripts?.['supervisor:auto-start:start']);
assert.ok(packageJson.scripts?.['supervisor:auto-start:stop']);

console.log('✅ SkyCommand Supervisor scheduled-task self-test passed.');
