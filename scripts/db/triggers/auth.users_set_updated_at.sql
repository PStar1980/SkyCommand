DROP TRIGGER IF EXISTS users_set_updated_at ON auth.users;

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION auth.set_updated_at();
