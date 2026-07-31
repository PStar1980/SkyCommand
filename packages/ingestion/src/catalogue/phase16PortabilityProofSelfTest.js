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
const roadmapPath = path.join(
  root,
  'docs',
  'SkyCommand_Phase_16_Portable_Ingestion_and_Data_Contract_Foundation.md',
);

const proof = fs.readFileSync(proofPath, 'utf8');
const roadmap = fs.readFileSync(roadmapPath, 'utf8');

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
  '**Revision:** 3',
  'Phase 16.1.3 — Portability closure proof',
  'transaction rollback',
]) {
  if (!roadmap.includes(token)) {
    throw new Error(`Phase 16 roadmap is missing portability proof token: ${token}`);
  }
}

console.log('✅ Phase 16.1.3 portability proof self-test passed.');
