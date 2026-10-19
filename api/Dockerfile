FROM node:24-alpine

WORKDIR /app

# DejaVu covers Cyrillic for the PDF analytics export (spec 008; alpine ships no fonts).
RUN apk add --no-cache font-dejavu

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 8011
CMD ["node", "src/index.js"]
