FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
ENV STORAGE_ROOT=/tmp/obra360
EXPOSE 8080
CMD ["node", "dist/server.js"]
