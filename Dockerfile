# DartLine Friends Edition: pinned InstaDarts source + original extensions.
FROM node:22.22.0-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /source
ARG INSTADARTS_COMMIT=a455d7f8c5c7df2b37f7d08fefac970ec9e74ea0
RUN git clone https://github.com/Instadarts/instadarts.git /source/instadarts && cd /source/instadarts && git checkout "$INSTADARTS_COMMIT"
COPY . /source/dartline
RUN python3 /source/dartline/scripts/apply_dartline.py /source/instadarts && python3 /source/dartline/scripts/add_phone_camera.py /source/instadarts && python3 /source/dartline/scripts/reliable_scanning.py /source/instadarts && python3 /source/dartline/scripts/relaxed_tip_rescue.py /source/instadarts && python3 /source/dartline/scripts/restore_classic_model.py /source/instadarts && python3 /source/dartline/scripts/mobile_experience.py /source/instadarts && python3 /source/dartline/scripts/targeted_correction.py /source/instadarts && python3 /source/dartline/scripts/remote_opponent_view.py /source/instadarts && python3 /source/dartline/scripts/missed_darts_takeout.py /source/instadarts && python3 /source/dartline/scripts/takeout_only.py /source/instadarts && python3 /source/dartline/scripts/camera_health_fix.py /source/instadarts && python3 /source/dartline/scripts/duplicate_guard.py /source/instadarts && python3 /source/dartline/scripts/geometry_refinement.py /source/instadarts && python3 /source/dartline/scripts/recognition_v4.py /source/instadarts && python3 /source/dartline/scripts/check_fast_scoring.py /source/instadarts
WORKDIR /source/instadarts
# Render production builds avoid running 1300+ tests in a constrained build container.
# GitHub CI explicitly opts in to the full test suite before this can be deployed.
ARG RUN_TESTS=0
RUN npm ci
RUN npm run build
RUN if [ "$RUN_TESTS" = "1" ]; then npm test; fi
RUN npm prune --omit=dev

FROM node:22.22.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /source/instadarts /app
COPY --from=builder /source/dartline/scripts/start-server.mjs /app/dartline-start.mjs
EXPOSE 10000
CMD ["node", "/app/dartline-start.mjs"]
