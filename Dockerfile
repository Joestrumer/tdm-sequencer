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

# Créer le dossier data
RUN mkdir -p /app/data

# Initialiser la DB
RUN node src/db/init.js

# Port exposé
EXPOSE 3001

# Démarrer
CMD ["node", "src/server.js"]
