FROM node:22-bookworm-slim

# Dependencies are installed IN THE IMAGE, not on the user's Mac.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ffmpeg chromium ca-certificates \
    libnss3 libx11-6 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdrm2 libpango-1.0-0 libpangocairo-1.0-0 \
    fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && mkdir -p /app/composition/assets /data/jobs /tmp/.cache \
 && cp /app/node_modules/gsap/dist/gsap.min.js /app/composition/assets/gsap.min.js
COPY server.mjs ./
COPY composition/ ./composition/
COPY public/ ./public/
# The compose file is copied after dependencies; ensure local GSAP is still present.
RUN cp /app/node_modules/gsap/dist/gsap.min.js /app/composition/assets/gsap.min.js \
 && chgrp -R 0 /app /data /tmp/.cache \
 && chmod -R g=u /app /data /tmp/.cache

# OpenShift restricted SCC assigns a random non-root UID in group 0.
USER 1001
EXPOSE 8080
CMD ["node", "server.mjs"]
