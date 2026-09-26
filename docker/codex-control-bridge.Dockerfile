FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CODEX_CONTROL_BRIDGE_PORT=4220 \
    CODEX_RUNTIME_WORKER_URL=http://codex-agent-runtime-worker-runtime-control:4219 \
    CODEX_BRIDGE_TOKEN_FILE=/run/codex-api-bridge/api-bridge-token \
    CODEX_RUNTIME_TOKEN_FILE=/run/codex-runtime-control/runtime-control-token

WORKDIR /app
COPY --chown=node:node apps/codex-control-bridge/src ./apps/codex-control-bridge/src

USER node
EXPOSE 4220
CMD ["node", "apps/codex-control-bridge/src/index.js"]
