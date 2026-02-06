FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build


FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY README.md LICENSE ./

EXPOSE 3000

# Central MCP server over HTTP (Streamable HTTP + optional legacy SSE).
CMD ["node", "dist/index.js", "http"]

