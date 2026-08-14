const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');
const adminWebRoot = path.join(repoRoot, 'apps/admin-web/src');
const apiPath = path.join(adminWebRoot, 'services/api.js');
const apiSource = fs.readFileSync(apiPath, 'utf8');
const authContextSource = fs.readFileSync(
  path.join(adminWebRoot, 'context/AuthContext.jsx'),
  'utf8',
);
const protectedRouteSource = fs.readFileSync(
  path.join(adminWebRoot, 'components/ProtectedRoute.jsx'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function collectSourceFiles(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, output);
      continue;
    }

    if (entry.isFile() && ['.js', '.jsx'].includes(path.extname(entry.name))) {
      output.push(absolutePath);
    }
  }

  return output;
}

assert(
  apiSource.includes('if (error.status === 401 && usesStoredSessionToken)') &&
    apiSource.includes("window.sessionStorage.setItem(AUTH_EXPIRED_NOTICE_KEY, message);") &&
    apiSource.includes('redirectToLogin();') &&
    apiSource.includes('window.location.replace(LOGIN_PATH);'),
  'Stored-session API 401 responses must persist an expiry notice and redirect to Login.',
);

assert(
  authContextSource.includes('const pendingNotice = api.consumeAuthExpiredNotice();') &&
    authContextSource.includes('if (pendingNotice) {') &&
    authContextSource.includes('setAuthNotice(pendingNotice);') &&
    protectedRouteSource.includes('<Navigate replace to="/login" state={{ from: location }} />'),
  'The authentication shell must restore the expiry notice and retain protected-route login fallback.',
);

const directNetworkCallers = collectSourceFiles(adminWebRoot)
  .filter((filePath) => filePath !== apiPath)
  .filter((filePath) => /\bfetch\s*\(/.test(fs.readFileSync(filePath, 'utf8')));

assert(
  directNetworkCallers.length === 0,
  `Admin-Web refreshes must use the shared API client so session-expiry redirect is universal. Direct fetch callers: ${directNetworkCallers
    .map((filePath) => path.relative(repoRoot, filePath))
    .join(', ')}`,
);

console.log('[SkyCommand] Refresh/session-expiry redirect self-test passed.');
