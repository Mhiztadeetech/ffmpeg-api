FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && pip3 install yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production --no-audit --no-fund

# Copy app source
COPY . .

# Create tmp directory for downloads
RUN mkdir -p /tmp

EXPOSE 3000

CMD [ "node", "server.js" ]
