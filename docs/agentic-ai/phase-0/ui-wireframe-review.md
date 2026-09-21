# Phase 0 Admin-Web wireframe review

Phase 0 reviews existing static surfaces and specifies future information architecture. Phase 19.1 adds only the bounded Agent Projects and Manage Agents metadata/preview surfaces; no Agent launch control, Run/Session route, or execution route is added.

| Current Phase 19.1 surface | Implemented presentation contract |
| ------------------------- | --------------------------------- |
| Agent Projects             | Visible Projects only; edit metadata, membership, registered repository/workspace bindings, and Project→Agent allow rules. |
| Manage Agents              | Project-scoped Agent/revision selection, runtime/account/profile metadata, immutable revision creation, and complete advisory authority preview. |

| Future surface      | Existing analogous surface reviewed                    | Required Phase 0 presentation contract                                                                                    |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Run Agent           | Workflow start catalogue and browser/tool run surfaces | Show registered Project/Agent revision, requested narrowing, authority preview, and disabled execution gate               |
| Operations          | Playwright/browser and workflow operations tables      | Separate Run, Session, Turn, provider operation, capability link, and root scope; never hide descendants                  |
| Sessions            | Existing session/admin history patterns                | Show provider reference as opaque evidence, not authorization; distinguish idle, running, waiting, stopping, and archived |
| Authority preview   | Workflow preflight/permission surfaces                 | Show requested/configured/granted differences, ceilings, obligations, and denial reasons                                  |
| Waiting/interaction | Existing workflow approval UI                          | Show pending/saved/applied decisions and exact digest/expiry; no automatic approval                                       |
| Root stop           | Existing worker/supervisor controls                    | Show authority revocation separately from provider/process stop confirmation; `UNKNOWN` remains visible                   |

Unknown, stale, unavailable, and not-reported telemetry must be visibly distinct from zero, current, or successful. Static review is not a claim that these surfaces are implemented.
