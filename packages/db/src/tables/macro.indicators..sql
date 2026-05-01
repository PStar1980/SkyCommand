-- Table: macro.indicators

-- DROP TABLE IF EXISTS macro.indicators;

CREATE TABLE IF NOT EXISTS macro.indicators
(
    indicator_code text COLLATE pg_catalog."default" NOT NULL,
    source text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    frequency text COLLATE pg_catalog."default",
    created_at timestamp with time zone DEFAULT now(),
    active boolean DEFAULT true,
    CONSTRAINT indicator_pkey PRIMARY KEY (indicator_code)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS macro.indicators
    OWNER to postgres;
    