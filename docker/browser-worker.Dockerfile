# Dedicated Playwright runtime for SkyCommand browser tests/automation.
# Keep this image version exactly aligned with @playwright/test; Playwright
# browser binaries are version-coupled to the installed package.
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS browser-runtime

ENV NODE_ENV=production \
    HUSKY=0 \
    CI=true

WORKDIR /app

COPY docker/browser-worker.package.json ./package.json
RUN npm install --omit=dev --package-lock=false --no-audit --no-fund

COPY apps/browser-worker ./apps/browser-worker
COPY packages/browser ./packages/browser
COPY tests/browser ./tests/browser

RUN mkdir -p /app/artifacts/browser/tests

CMD ["node", "apps/browser-worker/src/index.js"]
