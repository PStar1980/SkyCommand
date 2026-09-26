FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CODEX_EGRESS_PROXY_PORT=3128 \
    CODEX_EGRESS_ALLOWLIST_PATH=/etc/skycommand/provider-allowlist.txt

WORKDIR /opt/skycommand-codex-egress
COPY src ./src
USER node
EXPOSE 3128
CMD ["node", "src/index.js"]
