FROM node:22-trixie-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-trixie-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV DB_DIALECT=sqlite
ENV SQLITE_PATH=/data/dev.sqlite

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/sqlite ./scripts/sqlite

RUN mkdir -p /data

EXPOSE 3000

CMD ["sh", "-c", "npm run sqlite:init && npm run start:prod"]
