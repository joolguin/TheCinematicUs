# Imagen base para dev del monorepo (backend + frontend).
# Todo Node y las dependencias viven acá dentro, no en tu Mac.
FROM node:24-alpine

WORKDIR /app

# Copiamos solo los manifests primero para cachear la instalación de deps.
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm install

# El código real se monta por volumen en docker-compose (hot reload).
COPY . .
