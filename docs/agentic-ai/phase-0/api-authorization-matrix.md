# Phase 0 API and authorization matrix

This is a pre-implementation authorization contract. It does not add routes.

| Operation class                 | Public input                                         | Server-derived/pinned context                                                       | Required authorization gate                                             |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Discover Project/Agent/runtime  | filters and cursor                                   | authenticated principal and visible object set                                      | Object-level read; filter before pagination/counts                      |
| Preview authority               | registered IDs, requested narrowing                  | user/actor, Project, Agent revision, runtime/account, environment, policy revisions | Evaluate intersection; missing required policy denies                   |
| Start Run                       | task input, selected registered IDs, idempotency key | immutable identity, root scope, lineage, authority snapshot, credentials, workspace | Admission transaction; execution remains disabled until Phase 2/3       |
| Read Run/session/events         | Run/session ID, cursor                               | linked Project, root, ACL, retained-data policy                                     | Per-object ACL; opaque IDs are not authorization                        |
| Read linked capability/artifact | native execution/artifact ID                         | managed execution link, Project/root/run/data classification                        | Existing native permission plus managed-link ACL; no origin-only access |
| Cancel/root stop                | target ID and reason                                 | caller rights, current root epoch, stop state                                       | Live authorization; revoke future authority before physical stop        |
| Respond to interaction          | request ID, exact decision/input                     | eligible responder, action/input digest, policy revision, expiry                    | CAS decision persistence before delivery; Agent cannot self-approve     |
| Managed credential renewal      | opaque run grant reference                           | run/epoch, audience, scope, lease, credential hash                                  | Current root/run revocation and live policy                             |

Legacy Assistant credentials are not managed Agent credentials. An asserted `x-skycommand-agent-id` label is metadata, not a registered principal. Future managed credentials must be server-bound, short-lived, audience-bound, and scoped to one Run/epoch.

## Error and uncertainty rules

Unknown provider acceptance, unknown telemetry, unavailable policy storage, stale approval, revoked authority, and uncertain artifact integrity are explicit outcomes. They do not become success, a retry authorization, a fabricated usage value, or a broader permission. Approval can satisfy an obligation inside a ceiling but cannot union authority or enlarge a hard ceiling.
