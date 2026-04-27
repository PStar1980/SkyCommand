-- macro.indicators definition

-- Drop table

-- DROP TABLE macro.indicators;

CREATE TABLE macro.indicators (
    indicator_code TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    description TEXT,
    frequency TEXT,           -- daily, monthly, quarterly
    created_at TIMESTAMPTZ DEFAULT NOW()
);