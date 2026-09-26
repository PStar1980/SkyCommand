# Phase 19.3A — Authenticated Codex A/B Investigation Closeout

- **Record status:** Terminal evidence closeout; neither A/B leg may be retried.
- **Recorded:** 2026-09-24, from accepted host-validation evidence. This is not a claim about the experiment execution timestamps.
- **Record type:** Documentation/evidence summary, not a Supervisor, lifecycle, enrollment, or Dev Change Finalization receipt.

## Outcome

The sterile, unauthenticated compatibility probe passed for baseline Codex
`0.155.0-alpha.9.2` and candidate `0.156.1`. The authenticated comparison did
not reach a human device-code checkpoint for either version:

| Leg | Version | Result | Method / RPC code | Additional outcome |
|---|---|---|---|---|
| Baseline | `0.155.0-alpha.9.2` | `DEVICE_AUTH_RPC_ERROR` | `account/login/start` / `-32603` | None reported |
| Candidate | `0.156.1` | `DEVICE_AUTH_RPC_ERROR` | `account/login/start` / `-32603` | `AUTH_AB_EGRESS_POLICY_MISMATCH` |

The authenticated outcomes are terminal evidence, not permission to repeat
either leg. Neither version completed authentication or presented a human
device-code checkpoint. The matching RPC method and numeric code do not prove
that the two failures had the same cause or that the candidate is compatible
for authenticated use.

## Proven observations

- The sterile baseline/candidate probe result was accepted as `PASS`.
- Both authenticated legs returned `DEVICE_AUTH_RPC_ERROR` from
  `account/login/start` with JSON-RPC code `-32603`.
- Candidate egress diagnostics contained one allowed
  `auth.openai.com:443` event and three denied non-allowlisted destination
  events. The denied events remain source-unattributed; no raw hostnames or
  IP addresses are retained here.
- The candidate orchestration result included
  `AUTH_AB_EGRESS_POLICY_MISMATCH`.
- The provider allowlist remains unchanged. The current source file contains
  the exact entry `auth.openai.com`; no other hostname is configured.
- The production managed Codex package remains pinned to
  `0.155.0-alpha.9.2` in `docker/codex-agent-runtime/package.json` and its lock
  file. Candidate `0.156.1` remains confined to the isolated compatibility/A/B
  harness.
- Accepted host validation reports that both focused tests passed,
  authenticated A/B Compose `config --quiet` passed, and the hardened isolated
  runtime and egress-proxy images built successfully (`2/2`). No authentication
  retry was performed.
- The experiment did not change the production managed enrollment/runtime
  state, and Agent execution remains disabled.

## Unknown transport/application outcomes

- The three denied destinations' hostnames, code owners, and purpose are
  unknown and intentionally omitted. Their presence does not identify them as
  required authentication dependencies.
- There is insufficient evidence to determine whether those destinations
  serve a required authentication dependency, optional telemetry/update,
  background provider service, or another purpose.
- The accepted terminal summary does not establish the underlying TLS result,
  whether an HTTP response was received, its status class, or the specific
  application condition mapped to `-32603`. These details remain `UNKNOWN`;
  the numeric RPC failure alone does not resolve them.
- The later phase-correlated diagnostic implementation cannot retroactively
  add phase attribution to these completed attempts.

## Source-supported conclusions

- The evidence does not support adding any hostname to the provider allowlist.
  The existing exact-host policy is preserved.
- The sterile compatibility `PASS` establishes unauthenticated startup and
  protocol compatibility checks only; it does not establish authenticated
  device-code compatibility.
- The two `-32603` results establish a common observed failure boundary, not a
  common root cause, a package-version regression, or a successful
  authentication path.
- Phase-correlated egress and bounded transport/RPC diagnostics are now present
  in the isolated harness for a future separately authorized experiment. They
  retain safe event deltas and typed evidence without raw unknown hostnames,
  response bodies, credentials, or provider payloads. See
  `docker/codex-compat-probe/auth-ab/README.md` and
  `apps/codex-egress-proxy/src/authAbDiagnostics.js`.

## Future hypotheses — not findings

An auxiliary required authentication endpoint, optional telemetry/update
traffic, or a background provider service could account for denied egress, but
none is established by this record. Do not treat these possibilities as
allowlist recommendations. Any further experiment or source attribution needs
separate authorization and new evidence; this record does not authorize a
retry or policy expansion.

## Validation and scope

The accepted host validation covered:

- `npm run codex-compat-auth-ab:self-test` — passed;
- `npm run codex-compat-probe:self-test` — passed;
- authenticated A/B Compose `config --quiet` — passed;
- isolated runtime and egress-proxy image build — passed (`2/2`).

This closeout changed documentation only. It did not run authentication,
rebuild or restart production runtime, alter the database/enrollment/lifecycle,
change the production pin or provider allowlist, enable Agent execution,
finalize, or promote.
