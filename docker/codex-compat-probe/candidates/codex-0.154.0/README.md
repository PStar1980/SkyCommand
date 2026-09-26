# Codex 0.154.0 isolated diagnostic candidate

This is a separate, source-pinned sterile probe profile comparing the currently
blocked production baseline `0.155.0-alpha.9.2` with exact candidate `0.154.0`
on Linux x64. It does not change the production pin or reuse managed account,
enrollment, home, credentials, worker, bridge, or lifecycle state.

The wrapper and platform identities in `contract.json` were read from the exact
version records in the public npm registry. The profile pins wrapper version,
Linux-x64 platform version, SHA-512 SRI, SHA-1 shasum, and the wrapper's exact
Linux-x64 optional dependency alias. The existing package setup will validate
the generated v3 package-lock entries, exact registry tarball paths, installed
package manifests, and installed-artifact SHA-256. A package-lock SHA-256 is
runtime evidence and remains unavailable until the separately authorized
isolated image build/probe is actually run.

Registry records: [wrapper `@openai/codex@0.154.0`](https://registry.npmjs.org/%40openai%2Fcodex/0.154.0)
and [Linux-x64 `@openai/codex@0.154.0-linux-x64`](https://registry.npmjs.org/%40openai%2Fcodex/0.154.0-linux-x64).

The profile shares the existing sterile harness and its bounded A0 schema
matrix: `initialize`, `initialized`, `account/read`,
`account/login/start(chatgptDeviceCode)`, `account/login/completed`,
`account/updated`, `account/logout`, `account/rateLimits/read`,
`account/usage/read`, `thread/start`, `thread/resume`, `turn/start`, and
`turn/interrupt`. Schema presence is introspection only. Runtime requests remain
limited to initialize and unauthenticated `account/read`; login and turn methods
are never invoked.

The future isolated run uses `network_mode: none`, non-root UID 10001, read-only
root filesystem, dropped Linux capabilities, and only fresh `/tmp` and
`/probe-home` tmpfs. It has no credentials, host binds, volumes, production
home, Docker socket, provider connectivity, enrollment authority, or execution
capability. The package-build stage obtains only the exact pinned baseline and
candidate archives; the runtime probe has no network.

No candidate package has been downloaded, installed, built, or executed in this
preparation slice. Docker was unavailable, so no probe result, schema digest,
package-lock digest, or compatibility qualification is claimed.

After independent Paul/Sky authorization of the isolated run, the exact path is:

```powershell
docker compose -f docker/codex-compat-probe/compose-0.154.0.yaml --profile isolated-codex-compat-0154 build codex-compat-probe-0154
docker compose -f docker/codex-compat-probe/compose-0.154.0.yaml --profile isolated-codex-compat-0154 run --rm --no-deps codex-compat-probe-0154
```
