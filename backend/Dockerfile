# EnRuta API (Node 22 + SQLite). Los datos viven en /app/data y /app/storage: móntalos como volúmenes.
FROM node:22-bookworm-slim
WORKDIR /app
# better-sqlite3 trae binarios precompilados; las herramientas de compilación son el respaldo si no existe uno para la plataforma.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
