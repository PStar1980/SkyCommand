FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CODEX_MCP_GATEWAY_PORT=3981

WORKDIR /app
COPY --chown=node:node apps/codex-mcp-gateway/src ./apps/codex-mcp-gateway/src

USER node
EXPOSE 3981
CMD ["node", "apps/codex-mcp-gateway/src/index.js"]
