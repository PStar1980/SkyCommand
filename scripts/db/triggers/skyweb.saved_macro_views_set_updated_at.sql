-- Trigger: skyweb.saved_macro_views_set_updated_at
-- Purpose: Maintain updated_at for saved macro view records.

DROP TRIGGER IF EXISTS saved_macro_views_set_updated_at ON skyweb.saved_macro_views;

CREATE TRIGGER saved_macro_views_set_updated_at
BEFORE UPDATE ON skyweb.saved_macro_views
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
