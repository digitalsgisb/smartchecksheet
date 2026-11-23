FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
COPY shared ./shared
ARG APP_BUILD_REVISION=
RUN APP_BUILD_REVISION="$APP_BUILD_REVISION" npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3700 DATABASE_PATH=/app/data/production.sqlite
WORKDIR /app
# LibreOffice turns the filled PRS form (server/templates) into the shift PDF. Carlito and Liberation match the
# template's Calibri and Arial widths so the printed layout keeps its line breaks.
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-calc-nogui fonts-crosextra-carlito fonts-liberation2 fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package*.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
# Packed into the per-line Pi installer downloaded from Lines & machines.
COPY --chown=node:node deploy/install-pi.sh deploy/checksheet_event_relay.py deploy/checksheet-relay@.service ./deploy/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3700
CMD ["node", "server/index.js"]
