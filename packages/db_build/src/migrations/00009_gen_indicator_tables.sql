INSERT INTO macro.indicators (indicator_code, source, description, frequency, active)
VALUES
('V39079', 'BOC', 'BoC Overnight Rate', 'daily', true),
('V39052', 'BOC', '2-Year Govt Bond Yield', 'daily', true),
('V39053', 'BOC', '5-Year Govt Bond Yield', 'daily', true),
('V39054', 'BOC', '10-Year Govt Bond Yield', 'daily', true),
('FXUSDCAD', 'BOC', 'USD/CAD Exchange Rate', 'daily', true);

DO $$
DECLARE
    rec RECORD;
    tbl TEXT;
    tbl_exists BOOLEAN;
BEGIN
    FOR rec IN 
        SELECT indicator_code AS indicator_code
        FROM macro.indicators
        WHERE source = 'BOC'
    LOOP
        tbl := rec.indicator_code;

        -- Check if table exists
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'macro'
              AND table_name = tbl
        ) INTO tbl_exists;

        -- Create table only if it doesn't exist
        IF NOT tbl_exists THEN
            EXECUTE format(
                'CREATE TABLE macro.%I (
                    edate DATE NOT NULL,
                    value NUMERIC,
                    CONSTRAINT %I PRIMARY KEY (edate)
                ) TABLESPACE pg_default;',
                tbl,
                tbl || '_pkey'
            );

            RAISE NOTICE 'Created table: macro.%', tbl;
        ELSE
            RAISE NOTICE 'Table already exists: macro.%', tbl;
        END IF;

        -- Ensure correct owner (idempotent)
        EXECUTE format(
            'ALTER TABLE macro.%I OWNER TO postgres;',
            tbl
        );

    END LOOP;
END $$;
