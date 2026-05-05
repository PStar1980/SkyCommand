-- Table: core.tool_category_visibility
-- Purpose: Junction table mapping categories to visibility channels.

CREATE TABLE IF NOT EXISTS core.tool_category_visibility (
  category_id UUID NOT NULL REFERENCES core.tool_categories(category_id) ON DELETE CASCADE,
  channel_code TEXT NOT NULL REFERENCES core.visibility_channels(channel_code),
  PRIMARY KEY (category_id, channel_code)
);

ALTER TABLE core.tool_category_visibility OWNER TO postgres;

COMMENT ON TABLE core.tool_category_visibility IS 'Category-to-channel visibility mapping.';
