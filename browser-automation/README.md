# SkyCommand Playwright Automation Source

Operational Playwright automations live here. These files are production automation assets rather than tests.

Phase 6 establishes the PostgreSQL registry, typed parameters, environment allow-lists, risk/confirmation metadata, side-effect and idempotency contracts, retry/concurrency configuration, and structured output contracts. Phase 7 connects these registered definitions to operator-facing execution surfaces.

Source conventions:

- Executable source lives beneath `browser-automation/scripts/`.
- PostgreSQL stores registration metadata; Git remains the source of truth for automation code.
- Automations return structured `SUCCESS` / `FAILED` results rather than Playwright `PASS` / `FAIL` assertions.
- Secrets are referenced through protected runtime configuration; they are never normal registry parameter values.
- Mutating and high-impact automations must declare side-effect/idempotency semantics before runtime execution is enabled.
