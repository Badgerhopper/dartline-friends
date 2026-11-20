# DartLine Friends Edition: pinned InstaDarts source + original extensions.
FROM node:22.22.0-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
ARG INSTADARTS_COMMIT=a455d7f8c5c7df2b37f7d08fefac970ec9e74ea0
RUN git clone https://github.com/Instadarts/instadarts.git /source/instadarts && cd /source/instadarts && git checkout "$INSTADARTS_COMMIT"
COPY . /source/dartline
RUN python3 /source/dartline/scripts/apply_dartline.py /source/instadarts && python3 /source/dartline/scripts/add_phone_camera.py /source/instadarts
WORKDIR /source/instadarts
RUN npm ci && npm run build && npm test && npm prune --omit=dev

FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /source/instadarts /app
COPY --from=builder /source/dartline/scripts/start-server.mjs /app/dartline-start.mjs
EXPOSE 3000
CMD ["node", "/app/dartline-start.mjs"]
