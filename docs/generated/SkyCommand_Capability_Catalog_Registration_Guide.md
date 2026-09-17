# Capability Catalogue exporter Tool registration

The R1 migration registers this Tool through the governed database-upgrade path. The exporter is a low-risk, no-parameter Tool that reads live catalogue state and writes only the fixed generated JSON/XLSX paths under `docs/generated/`; it does not accept arbitrary SQL, destination paths, credentials, or executable overrides.

| Field                  | Registered value                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool code              | `capability_catalog_export`                                                                                                                                                         |
| Label                  | `Export Capability Catalogue`                                                                                                                                                       |
| Description            | Read the live SkyCommand PostgreSQL capability catalogue in a read-only transaction and write the human-readable XLSX plus machine-readable JSON snapshots under `docs/generated/`. |
| Runtime                | `node`                                                                                                                                                                              |
| Script path            | `scripts/capabilityCatalogExport.js`                                                                                                                                                |
| Permission             | `CAPABILITY_CATALOG_EXPORT`                                                                                                                                                        |
| Risk                   | `LOW`                                                                                                                                                                              |
| Confirmation           | `false` because the exporter is strictly read-only and writes only ignored documentation snapshots                                                                                  |
| Timeout                | `600` seconds                                                                                                                                                                      |
| Structured output type | `capability_catalog_summary.v1`                                                                                                                                                     |
| Parameters             | None                                                                                                                                                                               |

| Visibility             | `cli`, `admin-web`, `api`, `worker`                                                                                                                                                 |

The registration is provided by migration `00133__capability_catalog_export_and_workflow_integration.sql`. The migration grants the dedicated permission only to the existing `SUPER_ADMIN`, `ADMIN`, and `OPERATOR` roles, preserves the Tool result contract, and leaves the generated outputs ignored by Git. Registration remains subject to the live Tool catalogue's existing authorization and visibility rules.
