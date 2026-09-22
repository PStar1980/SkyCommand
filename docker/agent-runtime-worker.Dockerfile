FROM node:20-bookworm-slim AS worker-dependencies

ENV NODE_ENV=production \
    HUSKY=0

WORKDIR /opt/skycommand-agent-runtime-worker

COPY docker/agent-runtime-worker.package.json ./package.json
RUN npm install --omit=dev --package-lock=false --no-audit --no-fund

FROM node:22-bookworm-slim AS worker-runtime

ENV NODE_ENV=production \
    HUSKY=0

WORKDIR /app

COPY --from=worker-dependencies --chown=node:node /opt/skycommand-agent-runtime-worker/node_modules ./node_modules
COPY --chown=node:node packages/agents/src ./packages/agents/src
COPY --chown=node:node packages/agents/contracts ./packages/agents/contracts
COPY --chown=node:node packages/tools/src/jsonSchemaValidator.js ./packages/tools/src/jsonSchemaValidator.js
COPY --chown=node:node packages/temporal/src/config.js ./packages/temporal/src/config.js
COPY --chown=node:node apps/agent-runtime-worker/src ./apps/agent-runtime-worker/src

USER node

CMD ["node", "apps/agent-runtime-worker/src/index.js"]
