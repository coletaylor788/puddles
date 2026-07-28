# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG BASE_IMAGE=openclaw-sandbox:bookworm-slim

FROM ${NODE_IMAGE} AS todoist-cli
ARG TODOIST_CLI_VERSION=3.0.5
WORKDIR /opt/todoist-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && ln -s /opt/todoist-cli/node_modules/.bin/td /usr/local/bin/td \
    && test "$(td --version)" = "${TODOIST_CLI_VERSION}"

FROM ${BASE_IMAGE}
ARG TODOIST_CLI_VERSION=3.0.5
USER root
COPY --from=todoist-cli /usr/local/ /usr/local/
COPY --from=todoist-cli /opt/todoist-cli/ /opt/todoist-cli/
RUN test "$(td --version)" = "${TODOIST_CLI_VERSION}"
LABEL org.puddles.todoist-cli.version="${TODOIST_CLI_VERSION}"
USER sandbox
