-- Purpose: make the R6 promotion admission actor-neutral while preserving the
-- existing Assistant admission contract and failed-node recovery authorization.

ALTER TABLE worker.dev_promotion_admissions
  ALTER COLUMN workflow_execution_admission_id DROP NOT NULL;

ALTER TABLE worker.dev_promotion_admissions
  ADD COLUMN IF NOT EXISTS authorization_source TEXT NOT NULL DEFAULT 'ASSISTANT_ADMISSION';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'worker.dev_promotion_admissions'::regclass
      AND conname = 'dev_promotion_admission_authorization_source_ck'
  ) THEN
    ALTER TABLE worker.dev_promotion_admissions
      ADD CONSTRAINT dev_promotion_admission_authorization_source_ck
      CHECK (authorization_source IN ('ASSISTANT_ADMISSION', 'HUMAN_UI'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'worker.dev_promotion_admissions'::regclass
      AND conname = 'dev_promotion_admission_authorization_binding_ck'
  ) THEN
    ALTER TABLE worker.dev_promotion_admissions
      ADD CONSTRAINT dev_promotion_admission_authorization_binding_ck
      CHECK (
        (authorization_source = 'ASSISTANT_ADMISSION' AND workflow_execution_admission_id IS NOT NULL)
        OR (authorization_source = 'HUMAN_UI' AND workflow_execution_admission_id IS NULL)
      );
  END IF;
END;
$$;

COMMENT ON COLUMN worker.dev_promotion_admissions.authorization_source IS
  'Durable R6 authorization boundary: Assistant resource admission or authenticated human UI workflow-run start.';

DO $$
DECLARE
  admission_column_nullable TEXT;
  invalid_authorization_count INTEGER;
BEGIN
  SELECT is_nullable
    INTO admission_column_nullable
    FROM information_schema.columns
   WHERE table_schema = 'worker'
     AND table_name = 'dev_promotion_admissions'
     AND column_name = 'workflow_execution_admission_id';

  IF admission_column_nullable <> 'YES' THEN
    RAISE EXCEPTION '00146: workflow_execution_admission_id must be nullable for HUMAN_UI admissions';
  END IF;

  SELECT COUNT(*)
    INTO invalid_authorization_count
    FROM worker.dev_promotion_admissions
   WHERE NOT (
     (authorization_source = 'ASSISTANT_ADMISSION' AND workflow_execution_admission_id IS NOT NULL)
     OR (authorization_source = 'HUMAN_UI' AND workflow_execution_admission_id IS NULL)
   );

  IF invalid_authorization_count <> 0 THEN
    RAISE EXCEPTION '00146: existing R6 authorization-source bindings are invalid';
  END IF;
END;
$$;
