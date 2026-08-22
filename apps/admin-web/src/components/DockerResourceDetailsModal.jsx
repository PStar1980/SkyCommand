import { useEffect } from 'react';
import StatusPill from './ui/StatusPill.jsx';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function DetailRow({ label, children, mono = false }) {
  return (
    <>
      <dt className="col-md-3 sky-detail-label">{label}</dt>
      <dd className={`col-md-9 sky-detail-value${mono ? ' sky-mono text-break' : ''}`}>
        {children ?? '—'}
      </dd>
    </>
  );
}

function CleanupPolicy({ canCleanup, controlling, onControl, resource, resourceType }) {
  const cleanup = resource?.cleanup || resource?.inventoryCleanup || {};
  const protectedData = cleanup.mode === 'DATA_PROTECTED';
  const systemProtected = cleanup.mode === 'SYSTEM_PROTECTED';

  if (protectedData) {
    return (
      <div className="d-flex flex-wrap align-items-center gap-2">
        <StatusPill label="Data protected" status="BLOCKED" />
        <span className="small sky-muted">
          SkyCommand never exposes Docker volume deletion; detached storage may still contain persistent application data.
        </span>
      </div>
    );
  }

  if (systemProtected) {
    return (
      <div className="d-flex flex-wrap align-items-center gap-2">
        <StatusPill label="System protected" status="BLOCKED" />
        <span className="small sky-muted">Docker built-in networks cannot be removed through SkyCommand.</span>
      </div>
    );
  }

  if (!canCleanup) return <StatusPill label="Cleanup read only" status="INFO" />;

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <button
        className="btn btn-sm sky-btn-ghost"
        disabled={Boolean(controlling) || !cleanup.eligible}
        onClick={() => onControl(resource, 'REMOVE')}
        type="button"
      >
        {controlling === 'REMOVE' ? 'Removing…' : resourceType === 'IMAGE' ? 'Remove unused image' : 'Remove unused network'}
      </button>
      <StatusPill
        label={cleanup.eligible ? 'Cleanup eligible' : `${cleanup.usageCount || 0} attachment(s)`}
        status={cleanup.eligible ? 'READY' : 'WARNING'}
      />
    </div>
  );
}

