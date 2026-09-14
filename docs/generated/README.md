# Generated capability catalogue snapshots

`SkyCommand_Capability_Catalog.json` and `SkyCommand_Capability_Catalog.xlsx` are read-only snapshots of the live SkyCommand development PostgreSQL catalogue. They are not runtime authority and are intentionally ignored by Git.

Regenerate them from the SkyCommand repository root with:

```bash
npm run capability-catalog:export
```

The exporter uses the existing database connection module, opens an explicit read-only transaction, selects only allowlisted columns, and applies the central redaction policy in `packages/capability-catalog/src/redaction.js`. It does not register or modify any database catalogue records.

The XLSX is a human-readable view. The pretty-printed JSON is the machine-readable snapshot source for review and later agent consumption.

The workbook includes separate `Workflow Parameters` and `Temporal Workflow Parameters` sheets. User-defined graph-workflow runtime parameter definitions come from `worker.workflow_definitions.config.runtimeParameters`; Temporal workflow parameters continue to come from `worker.temporal_workflow_parameters`. Registry support tables such as categories, runtimes, risk levels, visibility, and application/profile metadata are included as additional sheets. The existing `xlsx` dependency supplies column widths and filters; no additional spreadsheet package or styling subsystem is used.
