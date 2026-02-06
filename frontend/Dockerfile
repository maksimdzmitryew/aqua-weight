# Frontend (React via Vite) - Ubuntu base
FROM ubuntu@sha256:34577a83cd7a8f1e55f6eb173fd9bb70c16127a83d6bf06f56f6b1fff9e406b9

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 20 (LTS) from NodeSource
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm i -g npm@11.6.2 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY frontend/package.json frontend/package-lock.json /app/
RUN npm ci --no-audit --no-fund

# Copy source
COPY frontend /app

EXPOSE 5173

# Run dev server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
