FROM node:22-bookworm-slim AS package-build
ARG SKYCOMMAND_CODEX_COMPAT_PROFILE=codex-0.156.1
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/tmp/probe-build-home \
    CODEX_HOME=/tmp/probe-build-home/codex \
    TMPDIR=/tmp
WORKDIR /opt/codex-compat-probe
COPY contract.json contract.js packageSetup.js ./
COPY candidates/codex-0.154.0/contract.json ./candidates/codex-0.154.0/contract.json
RUN SKYCOMMAND_CODEX_COMPAT_PROFILE=${SKYCOMMAND_CODEX_COMPAT_PROFILE} node packageSetup.js

FROM node:22-bookworm-slim AS probe
ARG SKYCOMMAND_CODEX_COMPAT_PROFILE=codex-0.156.1
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/probe-home \
    CODEX_HOME=/probe-home/codex \
    CODEX_DISABLE_AUTOUPDATE=1 \
    SKYCOMMAND_PROBE_EXECUTION_DISABLED=1 \
    SKYCOMMAND_CODEX_COMPAT_PROFILE=${SKYCOMMAND_CODEX_COMPAT_PROFILE} \
    TMPDIR=/tmp \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NO_COLOR=1
WORKDIR /opt/codex-compat-probe
COPY --from=package-build --chown=0:0 /opt/codex-compat-probe/packages ./packages
COPY --from=package-build --chown=0:0 /opt/codex-compat-probe/package-attestations.json ./package-attestations.json
COPY --chown=0:0 contract.json contract.js probe.js ./
COPY --chown=0:0 candidates/codex-0.154.0/contract.json ./candidates/codex-0.154.0/contract.json
USER 10001:10001
ENTRYPOINT ["node", "/opt/codex-compat-probe/probe.js"]
