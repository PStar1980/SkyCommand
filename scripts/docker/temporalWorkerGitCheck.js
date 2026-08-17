#!/usr/bin/env node

const fs = require('node:fs');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

function fail(message) {
  console.error(`[SkyCommand Docker] ${message}`);
  process.exit(1);
}

function normalizeToken(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    fail(`Unable to run git ${args.join(' ')}: ${result.error.message}`);
  }
  return result;
}

function requestGitHub(pathname, token, host) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: host === 'github.com' ? 'api.github.com' : host,
        path: pathname,
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'SkyCommand-Docker-Git-Check',
          'X-GitHub-Api-Version': '2026-03-10',
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = body ? JSON.parse(body) : null;
          } catch {
            parsed = null;
          }
          resolve({ statusCode: response.statusCode || 0, body: parsed, rawBody: body });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function tokenKind(token) {
  if (token.startsWith('github_pat_')) return 'fine-grained PAT';
  if (token.startsWith('ghp_')) return 'classic PAT';
  return 'unrecognized token format';
}

function parseGitHubRemote(remote) {
  const match = String(remote || '').trim().match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function main() {
  const repo = '/workspace/SkyEco System/SkyCommand System/SkyCommand';
  const host = String(process.env.SKYCOMMAND_GITHUB_HOST || 'github.com').trim();
  const username = String(process.env.SKYCOMMAND_GITHUB_USERNAME || '').trim();
  const tokenFile = String(
    process.env.SKYCOMMAND_GITHUB_TOKEN_FILE || '/run/secrets/skycommand_github_token',
  ).trim();

  if (!username) fail('SKYCOMMAND_GITHUB_USERNAME is empty inside the Docker worker.');

  let rawToken;
  try {
    rawToken = fs.readFileSync(tokenFile, 'utf8');
  } catch (error) {
    fail(`GitHub token secret is not readable at ${tokenFile}: ${error.message}`);
  }

  const token = normalizeToken(rawToken);
  if (!token) fail(`GitHub token secret is empty after whitespace/BOM normalization: ${tokenFile}`);

  const hadBom = rawToken.charCodeAt(0) === 0xfeff;
  const hadOuterWhitespace = rawToken !== rawToken.trim();
  console.log(
    `[SkyCommand Docker] secret=readable type=${tokenKind(token)} length=${token.length} normalized=${hadBom || hadOuterWhitespace ? 'yes' : 'no'}`,
  );

  let userResponse;
  try {
    userResponse = await requestGitHub('/user', token, host);
  } catch (error) {
    fail(`Unable to reach GitHub API for token validation: ${error.message}`);
  }

  if (userResponse.statusCode !== 200) {
    const apiMessage = String(userResponse.body?.message || '').trim();
    fail(
      `GitHub rejected the mounted token during API authentication (HTTP ${userResponse.statusCode}${apiMessage ? `: ${apiMessage}` : ''}). The Docker credential helper is receiving a token, but GitHub does not accept it. Regenerate/recheck the PAT and replace the contents of the host secret file.`,
    );
  }

  const authenticatedLogin = String(userResponse.body?.login || '').trim();
  console.log(`[SkyCommand Docker] githubAuthentication=passed login=${authenticatedLogin || 'unknown'}`);
  if (authenticatedLogin && authenticatedLogin.toLowerCase() !== username.toLowerCase()) {
    console.warn(
      `[SkyCommand Docker] warning: configured username ${username} differs from token owner ${authenticatedLogin}.`,
    );
  }

  const safeResult = runGit(['config', '--global', '--add', 'safe.directory', repo], { capture: true });
  if (safeResult.status !== 0) {
    fail(`Unable to register Git safe.directory: ${String(safeResult.stderr || '').trim()}`);
  }

  const remoteResult = runGit(['remote', 'get-url', 'origin'], { cwd: repo, capture: true });
  if (remoteResult.status !== 0) {
    fail(`Unable to resolve origin remote: ${String(remoteResult.stderr || '').trim()}`);
  }
  const remote = String(remoteResult.stdout || '').trim();
  console.log(`[SkyCommand Docker] remote=${remote}`);

  const parsedRemote = parseGitHubRemote(remote);
  if (parsedRemote && host === 'github.com') {
    let repositoryResponse;
    try {
      repositoryResponse = await requestGitHub(
        `/repos/${encodeURIComponent(parsedRemote.owner)}/${encodeURIComponent(parsedRemote.repo)}`,
        token,
        host,
      );
    } catch (error) {
      fail(`Unable to validate repository access through GitHub API: ${error.message}`);
    }

    if (repositoryResponse.statusCode !== 200) {
      const apiMessage = String(repositoryResponse.body?.message || '').trim();
      fail(
        `Token authenticated, but GitHub did not grant access to ${parsedRemote.owner}/${parsedRemote.repo} (HTTP ${repositoryResponse.statusCode}${apiMessage ? `: ${apiMessage}` : ''}). Check the fine-grained PAT repository selection and permissions.`,
      );
    }
    const canPush = repositoryResponse.body?.permissions?.push;
    console.log(`[SkyCommand Docker] repositoryAccess=passed push=${canPush === true ? 'yes' : 'no/unknown'}`);
    if (canPush === false) {
      fail(
        `The token can read ${parsedRemote.owner}/${parsedRemote.repo}, but GitHub reports no push permission. Grant repository Contents: Read and write to the fine-grained PAT.`,
      );
    }
  }

  const readResult = runGit(['ls-remote', 'origin', 'HEAD'], { cwd: repo, capture: true });
  if (readResult.status !== 0) {
    fail(`Git HTTPS read check failed after API authentication: ${String(readResult.stderr || '').trim()}`);
  }
  console.log('[SkyCommand Docker] gitRead=passed');

  const pushResult = runGit(
    ['push', '--dry-run', 'origin', 'HEAD:refs/heads/__skycommand_docker_auth_probe__'],
    { cwd: repo, capture: true },
  );
  if (pushResult.status !== 0) {
    fail(`Git dry-run push check failed: ${String(pushResult.stderr || '').trim()}`);
  }
  console.log('[SkyCommand Docker] gitDryRunPush=passed');
  console.log('[SkyCommand Docker] GitHub credential check passed (API + read + dry-run push).');
}

main().catch((error) => fail(error?.stack || error?.message || String(error)));
