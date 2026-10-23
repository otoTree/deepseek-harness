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
  && pnpm exec tsx apps/api/scripts/prepare-profile.ts \
  && pnpm --filter @deepseek-ai/dsh-enterprise-api deploy --legacy --prod \
    --config.node-linker=hoisted \
    --config.auto-install-peers=false \
    --config.link-workspace-packages=true \
    --config.pnpmfile=/workspace/infra/enterprise/docker/api-deploy.pnpmfile.cjs /runtime

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DSH_HOME=/workspace/.artifacts/enterprise/home \
    ENTERPRISE_API_HOST=0.0.0.0 \
    ENTERPRISE_API_PORT=8787
WORKDIR /workspace
COPY --from=build /runtime/node_modules ./node_modules
# Legacy deploy omits packages selected by the workspace's link: overrides.
COPY --from=build /workspace/vendor/cosmokit/package.json /workspace/vendor/cosmokit/LICENSE ./node_modules/@deepseek-ai/cosmokit/
COPY --from=build /workspace/vendor/cosmokit/lib ./node_modules/@deepseek-ai/cosmokit/lib
COPY --from=build /workspace/vendor/schemastery/package.json /workspace/vendor/schemastery/LICENSE ./node_modules/@deepseek-ai/schemastery/
COPY --from=build /workspace/vendor/schemastery/lib ./node_modules/@deepseek-ai/schemastery/lib
COPY --from=build /workspace/apps/cli/lib ./apps/cli/lib
COPY --from=build /workspace/apps/cli/package.json ./apps/cli/package.json
COPY --from=build /workspace/apps/api/lib ./apps/api/lib
COPY --from=build /workspace/apps/api/package.json /workspace/apps/api/cordis.patch.yml ./apps/api/
COPY --from=build /workspace/apps/api/migrations ./apps/api/migrations
COPY --from=build /workspace/apps/api/scripts/initialize-container.mjs ./apps/api/scripts/initialize-container.mjs
COPY --from=build /workspace/.artifacts/enterprise/home ./.artifacts/enterprise/home
COPY --from=build /workspace/infra/enterprise/docker/api-entrypoint.sh ./infra/enterprise/docker/api-entrypoint.sh
EXPOSE 8787
ENTRYPOINT ["sh", "infra/enterprise/docker/api-entrypoint.sh"]
CMD ["node", "apps/cli/lib/bin.js", "--profile", "enterprise-api"]
