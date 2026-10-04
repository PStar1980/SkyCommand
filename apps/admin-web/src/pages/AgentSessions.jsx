import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';
import DismissibleAlert from '../components/ui/DismissibleAlert.jsx';
import agentService from '../services/agentService.js';

const PAGE_SIZE = 20;
const INITIAL_FILTERS = {
  q: '',
  status: '',
  continuationEligible: '',
  runtimeKind: '',
  projectId: '',
  sort: 'lastActivityAt',
  sortDirection: 'desc',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function continuationLabel(session) {
  if (session?.archivedAt || session?.status === 'ARCHIVED') return 'Archived';
  if (session?.activeRunId) return 'Active Run';
  if (session?.continuationEligible) return 'Available';
  return session?.continuationBlockReason || 'Unavailable';
}

function AgentSessions() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState({ limit: PAGE_SIZE, offset: 0, total: 0, hasMore: false });
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showContinue, setShowContinue] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const pendingCommand = useRef(null);

  const projects = useMemo(
    () => [
      ...new Map(
        items.map((item) => [
          item.projectId,
          { id: item.projectId, name: item.projectName || item.projectCode || item.projectId },
        ]),
      ).values(),
    ],
    [items],
  );
  const providers = useMemo(
    () => [...new Set(items.map((item) => item.runtimeKind).filter(Boolean))],
    [items],
  );

  const loadList = useCallback(async () => {
    const generation = ++listGeneration.current;
    setLoading(true);
    try {
      const response = await agentService.listAgentSessions({
        ...filters,
        limit: PAGE_SIZE,
        offset,
      });
      if (generation !== listGeneration.current) return;
      setItems(response.items || []);
      setPage(
        response.page || {
          limit: PAGE_SIZE,
          offset,
          total: response.items?.length || 0,
          hasMore: false,
        },
      );
    } catch (loadError) {
      if (generation === listGeneration.current)
        setError(loadError.message || 'Failed to load Agent Sessions.');
    } finally {
      if (generation === listGeneration.current) setLoading(false);
    }
  }, [filters, offset]);

  const loadDetail = useCallback(
    async (quiet = false) => {
      const generation = ++detailGeneration.current;
      if (!sessionId) {
        setDetail(null);
        setDetailLoading(false);
        return;
      }
      if (!quiet) setDetailLoading(true);
      try {
        const response = await agentService.getAgentSession(sessionId);
        if (generation === detailGeneration.current) setDetail(response);
      } catch (loadError) {
        if (generation === detailGeneration.current)
          setError(loadError.message || 'Failed to load Agent Session detail.');
      } finally {
        if (generation === detailGeneration.current) setDetailLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    loadList();
    return () => {
      listGeneration.current += 1;
    };
  }, [loadList]);

  useEffect(() => {
    setDetail(null);
    setShowContinue(false);
    setInstruction('');
    setUncertain(false);
    pendingCommand.current = null;
    loadDetail();
    return () => {
      detailGeneration.current += 1;
    };
  }, [loadDetail]);

  useEffect(() => {
    if (!detail?.activeRunId) return undefined;
    const timer = window.setInterval(() => loadDetail(true), 5000);
    return () => window.clearInterval(timer);
  }, [detail?.activeRunId, loadDetail]);

  function changeFilter(name, value) {
    setOffset(0);
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function continueSession(event) {
    event.preventDefault();
    if (!detail?.continuationEligible || submitting || !instruction.trim()) return;
    if (!pendingCommand.current)
      pendingCommand.current = { instruction, idempotencyKey: `session-ui-${crypto.randomUUID()}` };
    setSubmitting(true);
    setError('');
    try {
      const receipt = await agentService.continueAgentSession(sessionId, pendingCommand.current);
      const runId = receipt.runId || receipt.run?.runId;
      if (!runId)
        throw new Error(
          'Admission returned without a Run receipt. Retry will reconcile the same request.',
        );
      pendingCommand.current = null;
      setUncertain(false);
      navigate(`/agents/operations?runId=${encodeURIComponent(runId)}`, { state: { runId } });
    } catch (submitError) {
      const outcomeUncertain =
        !submitError.status ||
        submitError.status >= 500 ||
        /OUTCOME_UNKNOWN/.test(submitError.payload?.code || '');
      setUncertain(outcomeUncertain);
      if (!outcomeUncertain) pendingCommand.current = null;
      setError(submitError.message || 'The continuation could not be admitted.');
      if (!outcomeUncertain) await loadDetail(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function archiveSession() {
    if (
      !detail ||
      detail.archivedAt ||
      detail.status === 'ARCHIVED' ||
      archiving ||
      submitting ||
      uncertain
    )
      return;
    if (
      !window.confirm(
        'Archive this Session? History is preserved and future continuation is prevented. An active Run will continue.',
      )
    )
      return;
    setArchiving(true);
    setError('');
    try {
      await agentService.archiveAgentSession(sessionId);
      setNotice('Session archived. History is preserved; any active Run continues.');
      setShowContinue(false);
      await Promise.all([loadList(), loadDetail()]);
    } catch (archiveError) {
      setError(archiveError.message || 'The Session could not be archived.');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <PageHeader
        kicker="Agents · Sessions"
        title="Agent Sessions"
        subtitle="Owned conversations with independent Runs and current continuation eligibility."
        actions={
          <button
            className="btn sky-btn-ghost"
            type="button"
            disabled={loading || detailLoading}
            onClick={() => {
              loadList();
              loadDetail();
            }}
          >
            Refresh
          </button>
        }
      />
      <DismissibleAlert tone="danger" onDismiss={() => setError('')}>
        {error}
      </DismissibleAlert>
      <DismissibleAlert tone="success" onDismiss={() => setNotice('')}>
        {notice}
      </DismissibleAlert>
      <Panel title="Sessions" subtitle={`${page.total} visible Session(s)`}>
        <div className="row g-2 mb-3">
          <div className="col-md-4">
            <label className="form-label small" htmlFor="agent-session-search">
              Search Sessions
            </label>
            <input
              id="agent-session-search"
              className="form-control"
              value={filters.q}
              onChange={(event) => changeFilter('q', event.target.value)}
              maxLength={200}
              placeholder="Session, Project or Agent"
            />
          </div>
          <div className="col-md-2">
            <label className="form-label small" htmlFor="agent-session-status">
              Status
            </label>
            <select
              id="agent-session-status"
              className="form-select"
              value={filters.status}
              onChange={(event) => changeFilter('status', event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label small" htmlFor="agent-session-eligibility">
              Continuation
            </label>
            <select
              id="agent-session-eligibility"
              className="form-select"
              value={filters.continuationEligible}
              onChange={(event) => changeFilter('continuationEligible', event.target.value)}
            >
              <option value="">All Sessions</option>
              <option value="true">Available</option>
              <option value="false">Blocked</option>
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label small" htmlFor="agent-session-sort">
              Sort by
            </label>
            <select
              id="agent-session-sort"
              className="form-select"
              value={`${filters.sort}:${filters.sortDirection}`}
              onChange={(event) => {
                const [sort, sortDirection] = event.target.value.split(':');
                setOffset(0);
                setFilters((current) => ({ ...current, sort, sortDirection }));
              }}
            >
              <option value="lastActivityAt:desc">Latest activity</option>
              <option value="lastActivityAt:asc">Oldest activity</option>
              <option value="createdAt:desc">Newest Session</option>
              <option value="projectName:asc">Project name</option>
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label small" htmlFor="agent-session-runtime">
              Runtime / provider
            </label>
            <select
              id="agent-session-runtime"
              className="form-select"
              value={filters.runtimeKind}
              onChange={(event) => changeFilter('runtimeKind', event.target.value)}
            >
              <option value="">All runtimes</option>
              {[...new Set([...providers, filters.runtimeKind].filter(Boolean))].map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label small" htmlFor="agent-session-project">
              Project
            </label>
            <select
              id="agent-session-project"
              className="form-select"
              value={filters.projectId}
              onChange={(event) => changeFilter('projectId', event.target.value)}
            >
              <option value="">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
              {filters.projectId &&
              !projects.some((project) => project.id === filters.projectId) ? (
                <option value={filters.projectId}>Selected Project</option>
              ) : null}
            </select>
          </div>
        </div>
        {loading ? (
          <div className="sky-empty-state py-4">Loading Agent Sessions…</div>
        ) : items.length === 0 ? (
          <div className="sky-empty-state py-4">No visible Sessions match these filters.</div>
        ) : (
          <div className="table-responsive">
            <table
              className="table table-sm align-middle sky-table mb-0"
              aria-label="Agent Sessions"
            >
              <thead>
                <tr>
                  <th>Session / Project</th>
                  <th>Agent</th>
                  <th>Runtime / provider</th>
                  <th>Status</th>
                  <th>Continuation</th>
                  <th>Runs / latest</th>
                  <th>Last activity</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {items.map((session) => (
                  <tr
                    key={session.sessionId}
                    data-agent-session-id={session.sessionId}
                    className={session.sessionId === sessionId ? 'table-active' : ''}
                  >
                    <td>
                      <Link to={`/agents/sessions/${session.sessionId}`} className="sky-mono">
                        {session.sessionId.slice(0, 12)}
                      </Link>
                      <div className="small">{session.projectName || session.projectCode}</div>
                    </td>
                    <td>
                      {session.agentName || session.agentCode}
                      <div className="small sky-muted">
                        Revision {session.agentRevision ?? session.revision ?? '—'}
                      </div>
                    </td>
                    <td>
                      <div className="small sky-mono">{session.runtimeKind}</div>
                      <div className="small sky-muted">{session.runtimeProfile || '—'}</div>
                    </td>
                    <td>
                      <StatusPill status={session.status} />
                    </td>
                    <td>{continuationLabel(session)}</td>
                    <td>
                      {session.runCount ?? 0}
                      <div className="small">
                        <StatusPill status={session.latestRunStatus} />
                      </div>
                    </td>
                    <td className="small">{formatDate(session.lastActivityAt)}</td>
                    <td className="small">
                      {session.initiatingUserName || session.initiatingUserId || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
          <div className="small sky-muted">
            {page.total
              ? `${page.offset + 1}–${Math.min(page.offset + page.limit, page.total)} of ${page.total}`
              : '0 Sessions'}
          </div>
          <div className="d-flex gap-2">
            <button
              className="btn btn-sm sky-btn-ghost"
              type="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              className="btn btn-sm sky-btn-ghost"
              type="button"
              disabled={loading || !page.hasMore}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      </Panel>
      {sessionId ? (
        <div className="mt-3" data-testid="agent-session-detail" data-session-id={sessionId}>
          <Panel
            title="Session detail"
            subtitle={
              detail
                ? `${detail.projectName || detail.projectCode} · ${detail.agentName || detail.agentCode}`
                : ''
            }
            actions={
              detail ? (
                <div className="d-flex flex-wrap gap-2">
                  <StatusPill status={detail.status} />
                  <button
                    className="btn btn-sm sky-btn-primary"
                    type="button"
                    disabled={!detail.continuationEligible || submitting || archiving}
                    onClick={() => setShowContinue(true)}
                  >
                    Continue Session
                  </button>
                  <button
                    className="btn btn-sm sky-btn-ghost"
                    type="button"
                    disabled={Boolean(
                      detail.archivedAt ||
                        detail.status === 'ARCHIVED' ||
                        archiving ||
                        submitting ||
                        uncertain,
                    )}
                    onClick={archiveSession}
                  >
                    {archiving ? 'Archiving…' : 'Archive Session'}
                  </button>
                </div>
              ) : null
            }
          >
            {detailLoading ? (
              <div className="sky-empty-state py-4">Loading Session detail…</div>
            ) : detail ? (
              <>
                <dl className="row small">
                  <dt className="col-sm-3">Session</dt>
                  <dd className="col-sm-9 sky-mono">{detail.sessionId}</dd>
                  <dt className="col-sm-3">Project / Agent</dt>
                  <dd className="col-sm-9">
                    {detail.projectName || detail.projectCode} ·{' '}
                    {detail.agentName || detail.agentCode} · revision{' '}
                    {detail.agentRevision ?? detail.revision ?? '—'}
                  </dd>
                  <dt className="col-sm-3">Runtime / account</dt>
                  <dd className="col-sm-9">
                    {detail.runtimeKind} · {detail.runtimeProfile || '—'} ·{' '}
                    {detail.accountAlias || '—'}
                  </dd>
                  <dt className="col-sm-3">Session type</dt>
                  <dd className="col-sm-9">{detail.sessionModel || '—'}</dd>
                  <dt className="col-sm-3">Model / effort</dt>
                  <dd className="col-sm-9">
                    {detail.compatibility?.model || '—'} ·{' '}
                    {detail.compatibility?.reasoningEffort || '—'}
                  </dd>
                  <dt className="col-sm-3">Owner</dt>
                  <dd className="col-sm-9">
                    {detail.initiatingUserName || detail.initiatingUserId || '—'}
                  </dd>
                  <dt className="col-sm-3">Created / activity</dt>
                  <dd className="col-sm-9">
                    {formatDate(detail.createdAt)} / {formatDate(detail.lastActivityAt)}
                  </dd>
                  <dt className="col-sm-3">Provider conversation</dt>
                  <dd className="col-sm-9">
                    {detail.providerConversationAvailability || 'UNKNOWN'}
                  </dd>
                  <dt className="col-sm-3">Compatibility / freshness</dt>
                  <dd className="col-sm-9">
                    {detail.compatibility?.compatible
                      ? 'Compatible'
                      : detail.compatibility?.reason || 'Unknown'}{' '}
                    · {detail.compatibility?.freshnessStatus || 'UNKNOWN'}
                  </dd>
                  {detail.archivedAt ? (
                    <>
                      <dt className="col-sm-3">Archived</dt>
                      <dd className="col-sm-9">{formatDate(detail.archivedAt)}</dd>
                    </>
                  ) : null}
                </dl>
                <div
                  className={`alert ${detail.continuationEligible ? 'alert-success' : 'alert-warning'}`}
                  role="status"
                >
                  {detail.continuationEligible
                    ? 'Available for continuation. Current authority is checked again when a new Run is admitted.'
                    : `Continuation blocked: ${continuationLabel(detail)}`}
                </div>
                {showContinue ? (
                  <form onSubmit={continueSession} data-testid="agent-session-continue-form">
                    <label className="form-label" htmlFor="agent-session-instruction">
                      Next instruction
                    </label>
                    <textarea
                      id="agent-session-instruction"
                      className="form-control"
                      rows="5"
                      maxLength={20000}
                      value={instruction}
                      disabled={submitting || uncertain}
                      onChange={(event) => {
                        setInstruction(event.target.value);
                        pendingCommand.current = null;
                      }}
                    />
                    <div className="small sky-muted mt-2">
                      This creates a new Run in the same owned conversation using the Project, Agent
                      and runtime shown above. Acceptance starts durable execution; completion
                      appears in Agent Operations.
                    </div>
                    {uncertain ? (
                      <div className="alert alert-warning mt-2">
                        Submission outcome is uncertain. Retry uses the same saved instruction and
                        idempotency key to reconcile this request.
                      </div>
                    ) : null}
                    <button
                      className="btn sky-btn-primary mt-3"
                      type="submit"
                      disabled={!detail.continuationEligible || submitting || !instruction.trim()}
                    >
                      {submitting
                        ? 'Submitting…'
                        : uncertain
                          ? 'Retry continuation request'
                          : 'Submit continuation'}
                    </button>
                  </form>
                ) : null}
                <h3 className="h6 mt-4">Run timeline</h3>
                {!detail.runs?.length ? (
                  <div className="sky-empty-state py-3">No visible Runs.</div>
                ) : (
                  <div className="table-responsive">
                    <table
                      className="table table-sm align-middle sky-table"
                      aria-label="Session Run timeline"
                    >
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Status / result</th>
                          <th>Model</th>
                          <th>Effects / artifacts</th>
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.runs.map((run) => (
                          <tr key={run.runId} data-agent-session-run-id={run.runId}>
                            <td>
                              <Link
                                to={`/agents/operations?runId=${encodeURIComponent(run.runId)}`}
                                className="sky-mono"
                              >
                                {run.runId.slice(0, 12)}
                              </Link>
                            </td>
                            <td>
                              <StatusPill status={run.status} />
                              <div className="small">{run.resultStatus || '—'}</div>
                            </td>
                            <td>
                              {run.model || '—'}
                              <div className="small sky-muted">{run.reasoningEffort || '—'}</div>
                            </td>
                            <td>
                              {run.capabilityEffectCount ?? 0} effects · {run.artifactCount ?? 0}{' '}
                              artifacts
                            </td>
                            <td className="small">{formatDate(run.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {detail.runPage?.hasMore ? (
                  <div className="small sky-muted">
                    Showing the first {detail.runs.length} Runs. Additional Run evidence is
                    available in Agent Operations.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="sky-empty-state py-4">Session detail is unavailable.</div>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}

export { continuationLabel, formatDate };
export default AgentSessions;
