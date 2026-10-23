FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN apt-get update \
  && apt-get install --no-install-recommends -y git python3 make g++ \
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
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
