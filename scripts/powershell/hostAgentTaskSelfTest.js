#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const taskScript = fs.readFileSync(
  path.join(root, 'scripts/powershell/SkyCommand-HostAgentTask.ps1'),
  'utf8',
);
const runnerScript = fs.readFileSync(
  path.join(root, 'scripts/powershell/Start-SkyCommandHostAgent.ps1'),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.match(taskScript, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(taskScript, /SKYCOMMAND_HOST_AGENT_ENABLED=true/);
assert.match(taskScript, /RestartCount 60/);
assert.match(taskScript, /MultipleInstances IgnoreNew/);
assert.match(taskScript, /RunLevel Limited/);
assert.match(taskScript, /Get-CimInstance Win32_Process/);
assert.match(taskScript, /Stop the manual 'npm run host-agent' process/);
assert.match(taskScript, /Start-ScheduledTask/);
assert.match(taskScript, /Unregister-ScheduledTask/);
assert.match(runnerScript, /packages\\host-agent\\src\\worker\.js/);
assert.match(runnerScript, /logs\\host-agent/);
assert.match(runnerScript, /5MB/);
assert.match(runnerScript, /Windows PowerShell 5\.1/);
assert.match(runnerScript, /\$ErrorActionPreference = 'Continue'/);
assert.match(taskScript, /Operational state:/);
assert.match(taskScript, /Host process count:/);
assert.match(taskScript, /Runner process count:/);
assert.match(taskScript, /TASK SCHEDULER CONFIRMED; PROCESS UNOBSERVED/);
assert.match(taskScript, /0x00041301 \/ 267009 is SCHED_S_TASK_RUNNING/);
assert.match(taskScript, /Last result:.*lastTaskResultHex/);
assert.match(taskScript, /RUNNING OUTSIDE SCHEDULED TASK/);
assert.match(taskScript, /scheduled-task\.log/);
assert.equal(
  packageJson.scripts?.['host-agent:auto-start:install'],
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/powershell/SkyCommand-HostAgentTask.ps1 -Action Install',
);
assert.ok(packageJson.scripts?.['host-agent:auto-start:status']);
assert.ok(packageJson.scripts?.['host-agent:auto-start:uninstall']);

console.log('✅ SkyCommand Host Agent automatic-start self-test passed.');
