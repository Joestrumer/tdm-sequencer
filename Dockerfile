FROM node:20-slim

# Installer les outils nécessaires pour compiler better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier package.json en premier pour profiter du cache Docker
COPY package.json ./

# Installer les dépendances (compile better-sqlite3)
RUN npm install --build-from-source

# Copier le reste du projet
COPY . .

# Créer le dossier data et utilisateur non-root
RUN mkdir -p /app/data && \
    groupadd -r appuser && useradd -r -g appuser -d /app appuser && \
    chown -R appuser:appuser /app

# Initialiser la DB
RUN node src/db/init.js

# Passer en utilisateur non-root
USER appuser

# Port exposé
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', r => { if (r.statusCode !== 200) process.exit(1); })"

# Démarrer
CMD ["node", "src/server.js"]
