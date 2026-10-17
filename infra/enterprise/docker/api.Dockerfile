# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN apt-get update \
  && apt-get install --no-install-recommends -y git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm run build:lib:host \
  && pnpm exec tsc -p apps/cli/tsconfig.json \
  && pnpm --filter @deepseek-ai/dsh-enterprise-api run build \
  && pnpm exec tsx apps/api/scripts/prepare-profile.ts

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DSH_HOME=/workspace/.artifacts/enterprise/home \
    ENTERPRISE_API_HOST=0.0.0.0 \
    ENTERPRISE_API_PORT=8787
WORKDIR /workspace
COPY --from=build /workspace /workspace
EXPOSE 8787
CMD ["node", "apps/cli/lib/bin.js", "--profile", "enterprise-api"]
