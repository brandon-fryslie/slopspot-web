FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
