# AGENTS.md — SkyCommand Coding-Agent Rules

Read and follow `docs/development/SkyCommand_Development_Operating_Rules_v1.0.md` before making changes.

Hard rules for Codex/Luna/Astra and other coding agents:

1. Work only on the explicitly assigned task/phase. Never continue to the next phase without a new instruction.
2. Do not directly mutate Git. No commit, merge, push, pull, rebase, reset, checkout/switch, tag mutation, or branch deletion. Read-only Git inspection is allowed.
3. SkyCommand Development Promotion is the source-control mutation path. If explicitly instructed to start `skyserver_dev_commit`, stop after SkyCommand confirms the workflow was initiated. Never approve its merge step without a new explicit instruction from Paul.
4. Do not run destructive database operations. Never run `npm run db:build` against an existing development database. Do not apply migrations/seeds or execute DDL/DML without explicit approval for that exact operation or an approved SkyCommand capability.
5. Do not expose or copy secrets. Credential availability is not authorization.
6. Do not use Docker/Host Agent/OS administration/external network/package installation unless explicitly required and approved.
7. Preserve existing behavior outside the assigned scope. Do not weaken authorization/safety gates to make tests pass.
8. Report material architecture/repository discrepancies instead of silently improvising.
9. Run appropriate non-destructive validation and report exact results.
10. At task completion, report files changed, requirement mapping, validation, discrepancies, security decisions, deferred work, `git status`, and diff summary; then stop for review.

The authoritative Agentic AI roadmap is:
`docs/agentic-ai/SkyCommand_Agentic_AI_Architecture_and_Phased_Implementation_Plan_v1.0_APPROVED.md`
