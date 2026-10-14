FROM node:24-alpine

# DejaVu covers Cyrillic for the rendered HR report (alpine ships no fonts).
RUN apk add --no-cache font-dejavu

WORKDIR /app

# No lockfile is committed for the bot, so use `npm install` (not `npm ci`).
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

CMD ["node", "src/index.js"]
