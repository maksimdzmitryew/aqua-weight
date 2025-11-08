# Backend (FastAPI) - Ubuntu base
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps (add curl for healthcheck)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ca-certificates \
        curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG INSTALL_DEV=0

# Install Python deps first (better layer caching)
COPY backend/requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# Optional dev tools
COPY backend/requirements-dev.txt /app/requirements-dev.txt
RUN if [ "$INSTALL_DEV" = "1" ]; then pip3 install --no-cache-dir -r /app/requirements-dev.txt; fi

# Copy app code
COPY backend/app /app/app

EXPOSE 8000

# Run
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
