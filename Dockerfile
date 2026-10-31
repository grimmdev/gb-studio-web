# Build stage runs natively on builder host (avoids slow QEMU CPU emulation for Webpack)
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder

ARG TARGETARCH

WORKDIR /app

# Ensure essential build tools are present
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tar \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for yarn
RUN corepack enable

# Install build dependencies
COPY package.json yarn.lock* .yarnrc.yml* ./
RUN yarn install --immutable

# Copy project source
COPY . .

# Download GBDK toolchains for target architecture (or host arch if TARGETARCH not set)
RUN if [ "$TARGETARCH" = "arm64" ]; then \
      yarn fetch-toolchains -- --arch=linux-arm64; \
    elif [ "$TARGETARCH" = "amd64" ]; then \
      yarn fetch-toolchains -- --arch=linux-x64; \
    else \
      yarn fetch-toolchains; \
    fi

# Set Node memory limit for multi-arch build
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Build the web application and bundled Express server at native CPU speed
RUN yarn make:web

# Production runtime stage (using Debian slim to ensure native glibc compatibility with GBDK)
FROM node:24-bookworm-slim

WORKDIR /app

# Copy built web application bundle and server
COPY --from=builder /app/out/web ./out/web
COPY --from=builder /app/appData ./appData
COPY --from=builder /app/buildTools ./buildTools
COPY --from=builder /app/src/lib/events ./src/lib/events
COPY --from=builder /app/src/lang ./src/lang
COPY --from=builder /app/src/assets ./src/assets
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/README.md ./README.md

# Ensure execute permissions on GBDK compiler tools
RUN chmod -R +x ./buildTools

# Create volume for persistent project storage and database
RUN mkdir -p /data/projects /data/db
ENV PROJECTS_DIR=/data/projects
ENV DB_PATH=/data/db/gbstudio.sqlite
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

EXPOSE 3000

VOLUME ["/data/projects", "/data/db"]

CMD ["node", "out/web/server.js"]
