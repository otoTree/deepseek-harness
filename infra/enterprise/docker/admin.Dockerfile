FROM node:22-bookworm-slim AS build

WORKDIR /workspace
# Index updates clear cached packages, so retry each APT command separately.
RUN retry_apt() { \
    for attempt in 1 2 3 4 5; do \
      apt-get -o Acquire::Retries=5 "$@" && return 0; \
      if [ "$attempt" -eq 5 ]; then return 1; fi; \
      sleep 5; \
    done; \
  }; \
  retry_apt update \
  && retry_apt install --no-install-recommends -y git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @deepseek-ai/dsh-enterprise-admin run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /workspace
COPY --from=build /workspace/apps/admin/.next/standalone ./
COPY --from=build /workspace/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /workspace/apps/admin/public ./apps/admin/public
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
