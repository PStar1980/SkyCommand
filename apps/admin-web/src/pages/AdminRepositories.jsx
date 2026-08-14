import { Navigate } from 'react-router-dom';

function AdminRepositories() {
  return <Navigate replace to="/git-repositories/manage" />;
}

export default AdminRepositories;
