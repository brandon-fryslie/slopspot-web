ARG NODE_BASE=registry.sanctuary.gdn/node:22-alpine

FROM ${NODE_BASE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM ${NODE_BASE} AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
