import PageHeader from '../components/ui/PageHeader.jsx';
import Panel from '../components/ui/Panel.jsx';
import StatusPill from '../components/ui/StatusPill.jsx';

function DockerOperations() {
  return (
    <>
      <PageHeader
        kicker="Docker · Governance"
        subtitle="SkyCommand-initiated Docker lifecycle actions will be recorded here separately from native Docker Engine events. The initial Phase 17 foundation is intentionally read-only."
        title="Docker Operations"
      />

      <Panel
        kicker="Phase 17 Foundation"
        subtitle="Write controls are not enabled yet. Start, stop, restart, recreate, pull, and guarded cleanup actions will land only after the provider contract, authorization, confirmation, and audit ledger are proven."
        title="Control Plane Guardrail"
      >
        <div className="sky-card-body">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <StatusPill label="Read-only foundation active" status="READY" />
            <StatusPill label="Docker write actions disabled" status="DISABLED" />
          </div>
          <p className="sky-muted mb-0">
            This page is reserved for SkyCommand-issued Docker operations. Native Engine
            events will remain provider telemetry rather than being mixed with operator audit
            history.
          </p>
        </div>
      </Panel>
    </>
  );
}

export default DockerOperations;
