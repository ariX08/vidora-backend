FROM node:20-bookworm-slim

# Install yt-dlp + ffmpeg + python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && pip3 install --break-system-packages -U yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/server.js"]
