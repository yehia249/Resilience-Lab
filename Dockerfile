FROM node:20.20.2-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/local-adapter/package.json apps/local-adapter/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ENV VITE_LAB_MODE=live
RUN pnpm build
RUN pnpm exec esbuild apps/runtime/src/main.ts --bundle --platform=node --packages=external --format=esm --outfile=server.mjs && pnpm exec esbuild apps/runtime/src/otel.ts --bundle --platform=node --packages=external --format=esm --outfile=otel.mjs

FROM node:20.20.2-bookworm-slim AS service-deps
WORKDIR /app
RUN npm install -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/runtime/package.json apps/runtime/package.json
COPY apps/local-adapter/package.json apps/local-adapter/package.json
COPY packages/common/package.json packages/common/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM gcr.io/distroless/cc-debian12:nonroot AS service
COPY --from=service-deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=service-deps /app/node_modules ./node_modules
COPY --from=build /app/server.mjs /app/otel.mjs ./
COPY docs/benchmarks/results.json docs/benchmarks/results.json
USER 65532:65532
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["--import","./otel.mjs","server.mjs"]

FROM alpine:3.23.5 AS web
RUN apk upgrade --no-cache && apk add --no-cache nginx
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx-main.conf /etc/nginx/nginx.conf
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
USER 101:101
EXPOSE 8088
CMD ["nginx","-g","daemon off;"]
