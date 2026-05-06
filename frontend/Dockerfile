# Frontend (React via Vite) - Ubuntu base
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies for canvas or other native modules if needed
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    npm install -g npm@11.13.0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY frontend/package.json frontend/package-lock.json ./
# We skip npm ci here because we do it in docker-compose for dev flexibility,
# but for a "solid fix" we might want to do it here eventually.

# Copy source
COPY frontend .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
