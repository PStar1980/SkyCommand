const { test, expect } = require('@playwright/test');

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const FIRST_RUN = '10000000-0000-4000-8000-000000000001';
const SECOND_RUN = '10000000-0000-4000-8000-000000000002';
const NEW_RUN = '10000000-0000-4000-8000-000000000003';

function fixtures() {
  const sessions = Array.from({ length: 24 }, (_, index) => ({
    sessionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    projectId: index === 23 ? 'project-b' : 'project-a',
    projectName: index === 23 ? 'Beta Project' : 'Alpha Project',
    projectCode: index === 23 ? 'BETA' : 'ALPHA',
    agentCode: 'FIXTURE_AGENT',
    agentName: 'Fixture Agent',
    agentRevision: 1,
    runtimeKind: 'FAKE_PERSISTENT',
    runtimeProfile: 'FAKE_PERSISTENT_DEFAULT',
    accountAlias: 'Fixture account',
    sessionModel: 'PERSISTENT',
    status: 'ACTIVE',
    continuationEligible: true,
    continuationBlockReason: null,
    initiatingUserId: 'fixture-user',
    initiatingUserName: 'Fixture User',
    runCount: 2,
    latestRunId: SECOND_RUN,
    latestRunStatus: 'COMPLETED',
    activeRunId: null,
    createdAt: '2026-10-01T12:00:00Z',
    lastActivityAt: '2026-10-02T12:00:00Z',
    providerConversationAvailability: 'AVAILABLE',
    compatibility: {
      compatible: true,
      reason: null,
      freshnessStatus: 'CURRENT',
      model: 'fixture-model',
      reasoningEffort: 'low',
    },
  }));
  const runs = [FIRST_RUN, SECOND_RUN].map((runId, index) => ({
    runId,
    sessionId: SESSION_ID,
    projectCode: 'ALPHA',
    agentCode: 'FIXTURE_AGENT',
    runtimeKind: 'FAKE_PERSISTENT',
    status: 'COMPLETED',
    resultStatus: 'SUCCESS',
    model: 'fixture-model',
    reasoningEffort: 'low',
    capabilityEffectCount: 1,
    artifactCount: 1,
    createdAt: `2026-10-0${index + 1}T12:00:00Z`,
  }));
  return { sessions, runs, submissions: [], archives: [], listQueries: [], uncertainFirst: false };
}

