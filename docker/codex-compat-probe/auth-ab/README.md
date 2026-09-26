# Isolated authenticated Codex A/B harness

This harness supports a separately authorized, isolated comparison of the
certified baseline `0.155.0-alpha.9.2` with candidate `0.156.1`. The completed
Phase 19.3A authenticated A/B attempts are terminal; do not rerun either leg as
a retry. Their accepted evidence and the distinction between observations,
unknowns, conclusions, and hypotheses are recorded in
[`docs/agentic-ai/phase-19.3a/authenticated-ab-investigation-closeout.md`](../../../docs/agentic-ai/phase-19.3a/authenticated-ab-investigation-closeout.md).
This harness does not alter the production pin, managed enrollment/account,
runtime, Supervisor, lifecycle ledger, database, or control plane.

Each stage runs in a fresh one-shot container with a new `/probe-home` tmpfs,
read-only image root, non-root UID, all capabilities dropped, no secrets,
no host/home bind, no named volume, no Docker socket, no API/Supervisor/Git
connection, and execution disabled. The app-server RPC allowlist is exactly
`initialize`, `account/login/start`, and one `account/read`. It sends one
device-auth start, waits for the human checkpoint, and makes no post-login
account read until the operator confirms completion. It then makes exactly one
bounded `account/read` and exits; it never retries or starts agent execution.

Runtime egress is isolated behind a separate proxy container. The Codex client
is attached only to an `internal: true` network and has no default route; the
proxy is the sole member with an uplink. It uses the existing read-only
source-controlled provider allowlist, which is currently exactly
`auth.openai.com`; only exact hostnames on port 443 with public DNS results are
accepted by the proxy. Any additional required destination is denied and the
experiment stops for review. No wildcard or automatic allowlist expansion is
provided. The proxy is torn down and recreated between versions.

Baseline runs first. The coordinator does not start candidate until the
baseline app-server/container has exited, Compose teardown has completed, and
read-only checks confirm no project containers, networks, or volumes remain.
The runtime container has Docker's `none` logging driver so the transient
verification URL and user code are not retained in Docker logs. They are shown
once on the attached terminal only to support Paul's human login; they are
never included in JSON evidence, written to a file, or emitted by the proxy.
Credential state exists only under the container's disposable tmpfs and is
destroyed when the container exits. If the process or teardown fails, candidate
does not start.

Package/artifact integrity, installed-tree SHA-256, CLI version, bounded schema
tree, required schema methods, and app-server initialize identity are checked
independently for each version using the accepted compatibility contract.
Evidence output is a strict projection containing version, package and schema
digests, attempt ID, allowlisted protocol method names, result/account-state
category, timestamps, request ID/RPC code where safe, and bounded typed failure
codes. It omits the user code, verification URL, login reference, credentials,
tokens, cookies, headers, account payload, and arbitrary provider response data.
No evidence file is created by default; only sanitized JSON is emitted after a
stage completes.

### Phase-correlated egress evidence

In the isolated A/B profile only, the runner brackets these phases with the
proxy's private diagnostic boundary endpoint: app-server startup, initialize,
post-initialize idle, `account/login/start`, and post-request processing. Each
boundary captures the proxy's monotonic timestamp and event cursor/count; phase
completion returns only events after that cursor. Events contain a destination
class, an experiment-scoped HMAC fingerprint, port, decision, reason, timestamp,
and count. Unknown destinations are never returned as hostnames. The HMAC key is
random per experiment, held in process memory, shared across A and B proxy
lifetimes, and never included in evidence or written to disk.

The pinned app-server performs the device user-code request inside its
`account/login/start` handler and exposes no separate callback to this harness.
`DEVICE_CODE_USER_CODE_REQUEST` is therefore an explicitly marked alias of the
measured RPC envelope window, not a claim of an independently observed inner
boundary. Separating that inner call requires instrumentation in the pinned
app-server itself.

For `auth.openai.com`, proxy DNS and upstream TCP-connect failures are distinct.
The proxy's CONNECT tunnel does not inspect TLS payloads or encrypted HTTP
responses. The runner inspects an app-server error message only in memory and
projects strict recognized TLS, HTTP-status-class, and JSON-parse signals; the
raw message is discarded. A successful device-code result implies a parsed
2xx response. If the pinned app-server maps a lower-layer error to a generic
`-32603` without a recognized safe signal, evidence reports the confirmed RPC
mapping failure and leaves TLS/HTTP details unknown. The harness does not use
TLS interception, retain response bodies/headers, or infer transport success
from the proxy's historical `PUBLIC_ALLOWLISTED_TLS` reason (which records TCP
CONNECT establishment only).

## Future separately authorized invocation

The commands below describe a fresh, full sequential experiment and are not a
resume path for the terminal attempts recorded above. Any new experiment
requires separate authorization. Image build downloads only the four exact
package artifacts from the accepted compatibility contract; it does not
authenticate. The host-reported rebuild of the isolated runtime and proxy
images is evidence for the completed harness hardening, not authorization to
run either experiment leg again.

```powershell
docker compose -f docker/codex-compat-probe/auth-ab/compose.yaml `
  -p skycommand-codex-auth-ab --profile isolated-codex-auth-ab `
  build auth-ab-baseline auth-egress-proxy

node docker/codex-compat-probe/auth-ab/orchestrator.js --run-isolated-auth-ab
```

The orchestration flag is mandatory; without it the program returns
`NOT_STARTED`. During a later authorized run, complete baseline's browser login
and type `AUTHENTICATION_COMPLETED` in the attached terminal. Wait for baseline
safe evidence and teardown. Only after that verified teardown does the
coordinator start candidate and display its separate, fresh device-code
checkpoint. Do not reuse a code or account home between stages.
