-- Trigger: auth.user_applications_set_updated_at
-- Purpose: Maintains updated_at on auth.user_applications.

DROP TRIGGER IF EXISTS user_applications_set_updated_at ON auth.user_applications;

CREATE TRIGGER user_applications_set_updated_at
BEFORE UPDATE ON auth.user_applications
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();
