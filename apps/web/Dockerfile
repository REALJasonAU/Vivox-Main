FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ ./
ARG API_URL=http://api:8080
ENV API_URL=$API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY apps/web/ws-proxy.mjs ./ws-proxy.mjs
COPY apps/web/start-with-ws-proxy.sh ./start-with-ws-proxy.sh
COPY apps/web/package.json ./package.json
RUN npm install http-proxy@1.18.1 --omit=dev --no-package-lock && rm package.json
RUN chmod +x ./start-with-ws-proxy.sh
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_INTERNAL_PORT=3001
ENV NEXT_INTERNAL_HOST=127.0.0.1
ENV NEXT_INTERNAL_URL=http://127.0.0.1:3001
CMD ["sh", "./start-with-ws-proxy.sh"]
