#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const proofPath = path.join(
  root,
  'packages',
  'ingestion',
  'src',
  'catalogue',
  'phase16PortabilityProof.js',
);
const closureReportPath = path.join(
  root,
  'docs',
  'SkyCommand_Phase_16_Closure_Report.md',
);

const proof = fs.readFileSync(proofPath, 'utf8');
const closureReport = fs.readFileSync(closureReportPath, 'utf8');

for (const token of [
  "category_kind_code = 'INGESTION'",
  'data.vw_ingestion_tools',
  'data.vw_ingestion_sources',
  'SET CONSTRAINTS ALL IMMEDIATE',
  "await client.query('ROLLBACK')",
  'verifyRolledBack',
  'baseline.tools + 1',
  'baseline.sources + 1',
]) {
  if (!proof.includes(token)) {
    throw new Error(`Portability proof is missing token: ${token}`);
  }
}

for (const token of [
  '**Status:** Complete',
  'PROGRAM_EVALUATION',
  'without editing a central source registry',
]) {
  if (!closureReport.includes(token)) {
    throw new Error(`Phase 16 closure report is missing portability token: ${token}`);
  }
}

console.log('✅ Phase 16.1.3 portability proof self-test passed.');
