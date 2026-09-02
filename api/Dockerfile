FROM node:24-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 8011
CMD ["node", "src/index.js"]
