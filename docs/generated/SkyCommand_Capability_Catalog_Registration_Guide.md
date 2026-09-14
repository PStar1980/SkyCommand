# Proposed Step B exporter Tool registration

This is a source-controlled proposal only. Step B does not register or modify the live Tool catalogue. Paul and Sky should perform the first registration through SkyCommand's existing administration surface after source review and promotion.

| Field                  | Proposed value                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool code              | `capability_catalog_export`                                                                                                                                                         |
| Label                  | `Export Capability Catalogue`                                                                                                                                                       |
| Description            | Read the live SkyCommand PostgreSQL capability catalogue in a read-only transaction and write the human-readable XLSX plus machine-readable JSON snapshots under `docs/generated/`. |
| Runtime                | `node`                                                                                                                                                                              |
| Script path            | `scripts/capabilityCatalogExport.js`                                                                                                                                                |
| Desired permission     | `CAPABILITY_CATALOG_EXPORT`                                                                                                                                                         |
| Risk                   | `LOW` or the repository's existing read-only risk code                                                                                                                              |
| Confirmation           | `false` because the exporter is strictly read-only and writes only ignored documentation snapshots                                                                                  |
| Timeout                | `120` seconds recommended                                                                                                                                                           |
| Structured output type | `capability_catalog_summary.v1`                                                                                                                                                     |
| Parameters             | None                                                                                                                                                                                |

`CAPABILITY_CATALOG_EXPORT` is the desired dedicated permission for this exporter. Tool registration is deferred until that permission can be introduced through SkyCommand's governed database-upgrade mechanism; Step B does not create the permission or modify the database. The registration should remain disabled until the administrator verifies the script path, output contract, permission, and ignored output root. Registration remains subject to the live Tool catalogue's existing authorization and visibility rules.
