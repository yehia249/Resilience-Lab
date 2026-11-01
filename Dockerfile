FROM node:20.19.5-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/local-adapter/package.json apps/local-adapter/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN pnpm exec esbuild apps/runtime/src/main.ts --bundle --platform=node --packages=external --format=esm --outfile=server.mjs && pnpm exec esbuild apps/runtime/src/otel.ts --bundle --platform=node --packages=external --format=esm --outfile=otel.mjs
FROM node:20.19.5-bookworm-slim AS service
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/local-adapter/package.json apps/local-adapter/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/server.mjs /app/otel.mjs ./
COPY docs/benchmarks/results.json docs/benchmarks/results.json
USER node
ENV NODE_ENV=production
CMD ["node","--import","./otel.mjs","server.mjs"]
FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8088
