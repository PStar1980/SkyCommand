# Build Admin-Web from a compact, Linux-native dependency manifest rather than
# the full SkyCommand development dependency tree. Vite 8 supports Node 20.19+
# and the current Node 20 image satisfies that build-time requirement.
FROM node:20-bookworm-slim AS web-dependencies

ENV HUSKY=0

WORKDIR /opt/skycommand-web

COPY docker/web.package.json ./package.json
RUN npm install --package-lock=false --no-audit --no-fund

FROM node:20-bookworm-slim AS web-builder

ARG VITE_SUPERVISOR_BASE_URL=http://127.0.0.1:17170

ENV NODE_ENV=production \
    HUSKY=0 \
    VITE_API_BASE_URL="" \
    VITE_SUPERVISOR_BASE_URL=${VITE_SUPERVISOR_BASE_URL}

WORKDIR /app

COPY --from=web-dependencies /opt/skycommand-web/node_modules ./node_modules
COPY apps/admin-web ./apps/admin-web

RUN ./node_modules/.bin/vite build --config apps/admin-web/vite.config.js

# The deployment image is intentionally an unprivileged static web server.
# NGINX listens on 8080 inside the container and proxies same-origin API calls
# to the Compose API service, keeping the browser/API contract independent of
# Docker host networking.
FROM nginxinc/nginx-unprivileged:1.31.3-alpine3.24 AS web-runtime

COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/admin-web/dist /usr/share/nginx/html

EXPOSE 8080