async function installFixture(page, state) {
  page.on('pageerror', (error) => console.error(`[Agent Sessions fixture page error] ${error.stack || error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') console.error(`[Agent Sessions fixture console] ${message.text()}`); });
  await page.addInitScript(() =>
    localStorage.setItem('skycommand.admin.sessionToken', 'phase19-3b-browser-fixture'),
  );
  // Every API request is intercepted: this suite cannot create a real provider Turn.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, ...payload }),
      });
    if (url.pathname === '/api/auth/me')
      return json({
        user: { userId: 'fixture-user', displayName: 'Fixture User' },
        session: {},
        permissions: [{ permissionCode: 'AGENT_RUN' }],
      });
    if (url.pathname === '/api/agent-sessions' && request.method() === 'GET') {
      state.listQueries.push(Object.fromEntries(url.searchParams));
      let items = state.sessions;
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (q)
        items = items.filter((item) =>
          `${item.sessionId} ${item.projectName} ${item.agentName}`.toLowerCase().includes(q),
        );
      for (const field of ['status', 'runtimeKind', 'projectId'])
        if (url.searchParams.get(field))
          items = items.filter((item) => item[field] === url.searchParams.get(field));
      if (url.searchParams.get('continuationEligible'))
        items = items.filter(
          (item) =>
            String(item.continuationEligible) === url.searchParams.get('continuationEligible'),
        );
      if (url.searchParams.get('sort') === 'projectName')
        items = [...items].sort((a, b) => a.projectName.localeCompare(b.projectName));
      const limit = Number(url.searchParams.get('limit') || 20);
      const offset = Number(url.searchParams.get('offset') || 0);
      return json({
        items: items.slice(offset, offset + limit),
        page: { limit, offset, total: items.length, hasMore: offset + limit < items.length },
      });
    }
    const match = url.pathname.match(/^\/api\/agent-sessions\/([^/]+)(?:\/(runs|archive))?$/);
    if (match) {
      const session = state.sessions.find((item) => item.sessionId === match[1]);
      if (!session) return json({ ok: false, error: 'Session not visible.' }, 404);
      if (request.method() === 'GET' && !match[2])
        return json({
          ...session,
          runs: state.runs,
          runPage: { limit: 100, offset: 0, total: state.runs.length, hasMore: false },
        });
      if (request.method() === 'POST' && match[2] === 'runs') {
        state.submissions.push(request.postDataJSON());
        if (state.uncertainFirst && state.submissions.length === 1)
          return json(
            {
              ok: false,
              error: 'Provider continuation outcome unknown.',
              code: 'AGENT_SESSION_CONTINUATION_OUTCOME_UNKNOWN',
            },
            503,
          );
        await new Promise((resolve) => setTimeout(resolve, 250));
        return json({ runId: NEW_RUN, sessionId: session.sessionId, status: 'ADMITTED' }, 202);
      }
      if (request.method() === 'POST' && match[2] === 'archive') {
        state.archives.push(session.sessionId);
        session.archivedAt = '2026-10-02T15:00:00Z';
        session.status = 'ARCHIVED';
        session.continuationEligible = false;
        session.continuationBlockReason = 'SESSION_ARCHIVED';
        return json({ ...session });
      }
    }
    if (url.pathname === '/api/agent-runs')
      return json({
        items: [...state.runs, { ...state.runs[1], runId: NEW_RUN, status: 'ADMITTED' }],
      });
    if (url.pathname.startsWith('/api/agent-runs/'))
      return json({
        ...state.runs[1],
        runId: url.pathname.split('/')[3],
        sessionId: SESSION_ID,
        result: null,
        events: [],
        providerOperations: [],
        capabilityEffects: [],
      });
    if (request.method() !== 'GET')
      throw new Error(
        `Unexpected mutating API fixture request: ${request.method()} ${url.pathname}`,
      );
    return json({ items: [], categories: [], unreadCount: 0 });
  });
}

test.describe('Phase 19.3B Agent Sessions @agent-sessions', () => {
  test('navigates, filters and paginates owned Sessions, then links chronological Runs', async ({
    page,
  }) => {
    const state = fixtures();
    await installFixture(page, state);
    await page.goto('/agents/sessions');
    await expect(page.getByRole('heading', { name: 'Agent Sessions', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Agent Sessions/ })).toBeVisible();
    await expect(page.locator('tr[data-agent-session-id]')).toHaveCount(20);
    const listScreenshot = test.info().outputPath('agent-sessions-list.png');
    await page.screenshot({ path: listScreenshot, fullPage: true });
    await test
      .info()
      .attach('Agent Sessions list', { path: listScreenshot, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('tr[data-agent-session-id]')).toHaveCount(4);
    expect(state.listQueries.at(-1).offset).toBe('20');
    await page.getByLabel('Search Sessions').fill('Beta');
    await expect(page.locator('tr[data-agent-session-id]')).toHaveCount(1);
    expect(state.listQueries.at(-1).offset).toBe('0');
    await page.getByLabel('Search Sessions').fill('');
    await page.getByLabel('Continuation', { exact: true }).selectOption('true');
    await page.getByLabel('Sort by').selectOption('projectName:asc');
    await expect.poll(() => state.listQueries.at(-1)?.sort).toBe('projectName');
    await page.locator(`tr[data-agent-session-id="${SESSION_ID}"]`).getByRole('link').click();
    await expect(page.getByTestId('agent-session-detail')).toHaveAttribute(
      'data-session-id',
      SESSION_ID,
    );
    const timeline = page.getByRole('table', { name: 'Session Run timeline' });
    await expect(timeline.locator('tbody tr')).toHaveCount(2);
    await expect(timeline.locator('tbody tr').first()).toHaveAttribute(
      'data-agent-session-run-id',
      FIRST_RUN,
    );
    const detailScreenshot = test.info().outputPath('agent-session-detail.png');
    await page.screenshot({ path: detailScreenshot, fullPage: true });
    await test
      .info()
      .attach('Agent Session detail and timeline', {
        path: detailScreenshot,
        contentType: 'image/png',
      });
    await timeline.locator('tbody tr').last().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`runId=${SECOND_RUN}`));
    await expect(page.getByRole('cell').filter({ hasText: SECOND_RUN }).first()).toBeVisible();
  });

  test('admits one instruction-only continuation and opens the new Run', async ({ page }) => {
    const state = fixtures();
    await installFixture(page, state);
    await page.goto(`/agents/sessions/${SESSION_ID}`);
    await page.getByRole('button', { name: 'Continue Session', exact: true }).click();
    await page
      .getByLabel('Next instruction')
      .fill('Use the registered read-only fixture capability.');
    const submit = page.getByRole('button', { name: 'Submit continuation', exact: true });
    await submit.click();
    await expect(page.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`runId=${NEW_RUN}`));
    expect(state.submissions).toHaveLength(1);
    expect(Object.keys(state.submissions[0]).sort()).toEqual(['idempotencyKey', 'instruction']);
    await expect(page.getByRole('cell').filter({ hasText: NEW_RUN }).first()).toBeVisible();
  });

  test('keeps the same command after unknown admission outcome', async ({ page }) => {
    const state = fixtures();
    state.uncertainFirst = true;
    await installFixture(page, state);
    await page.goto(`/agents/sessions/${SESSION_ID}`);
    await page.getByRole('button', { name: 'Continue Session', exact: true }).click();
    await page.getByLabel('Next instruction').fill('Continue the fixture conversation.');
    await page.getByRole('button', { name: 'Submit continuation', exact: true }).click();
    await expect(page.getByLabel('Next instruction')).toBeDisabled();
    await expect(
      page.getByText('Submission outcome is uncertain.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry continuation request' }).click();
    await expect(page).toHaveURL(new RegExp(`runId=${NEW_RUN}`));
    expect(state.submissions).toHaveLength(2);
    expect(state.submissions[1]).toEqual(state.submissions[0]);
  });

  test('blocks active continuation and archives while preserving history and the active Run', async ({
    page,
  }) => {
    const state = fixtures();
    state.sessions[0].continuationEligible = false;
    state.sessions[0].continuationBlockReason = 'SESSION_ACTIVE';
    state.sessions[0].activeRunId = SECOND_RUN;
    await installFixture(page, state);
    await page.goto(`/agents/sessions/${SESSION_ID}`);
    await expect(
      page.getByRole('button', { name: 'Continue Session', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('Continuation blocked: Active Run', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Archive Session', exact: true }).click();
    await expect(
      page.getByText('Session archived. History is preserved; any active Run continues.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue Session', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Archive Session', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('table', { name: 'Session Run timeline' }).locator('tbody tr'),
    ).toHaveCount(2);
    expect(state.archives).toEqual([SESSION_ID]);
    expect(state.submissions).toHaveLength(0);
    expect(state.sessions[0].activeRunId).toBe(SECOND_RUN);
  });
});
