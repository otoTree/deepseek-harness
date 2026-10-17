# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

ARG NEXT_PUBLIC_ENTERPRISE_API_URL=http://127.0.0.1:8787
ENV NEXT_PUBLIC_ENTERPRISE_API_URL=${NEXT_PUBLIC_ENTERPRISE_API_URL}
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
RUN corepack enable
COPY --from=build /workspace /workspace
EXPOSE 3000
CMD ["pnpm", "--filter", "@deepseek-ai/dsh-enterprise-admin", "start", "--hostname", "0.0.0.0", "--port", "3000"]
