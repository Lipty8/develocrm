FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY backend ./backend
RUN pnpm run backend:build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/backend/dist ./backend/dist
USER node
EXPOSE 3001
CMD ["node","backend/dist/server.js"]
