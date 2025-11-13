FROM node:18-alpine3.19

# Install system dependencies including yt-dlp and ffmpeg
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    && pip3 install yt-dlp

# Create app directory
WORKDIR /user/src/app

# Set production environment
ENV NODE_ENV=production

# Copy package files first for better layer caching
COPY --chown=node:node package*.json ./

# Install production dependencies
RUN npm install --production --no-audit --no-fund

# Copy app source
COPY --chown=node:node . .

# Create temp directories with correct ownership
RUN mkdir -p /tmp/uploads && chown -R node:node /tmp/uploads

# Use non-root user
USER node

# Expose port
EXPOSE 3000

# Start app
CMD ["node", "server.js"]
