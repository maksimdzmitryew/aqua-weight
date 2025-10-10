# Nginx reverse proxy - Ubuntu base
FROM ubuntu:22.04

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
