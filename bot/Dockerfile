FROM node:24-alpine

WORKDIR /app

# No lockfile is committed for the bot, so use `npm install` (not `npm ci`).
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

CMD ["node", "src/index.js"]
