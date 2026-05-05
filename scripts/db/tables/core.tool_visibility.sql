-- Table: core.tool_visibility
-- Purpose: Junction table mapping tools to visibility channels.

CREATE TABLE IF NOT EXISTS core.tool_visibility (
  tool_id UUID NOT NULL REFERENCES core.tools(tool_id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL REFERENCES core.visibility_channels(channel_code),
  PRIMARY KEY (tool_id, channel_code)
);

ALTER TABLE core.tool_visibility OWNER TO postgres;

COMMENT ON TABLE core.tool_visibility IS 'Tool-to-channel visibility mapping.';
