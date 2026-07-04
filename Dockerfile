# Imagen para ejecutar una corrida de sincronización.
# El script corre una vez y termina: pensado para ser disparado por un scheduler
# externo (cron del host con `docker run`, Kubernetes CronJob, etc.).
FROM node:22-alpine

WORKDIR /app

# Instalar sólo dependencias de producción (reproducible desde el lockfile).
COPY package*.json ./
RUN npm ci --omit=dev

# Código fuente.
COPY src ./src

# Ejecuta como usuario no-root (buena práctica de seguridad).
USER node

# Los secretos se inyectan en runtime, no se hornean en la imagen:
#   docker run --rm --env-file .env \
#     -v "$PWD/credentials:/app/credentials:ro" fadua-sync
CMD ["node", "src/sync.js"]
