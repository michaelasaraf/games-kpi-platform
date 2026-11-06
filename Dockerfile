# The dashboard service: builds the React app and runs the API that also serves it.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev
COPY --from=web /web/dist /app/web/dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
