FROM node:22-bookworm-slim AS codex-package

ENV NODE_ENV=production \
    HOME=/tmp \
    CODEX_HOME=/tmp/codex-package-install

WORKDIR /opt/skycommand-codex-package
COPY docker/codex-agent-runtime/package.json ./package.json
COPY docker/codex-agent-runtime/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS codex-runtime

ENV NODE_ENV=production \
    HOME=/var/lib/codex \
    CODEX_HOME=/var/lib/codex \
    CODEX_MANAGED_CONFIG=/etc/skycommand/codex/config.toml \
    CODEX_RUNTIME_CONTROL_PORT=4219 \
    CODEX_RUNTIME_CONTROL_TOKEN_FILE=/run/codex-runtime-control/runtime-control-token \
    CODEX_DISABLE_AUTOUPDATE=1 \
    CODEX_RUNTIME_BUILD_ID=phase19-3a0-codex-cli-0.154.0 \
    CODEX_MANAGED_MCP_URL=http://skycommand-codex-mcp-gateway:3981/mcp \
    HTTP_PROXY=http://skycommand-codex-egress-proxy:3128 \
    HTTPS_PROXY=http://skycommand-codex-egress-proxy:3128 \
    NO_PROXY=skycommand-codex-mcp-gateway,localhost,127.0.0.1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# The slim Node image intentionally omits Debian's ca-certificates package.
# Build the runtime trust bundle from Node's embedded Mozilla roots so image
# construction does not depend on Debian package-repository network access.
RUN set -eux; \
    mkdir -p /etc/ssl/certs; \
    node -e "const fs=require('node:fs'); const tls=require('node:tls'); fs.writeFileSync('/etc/ssl/certs/ca-certificates.crt', tls.rootCertificates.join('\n') + '\n', { mode: 0o644 });"; \
    test -s /etc/ssl/certs/ca-certificates.crt

WORKDIR /app
COPY --from=codex-package --chown=node:node /opt/skycommand-codex-package/node_modules ./node_modules
COPY --chown=node:node apps/codex-agent-runtime-worker/src ./apps/codex-agent-runtime-worker/src
COPY --chown=node:node packages/agents/src/continuationResult.js ./packages/agents/src/continuationResult.js
COPY --chown=node:node docker/codex-agent-runtime/package.json ./docker/codex-agent-runtime/package.json
COPY --chown=node:node docker/codex-agent-runtime/package-lock.json ./docker/codex-agent-runtime/package-lock.json
COPY --chown=node:node docker/codex-agent-runtime/config.toml /etc/skycommand/codex/config.toml
RUN node -e "require('./apps/codex-agent-runtime-worker/src/appServerClient.js')"
RUN node apps/codex-agent-runtime-worker/src/packageArtifactAttestation.js --write-build-attestation
RUN mkdir -p /var/lib/codex /etc/skycommand/codex /run/codex-runtime-control \
    && chown node:node /var/lib/codex /etc/skycommand/codex /run/codex-runtime-control \
    && chmod 0555 /etc/skycommand/codex \
    && chmod 0444 /etc/skycommand/codex/config.toml

USER node
EXPOSE 4219
CMD ["node", "apps/codex-agent-runtime-worker/src/index.js"]
