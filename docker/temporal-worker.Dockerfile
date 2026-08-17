FROM node:22-bookworm-slim

ENV NODE_ENV=development \
    HUSKY=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      openssh-client \
      postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
RUN mkdir -p /app/logs && chown -R node:node /app/logs

USER node

CMD ["node", "packages/temporal/src/worker.js"]
