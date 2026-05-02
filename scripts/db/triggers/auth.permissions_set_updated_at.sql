DROP TRIGGER IF EXISTS permissions_set_updated_at ON auth.permissions;

CREATE TRIGGER permissions_set_updated_at
BEFORE UPDATE ON auth.permissions
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();
