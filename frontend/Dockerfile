# Frontend (React via Vite) - Ubuntu base
FROM ubuntu:22.04

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
COPY frontend/package.json /app/package.json
RUN npm install --no-audit --no-fund

# Copy source
COPY frontend /app

EXPOSE 5173

# Run dev server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
