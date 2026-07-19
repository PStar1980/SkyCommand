# Example Greeting Tool

This package is the Phase 15 starter template for a managed SkyCommand Node.js tool.

## Usage

```text
node tool.js [name]
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
