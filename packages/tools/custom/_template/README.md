# Example Greeting Tool

This package is the Phase 15 starter template for a managed SkyCommand Node.js tool.

## Usage

```text
node src/tool.js [name]
```

## Parameter

- `name` - optional string, defaults to `SkyCommand`.

## Structured output

The tool emits `example_greeting_summary.v1` with:

- `name`;
- `greeting`;
- `generatedAt`.

## Failure

A blank name raises `NAME_REQUIRED` and exits non-zero.

## Side effects and risk

The tool has no external side effects and is low risk.

## Onboarding lifecycle

Upload this descriptor to prefill registration. SkyCommand does not retain it after successful registration; PostgreSQL becomes authoritative. The script is promoted under `src/`, while an uploaded output schema is promoted to `packages/tools/contracts`.
