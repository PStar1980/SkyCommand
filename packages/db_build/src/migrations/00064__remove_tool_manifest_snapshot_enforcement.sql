-- Migration: 00064__remove_tool_manifest_snapshot_enforcement.sql
-- Phase 14 rollback of manifest hashes/snapshots as runtime gates.
-- Structured ToolResult output remains supported independently of this schema.

DROP VIEW IF EXISTS core.vw_tool_manifest_snapshot_status;
DROP TABLE IF EXISTS core.tool_manifest_snapshots CASCADE;
