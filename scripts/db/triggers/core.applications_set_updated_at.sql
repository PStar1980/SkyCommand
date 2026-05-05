-- Trigger: core.applications_set_updated_at
-- Purpose: Maintains updated_at on core.applications.

DROP TRIGGER IF EXISTS applications_set_updated_at ON core.applications;

CREATE TRIGGER applications_set_updated_at
BEFORE UPDATE ON core.applications
FOR EACH ROW
EXECUTE FUNCTION core.set_updated_at();
