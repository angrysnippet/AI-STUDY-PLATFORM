# Server image — works on Railway, Render, Fly, or any container host.
FROM node:20-alpine

WORKDIR /app

# Install deps (incl. dev deps, needed to compile TypeScript).
COPY package*.json ./
RUN npm ci

# Build TypeScript -> dist/.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Host platforms inject PORT; the app reads it (defaults to 4000 locally).
EXPOSE 4000

CMD ["node", "dist/index.js"]
