# Intervolt ECMS — production image (works on x86_64 and ARM64, e.g. Oracle Cloud Always Free Ampere VMs)
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

FROM node:22-bookworm AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DRIVER=local STORAGE_LOCAL_DIR=/app/storage
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/src ./src
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply any pending database migrations, then start the web server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT}"]
