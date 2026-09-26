# Isolated Codex 0.156.1 compatibility probe

This opt-in probe compares the currently certified Codex `0.155.0-alpha.9.2`
baseline with candidate `0.156.1` on Linux x64. It is not part of the managed
runtime stack and never changes the production pin, lifecycle ledger, managed
home, credential volume, enrollment/account binding, worker, or control bridge.

The source-controlled contract pins both wrapper and Linux-x64 package versions,
SHA-512 integrity values, and the candidate SHA-1 registry shasums supplied for
this review. The package-build stage fetches only these exact package versions,
checks the downloaded tarball bytes before installation, uses `npm ci` with
lifecycle scripts disabled, revalidates lock/manifests, and records the same
installed-package tree SHA-256 attestation format used by the managed worker.
The probe runtime itself has `network_mode: none`; package registry access occurs
only during a later explicitly authorized image build, never during the
unauthenticated compatibility run.

The candidate Linux-x64 SRI is validated: it is 95 characters total, has an
88-character Base64 payload, and decodes to a 64-byte SHA-512 digest. It passes
the unchanged contract validator and focused compatibility-probe self-test.
This validates the pinned integrity input only; no candidate package has yet
been downloaded, installed, built, or executed, so there are no runtime
compatibility results yet.

The Compose profile is intentionally separate and contains no bind mounts,
named volumes, `.env`/`env_file`, port publications, secrets, Docker socket,
Git checkout, provider credentials, or production service dependency. Its only
writable paths are disposable `tmpfs` mounts for `/tmp` and `/probe-home`; the
Codex home is freshly created inside that tmpfs and disappears with the
container. It runs non-root, read-only rootfs, with all Linux capabilities
dropped and no network. No authentication RPC is sent. The only state RPC sent
is `account/read` with `refreshToken: false`; `account/login/start` is checked
from generated schema only.

The probe validates package lock identity, installed artifact digests, CLI
version output, schema generation and bounded schema differences, app-server
stdio startup, initialize/initialized, JSON-RPC 2.0 response envelopes and safe
request IDs, `account/read` response/error shape, and the schema presence of
`account/login/start` plus `chatgptDeviceCode`. It emits only safe status fields,
digests, bounded schema paths/change kinds, and typed failure codes. It does not
emit account payloads, email, raw RPC messages/data, credentials, tokens,
device codes, verification URLs, or provider payloads.

## Source-only review boundary

No package was fetched, candidate installed or executed, image built, container
started, or authentication attempted while implementing this harness. A later
authorized no-auth run would use:

```powershell
docker compose -f docker/codex-compat-probe/compose.yaml --profile isolated-codex-compat-probe build codex-compat-probe
docker compose -f docker/codex-compat-probe/compose.yaml --profile isolated-codex-compat-probe run --rm --no-deps codex-compat-probe
```

The second command runs with no network. Review the source-controlled contract
and build/runtime isolation before authorizing either command; image build
requires registry connectivity for the exact pinned package tarballs.
