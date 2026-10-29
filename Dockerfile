FROM node:24-slim AS build
WORKDIR /app
# git lets vite.config.ts read the commit for the footer; node:24-slim doesn't ship it
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
# Copy everything first: postinstall needs svelte.config and tsconfig for `svelte-kit sync`
COPY . .
RUN npm ci && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# shortcut: ships full node_modules (Prisma CLI is needed for migrate deploy); prune if image size ever matters
COPY --from=build /app /app
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
