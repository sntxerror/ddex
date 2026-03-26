# Extends the official Envoy image with `envsubst` so we can template
# envoy.yaml with environment variables from .env at container startup.
# envsubst is part of gettext-base (tiny, ~200KB).
FROM envoyproxy/envoy:v1.31-latest
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base && rm -rf /var/lib/apt/lists/*
