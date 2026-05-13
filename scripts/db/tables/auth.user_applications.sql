-- Table: auth.user_applications
-- Purpose: Application membership records for shared auth.users identities.

CREATE TABLE IF NOT EXISTS auth.user_applications (
  user_id UUID NOT NULL,
  app_id UUID NOT NULL,

  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DISABLED', 'PENDING')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  created_by UUID,
  updated_by UUID,

  PRIMARY KEY (user_id, app_id),

  CONSTRAINT user_applications_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES auth.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT user_applications_app_id_fkey
    FOREIGN KEY (app_id)
    REFERENCES core.applications(app_id)
    ON DELETE CASCADE,

  CONSTRAINT user_applications_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES auth.users(user_id)
    ON DELETE SET NULL,

  CONSTRAINT user_applications_updated_by_fkey
    FOREIGN KEY (updated_by)
    REFERENCES auth.users(user_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS user_applications_app_status_idx
  ON auth.user_applications (app_id, status);

CREATE INDEX IF NOT EXISTS user_applications_user_status_idx
  ON auth.user_applications (user_id, status);

ALTER TABLE auth.user_applications OWNER TO postgres;

COMMENT ON TABLE auth.user_applications IS
'Application membership records for shared auth.users identities. Controls which apps a user can access.';
