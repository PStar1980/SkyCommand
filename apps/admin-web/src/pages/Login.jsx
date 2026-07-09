import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const LOGIN_REDIRECT_PATH = '/dashboard';

function Login() {
  const navigate = useNavigate();
  const { authNotice, clearAuthNotice, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      clearAuthNotice();
    };
  }, [clearAuthNotice]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    clearAuthNotice();
    setSubmitting(true);

    try {
      await login({ email, password });
      navigate(LOGIN_REDIRECT_PATH, { replace: true });
    } catch (loginError) {
      setError(loginError.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sky-login-wrap">
      <section className="sky-card sky-login-card">
        <div className="sky-card-header">
          <div className="sky-page-kicker">Workflow Automation Engine</div>
          <h1 className="h3 sky-page-title">SkyCommand</h1>
          <p className="sky-page-subtitle">
            Sign in to run approved tools, inspect execution history, and monitor the control layer.
          </p>
        </div>

        <div className="sky-card-body">
          {authNotice && !error && (
            <div className="sky-auth-alert sky-auth-alert-danger" role="alert">
              {authNotice}
            </div>
          )}
          {error && (
            <div className="sky-auth-alert sky-auth-alert-danger" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-3 text-start">
              <label className="form-label" htmlFor="email">
                Email
              </label>
              <input
                autoComplete="email"
                autoFocus
                className="form-control sky-form-control"
                id="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </div>

            <div className="mb-4 text-start">
              <label className="form-label" htmlFor="password">
                Password
              </label>
              <input
                autoComplete="current-password"
                className="form-control sky-form-control"
                id="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
                required
                type="password"
                value={password}
              />
            </div>

            <button className="btn sky-btn-primary w-100" disabled={submitting} type="submit">
              {submitting ? 'Opening console...' : 'Login'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

export default Login;
