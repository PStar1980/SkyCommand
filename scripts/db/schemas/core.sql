-- Schema: core
-- Purpose: Relational configuration store for SkyServer Core, Admin-Web, repositories, tools, and script manifest data.

CREATE SCHEMA IF NOT EXISTS core;

ALTER SCHEMA core OWNER TO postgres;

COMMENT ON SCHEMA core IS 'SkyServer operational configuration schema for repositories, tools, manifests, visibility, parameters, and runtime metadata.';
