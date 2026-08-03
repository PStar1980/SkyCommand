-- ============================================================
-- SkyCommand Auth Schema
-- ============================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER SCHEMA auth OWNER TO postgres;

COMMENT ON SCHEMA auth IS
'SkyCommand authentication, authorization, session, login, audit, and script execution tracking schema.';
