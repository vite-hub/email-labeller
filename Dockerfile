# Email labeller as one Node process: KV and the Gmail Channel's state in /app/.data, the Schedules on a timer.
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV LABELLER_HOST=node
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/.output ./.output
RUN mkdir .data && chown node:node .data
USER node
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
# Everything the labeller writes stays on the volume: the Gmail cursor and lock, KV, and the Invocation journal.
ENV VITEHUB_AGENT_STATE_URL=file:.data/agent-state.db VITEHUB_AGENT_INVOCATIONS_DATABASE_URL=file:.data/agent-invocations.sqlite
EXPOSE 3000
VOLUME /app/.data
HEALTHCHECK --interval=60s --timeout=10s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