function UsageTable({ containers = [] }) {
  if (containers.length === 0) return <div className="sky-empty-state py-4">No container attachments detected.</div>;
  return (
    <div className="table-responsive sky-table-card border-0 rounded-0">
      <table className="table table-sm sky-table align-middle mb-0">
        <thead><tr><th>Container</th><th>Image</th><th>State</th><th>Status</th></tr></thead>
        <tbody>
          {containers.map((container) => (
            <tr key={container.id || container.name}>
              <td className="fw-semibold">{container.name || container.id || '—'}</td>
              <td>{container.image || '—'}</td>
              <td><StatusPill status={container.state || 'INFO'} /></td>
              <td>{container.status || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DockerResourceDetailsModal({
  canCleanup,
  embedded = false,
  controlling,
  detail,
  error,
  loading,
  onClose,
  onControl,
  onRefresh,
  resourceTypeHint = '',
}) {
  useEffect(() => {
    if (embedded) return undefined;
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose]);

  const resource = detail?.resource || null;
  const resourceType = String(detail?.resourceType || resource?.resourceType || resourceTypeHint || '').toUpperCase();
  const title = resourceType === 'IMAGE'
    ? resource?.reference || resource?.repoTags?.[0] || resource?.id
    : resource?.name || resource?.id;
  const embeddedKicker = resourceType === 'IMAGE'
    ? 'Selected image workspace'
    : resourceType === 'VOLUME'
      ? 'Selected storage workspace'
      : resourceType === 'NETWORK'
        ? 'Selected network workspace'
        : 'Selected resource workspace';
  const embeddedTitle = resourceType === 'IMAGE'
    ? 'Image Details'
    : resourceType === 'VOLUME'
      ? 'Storage Details'
      : resourceType === 'NETWORK'
        ? 'Network Details'
        : 'Resource Details';
  const usageContainers = Array.isArray(resource?.usageContainers) ? resource.usageContainers : [];
  const labels = Array.isArray(resource?.labels) ? resource.labels : [];

  return (
    <div
      aria-label="Docker resource details"
      aria-modal={embedded ? undefined : 'true'}
      className={embedded ? 'sky-card mb-4 sky-docker-inline-detail-workspace' : 'sky-chart-modal-backdrop sky-tool-details-modal-backdrop'}
      onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget) onClose(); }}
      role={embedded ? undefined : 'dialog'}
    >
      <section className={embedded ? '' : 'sky-chart-modal sky-tool-details-modal'}>
        <div className={embedded ? 'sky-card-header d-flex flex-wrap align-items-start justify-content-between gap-3' : 'sky-chart-modal-header'}>
          <div>
            <div className={`sky-page-kicker${embedded ? '' : ' sky-chart-modal-kicker'}`}>
              {embedded ? embeddedKicker : `Docker ${resourceType.toLowerCase()} details`}
            </div>
            <h2 className={embedded ? 'h5 mb-1' : undefined}>
              {embedded ? embeddedTitle : title || 'Resource details'}
            </h2>
            <p className={embedded ? 'small sky-muted mb-0' : undefined}>
              {embedded
                ? `${title || 'Selected resource'} · Deep host-native inspection with attachment-aware cleanup policy.`
                : 'Deep host-native inspection with attachment-aware cleanup policy.'}
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-sm sky-btn-ghost" disabled={loading} onClick={onRefresh} type="button">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {!embedded && (
              <button aria-label="Close Docker resource details" className="sky-chart-modal-close" onClick={onClose} type="button">
                <svg aria-hidden="true" className="sky-chart-modal-close-icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>
        </div>

        <div className={embedded ? 'sky-card-body' : 'sky-tool-details-modal-body'}>
          {error && <div className="alert alert-danger">{error}</div>}
          {loading && !resource ? (
            <div className="sky-empty-state py-5"><div className="spinner-border text-info" role="status" aria-label="Loading" /></div>
          ) : !resource ? (
            <div className="sky-empty-state py-5">Docker resource details are unavailable.</div>
          ) : (
            <>
              <section className="sky-card mb-3">
                <div className="sky-card-header">
                  <h3 className="h5 mb-1">Cleanup Policy</h3>
                  <div className="small sky-muted">No global prune surface, no force flags, and no persistent-volume deletion.</div>
                </div>
                <div className="sky-card-body">
                  <CleanupPolicy
                    canCleanup={canCleanup}
                    controlling={controlling}
                    onControl={onControl}
                    resource={resource}
                    resourceType={resourceType}
                  />
                </div>
              </section>

              <section className="sky-card mb-3">
                <div className="sky-card-header"><h3 className="h5 mb-0">Resource Identity</h3></div>
                <div className="sky-card-body">
                  <dl className="row g-2 mb-0">
                    {resourceType === 'IMAGE' && <>
                      <DetailRow label="Reference" mono>{resource.reference}</DetailRow>
                      <DetailRow label="Image ID" mono>{resource.id}</DetailRow>
                      <DetailRow label="Repo tags">{resource.repoTags?.join(', ') || `${resource.repository || '—'}:${resource.tag || '—'}`}</DetailRow>
                      <DetailRow label="Repo digests" mono>{resource.repoDigests?.join(', ') || '—'}</DetailRow>
                      <DetailRow label="Size">{formatBytes(resource.sizeBytes) || resource.size}</DetailRow>
                      <DetailRow label="Platform">{[resource.operatingSystem, resource.architecture].filter(Boolean).join(' / ') || '—'}</DetailRow>
                    </>}
                    {resourceType === 'VOLUME' && <>
                      <DetailRow label="Name" mono>{resource.name}</DetailRow>
                      <DetailRow label="Driver">{resource.driver}</DetailRow>
                      <DetailRow label="Scope">{resource.scope}</DetailRow>
                      <DetailRow label="Project">{resource.project || '—'}</DetailRow>
                      <DetailRow label="Mountpoint" mono>{resource.mountpoint}</DetailRow>
                    </>}
                    {resourceType === 'NETWORK' && <>
                      <DetailRow label="Name">{resource.name}</DetailRow>
                      <DetailRow label="Network ID" mono>{resource.id}</DetailRow>
                      <DetailRow label="Driver">{resource.driver}</DetailRow>
                      <DetailRow label="Scope">{resource.scope}</DetailRow>
                      <DetailRow label="Project">{resource.project || '—'}</DetailRow>
                      <DetailRow label="Flags">{[resource.internal && 'internal', resource.attachable && 'attachable', resource.ingress && 'ingress', resource.ipv6 && 'IPv6'].filter(Boolean).join(', ') || '—'}</DetailRow>
                    </>}
                    <DetailRow label="Created">{formatDate(resource.createdAt)}</DetailRow>
                    <DetailRow label="Attachments">{resource.usageCount ?? usageContainers.length}</DetailRow>
                  </dl>
                </div>
              </section>

              {resourceType === 'NETWORK' && Array.isArray(resource.ipam) && resource.ipam.length > 0 && (
                <section className="sky-card mb-3">
                  <div className="sky-card-header"><h3 className="h5 mb-0">IPAM</h3></div>
                  <div className="sky-card-body">
                    {resource.ipam.map((config, index) => (
                      <div className="small sky-mono mb-2" key={`${config.subnet}-${index}`}>
                        {config.subnet || 'No subnet'}{config.gateway ? ` · gateway ${config.gateway}` : ''}{config.ipRange ? ` · range ${config.ipRange}` : ''}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="sky-card mb-3">
                <div className="sky-card-header"><h3 className="h5 mb-0">Container Attachments</h3></div>
                <UsageTable containers={usageContainers} />
              </section>

              {labels.length > 0 && (
                <section className="sky-card mb-3">
                  <div className="sky-card-header"><h3 className="h5 mb-0">Labels</h3></div>
                  <div className="sky-card-body">
                    {labels.map((label) => (
                      <div className="small sky-mono text-break mb-2" key={label.key}><strong>{label.key}</strong> = {label.value || '—'}</div>
                    ))}
                  </div>
                </section>
              )}

              <div className="small sky-muted">
                Captured {formatDate(detail.capturedAt)} through the host-native SkyCommand Host Agent. Raw Docker resource payloads are normalized before reaching Admin-Web.
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default DockerResourceDetailsModal;
