# Keep the scheduler/listener worker dependency graph isolated from the full
# SkyCommand web-development manifest. Node 20 resolves the compact server-side
# dependency set; the actual worker remains on Node 22.
FROM node:20-bookworm-slim AS worker-dependencies

ENV NODE_ENV=production \
    HUSKY=0

WORKDIR /opt/skycommand-node-worker

COPY docker/node-worker.package.json ./package.json
RUN npm install --omit=dev --package-lock=false --no-audit --no-fund

FROM node:22-bookworm-slim AS worker-runtime

ENV NODE_ENV=production \
    HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      openssh-client \
      postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY docker/git-credential-skycommand.js /usr/local/bin/git-credential-skycommand
RUN chmod 0755 /usr/local/bin/git-credential-skycommand \
    && git config --system credential.helper skycommand

WORKDIR /app

COPY --from=worker-dependencies --chown=node:node /opt/skycommand-node-worker/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node

CMD ["node", "apps/worker/src/index.js"]
