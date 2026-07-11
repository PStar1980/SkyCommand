-- Trigger: skyweb.user_dashboard_items_user_dashboard_items_set_updated_at
-- Purpose: Maintains updated_at on skyweb.user_dashboard_items.

DROP TRIGGER IF EXISTS user_dashboard_items_set_updated_at ON skyweb.user_dashboard_items;

CREATE TRIGGER user_dashboard_items_set_updated_at
BEFORE UPDATE ON skyweb.user_dashboard_items
FOR EACH ROW
EXECUTE FUNCTION skyweb.set_updated_at();
