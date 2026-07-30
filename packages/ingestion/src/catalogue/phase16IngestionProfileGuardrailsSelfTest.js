#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../../..');
const servicePath = path.join(root, 'apps/api/src/services/toolAdminService.js');
const migrationPath = path.join(
  root,
  'packages/db_build/src/migrations/00076__ingestion_profile_guardrails.sql',
);
const editorPath = path.join(root, 'apps/admin-web/src/components/IngestionProfileEditor.jsx');

const service = fs.readFileSync(servicePath, 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');
const editor = fs.readFileSync(editorPath, 'utf8');

for (const token of [
  'normalizeIngestionProfile',
  'assertIngestionAssignment',
  'replaceIngestionProfile',
  'INGESTION_PROFILE_REQUIRED',
  'dataDomains',
  'dataSources',
]) {
  if (!service.includes(token)) {
    throw new Error(`toolAdminService is missing guardrail token: ${token}`);
  }
}

for (const token of [
  'DEFERRABLE INITIALLY DEFERRED',
  'INGESTION_PROFILE_SOURCE_DOMAIN_MISMATCH',
  'ingestion_tool_profile_contract_tool',
  'ingestion_tool_profile_contract_profile',
]) {
  if (!migration.includes(token)) {
    throw new Error(`Guardrail migration is missing token: ${token}`);
  }
}

for (const token of ['Portable ingestion profile', 'Declared capabilities', 'configurationText']) {
  if (!editor.includes(token)) {
    throw new Error(`IngestionProfileEditor is missing token: ${token}`);
  }
}

console.log('✅ Phase 16.1.2 ingestion profile guardrail self-test passed.');
