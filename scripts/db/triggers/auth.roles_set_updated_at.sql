DROP TRIGGER IF EXISTS roles_set_updated_at ON auth.roles;

CREATE TRIGGER roles_set_updated_at
BEFORE UPDATE ON auth.roles
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();
