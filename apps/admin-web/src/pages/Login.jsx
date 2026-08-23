import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SkyCommandMark from '../components/ui/SkyCommandMark.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';

const LOGIN_REDIRECT_PATH = '/dashboard';
const REMEMBERED_EMAIL_KEY = 'skycommand.rememberedEmail';

function Login() {
  const navigate = useNavigate();
  const { authNotice, clearAuthNotice, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [authPath, setAuthPath] = useState('login');

  useEffect(() => {
    const rememberedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);

    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberEmail(true);
    }
  }, []);

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

      if (rememberEmail) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }

      navigate(LOGIN_REDIRECT_PATH, { replace: true });
    } catch (loginError) {
      setError(loginError.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function selectAuthPath(path) {
    setAuthPath(path);
    setError('');
    clearAuthNotice();
  }

  return (
    <div className="sky-login-wrap">
      <section className="sky-card sky-login-card">
        <div className="sky-card-header sky-login-card-header">
          <div className="sky-login-brand-intro">
            <SkyCommandMark className="sky-login-card-mark" />
            <div className="sky-login-brand-copy">
              <h1 className="h3 sky-page-title">SkyCommand</h1>
              <div className="sky-login-brand-tagline">Workflow Automation</div>
              <p className="sky-page-subtitle">
                Secure operator access to workflows, tools, and runtime intelligence.
              </p>
            </div>
          </div>
          <div className="sky-login-card-signal" aria-hidden="true">
            <span />
            Secure operator access
          </div>
        </div>

        <div className="sky-card-body sky-login-card-body">
          <div className="sky-login-alert-slot" aria-live="polite">
            {error ? (
              <DismissibleAlert
                className="sky-auth-alert sky-auth-alert-danger"
                dismissLabel="Dismiss login error"
                onDismiss={() => setError('')}
              >
                {error}
              </DismissibleAlert>
            ) : authNotice ? (
              <DismissibleAlert
                className="sky-auth-alert sky-auth-alert-danger"
                dismissLabel="Dismiss session message"
                onDismiss={clearAuthNotice}
              >
                {authNotice}
              </DismissibleAlert>
            ) : null}
          </div>

          <form className="sky-login-form" onSubmit={handleSubmit}>
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

            <div className="mb-3 text-start">
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

            <div className="sky-login-options-row">
              <div className="form-check sky-login-remember">
                <input
                  checked={rememberEmail}
                  className="form-check-input"
                  id="rememberEmail"
                  onChange={(event) => setRememberEmail(event.target.checked)}
                  type="checkbox"
                />
                <label className="form-check-label" htmlFor="rememberEmail">
                  Remember email
                </label>
              </div>
              <button
                className="sky-auth-text-button"
                onClick={() => selectAuthPath('forgot')}
                type="button"
              >
                Forgot password?
              </button>
            </div>

            <button
              className="btn sky-btn-primary sky-login-submit w-100"
              disabled={submitting}
              type="submit"
            >
              {submitting ? 'Opening console...' : 'Login'}
            </button>
          </form>

          <div className="sky-login-access-row" aria-label="Access options">
            <button
              className={`sky-login-access-button${authPath === 'forgot' ? ' is-active' : ''}`}
              onClick={() => selectAuthPath('forgot')}
              type="button"
            >
              <span className="sky-login-access-icon" aria-hidden="true">
                ↻
              </span>
              <span className="sky-login-access-copy">
                <strong>Password recovery</strong>
                <span>Reset access when the authentication workflow is connected.</span>
              </span>
            </button>
            <button
              className={`sky-login-access-button${authPath === 'request' ? ' is-active' : ''}`}
              onClick={() => selectAuthPath('request')}
              type="button"
            >
              <span className="sky-login-access-icon" aria-hidden="true">
                +
              </span>
              <span className="sky-login-access-copy">
                <strong>Request access</strong>
                <span>Ask an administrator to provision your SkyCommand identity.</span>
              </span>
            </button>
          </div>

          {authPath !== 'login' && (
            <div className="sky-login-support-panel" role="status">
              {authPath === 'forgot' ? (
                <>
                  <div className="sky-page-kicker">Password recovery</div>
                  <p>
                    Password reset delivery is not wired yet. For now, contact a SkyCommand
                    administrator to reset credentials for {email || 'your account'}.
                  </p>
                </>
              ) : (
                <>
                  <div className="sky-page-kicker">Request access</div>
                  <p>
                    SkyCommand uses controlled access. Ask an administrator to create your user,
                    assign roles, and grant workflow permissions before signing in.
                  </p>
                </>
              )}
              <button
                className="sky-auth-text-button"
                onClick={() => selectAuthPath('login')}
                type="button"
              >
                Return to login
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default Login;
