# Phase 0 runtime certification matrix

The adapter contract is provider-neutral. Provider-specific RPC names, transcripts, environment conventions, and capability extensions belong only inside later adapter implementations. Documentation is not conformance evidence.

| Runtime/candidate              | Pin/schema present in checkout                                                      | Required Phase 0 conclusion                                                                        | Execution status |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------- |
| Codex managed local app-server | No binary, generated protocol schema, containment evidence, or pinned image present | Candidate remains `UNVERIFIED`; local pilot acceptance and exact protocol capture are future gates | Disabled         |
| OpenClaw managed Gateway       | No binary, pinned client/schema, or containment evidence present                    | Candidate remains `UNVERIFIED`; independent second-runtime certification is a future gate          | Disabled         |
| Fake persistent runtime        | Source-controlled fixture                                                           | Must reconcile delayed usage and provide stable session behavior                                   | Fixture only     |
| Fake ephemeral runtime         | Source-controlled fixture                                                           | Must surface session loss and absent usage without inventing values                                | Fixture only     |

Required capability statuses are `SUPPORTED`, `UNSUPPORTED`, or `UNVERIFIED`. An `UNVERIFIED` security capability cannot satisfy a launch requirement. Unknown send acceptance permits reconciliation only; it does not permit blind resubmission. No provider binary is downloaded or launched by Phase 0.
