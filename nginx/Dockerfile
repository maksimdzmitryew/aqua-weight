# Nginx reverse proxy - Ubuntu base
FROM ubuntu@sha256:34577a83cd7a8f1e55f6eb173fd9bb70c16127a83d6bf06f56f6b1fff9e406b9

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Remove default site
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default || true

# Copy nginx.conf
COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
