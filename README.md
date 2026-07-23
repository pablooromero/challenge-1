# Sincronización WooCommerce → Google Sheets

Sistema automatizado que sincroniza los productos visibles de una tienda
WooCommerce (`https://fadua.ar/pruebas`) con una hoja de Google Sheets. Se ejecuta
cada 5 minutos mediante un cron, detecta los productos nuevos, los inserta en la
planilla y envía una notificación por email con el resumen de la corrida.

> Challenge 1 — FADUA.

---

## Características

- Sincronización incremental cada 5 minutos (script tipo cron).
- Detección de productos nuevos por **deduplicación de ID** contra la propia
  planilla: el proceso es **idempotente** (no duplica ni pierde datos, y una
  corrida fallida se recupera sola en la siguiente).
- Filtrado de productos **visibles** en la web (`status=publish`).
- Notificación por email (HTML + texto plano) con el resumen, **solo cuando hay
  productos nuevos**.
- Reintentos con backoff exponencial ante fallos transitorios de la API.
- Configuración validada al arranque (fail-fast) y secretos fuera del código.
- Suite de tests unitarios de la lógica de negocio.

---

## Arquitectura

```
        cron (*/5 * * * *) + flock
                  │
                  ▼
   ┌──────────  sync.js (orquestador)  ──────────┐
   │                                             │
   ▼               ▼               ▼             ▼
woocommerce.js  [dedup por id]  sheets.js    mailer.js
(fetch+retry)   (Sheet=estado)  (append)     (resumen)
   │               ▲               │             │
   ▼               └───────────────┘             ▼
WooCommerce API   leer ids existentes      notificación email
```

**Flujo de una corrida:**

1. `woocommerce.js` trae los productos visibles (paginados, con reintentos).
2. `sheets.js` lee los IDs ya presentes en la planilla (el estado).
3. `sync.js` calcula el diff: productos nuevos = los que no están en la planilla.
4. `sheets.js` inserta los nuevos (append en batch) — **antes** de notificar.
5. `mailer.js` envía el email de resumen.

El Sheet cumple doble rol: **destino** de los datos y **almacén de estado** para
deduplicar, evitando la necesidad de una base de datos externa.

### Módulos

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/config.js` | Carga y valida las variables de entorno (zod, fail-fast). |
| `src/logger.js` | Logging estructurado (pino) con redacción de secretos. |
| `src/woocommerce.js` | Cliente WooCommerce: paginación, reintentos, normalización. |
| `src/sheets.js` | Cliente Google Sheets: leer estado, appendear filas. |
| `src/mailer.js` | Armado y envío del email de resumen / alerta. |
| `src/sync.js` | Orquestador: une todo con la lógica de dedup e idempotencia. |
| `src/utils/retry.js` | Reintentos con backoff exponencial para errores transitorios. |

---

## Decisiones de diseño

Las decisiones de este proyecto no son suposiciones: surgen de consultar la **API real**
de `fadua.ar` con las credenciales del challenge. Los hallazgos y su impacto:

| Hallazgo (dato real de la API) | Decisión de diseño |
|---|---|
| `date_created` puede venir `null` (ej. un producto en `draft`) | **No** detectar novedades por fecha: deduplicar por `id`. |
| La API devuelve productos `draft` por defecto (no visibles en la web) | Filtrar `status=publish` (configurable por env). |
| La paginación se informa por headers (`X-WP-TotalPages`), máx. `per_page=100` | Paginar con `orderby=id&order=asc` (orden estable). |
| `price` llega como string (`"700"`) | Normalizar el precio; no asumir que es número. |
| `images` puede venir vacío | Acceso defensivo: `images?.[0]?.src ?? ""`. |

**El Sheet es la fuente de verdad del estado.** En cada corrida se leen los `id` ya
presentes y solo se insertan los que faltan. Esto hace el proceso **idempotente** (una
corrida fallida se recupera sola, sin duplicar) y evita depender de una base de datos
externa.

**Orden Sheet → Mail.** Se escribe en la planilla *antes* de notificar, para que el
email nunca reporte productos que no quedaron guardados.

**Serverless por sobre VPS.** Para un script que corre unos segundos cada 5 minutos, se
eligió Cloud Run Job + Cloud Scheduler: sin servidor que mantener, dentro del free tier,
y sin subir la clave privada gracias a ADC. La alternativa VPS queda en `DEPLOY.md`.

---

## Stack

- **Node.js 22** (ES Modules).
- **axios** — cliente HTTP para la WooCommerce REST API.
- **google-spreadsheet** + **google-auth-library** — integración con Google Sheets.
- **nodemailer** — envío de emails vía SMTP.
- **zod** — validación de configuración. **pino** — logging.
- **vitest** — tests. **ESLint** + **Prettier** — calidad de código.

---

## Estructura del proyecto

```
challenge-1/
├── src/
│   ├── config.js          # configuración validada
│   ├── logger.js          # logging
│   ├── woocommerce.js     # cliente WooCommerce
│   ├── sheets.js          # cliente Google Sheets
│   ├── mailer.js          # notificaciones por email
│   ├── sync.js            # orquestador (entry point del cron)
│   └── utils/retry.js     # reintentos con backoff
├── test/                  # tests unitarios (vitest)
├── credentials/           # JSON del service account (gitignored)
├── .env                   # secretos (gitignored)
├── .env.example           # plantilla de configuración
└── README.md
```

---

## Requisitos previos

1. **Node.js 22+** y npm.
2. Credenciales de la **WooCommerce REST API** (consumer key / secret).
3. Un **Service Account de Google** con la Google Sheets API habilitada, y una
   hoja de cálculo compartida (como Editor) con el email del service account.
4. Una cuenta de email con **SMTP** (para Gmail: una App Password).

---

## Configuración

Copiá `.env.example` a `.env` y completá los valores:

```bash
cp .env.example .env
```

| Variable | Descripción |
|----------|-------------|
| `WC_BASE_URL` | URL base de la tienda WooCommerce. |
| `WC_CONSUMER_KEY` / `WC_CONSUMER_SECRET` | Credenciales de la REST API (uso solo lectura). |
| `WC_PRODUCT_STATUS` | Estado a sincronizar (`publish` = visibles en la web). |
| `WC_TIMEOUT_MS` / `WC_MAX_RETRIES` | Timeout y reintentos de la API. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON del service account. En Cloud Run puede omitirse para usar ADC. |
| `GOOGLE_SHEET_ID` | ID de la planilla (de su URL). |
| `GOOGLE_SHEET_TAB` | Nombre de la pestaña de trabajo. |
| `SMTP_HOST` / `SMTP_PORT` | Servidor SMTP. |
| `SMTP_USER` / `SMTP_PASS` | Usuario y App Password del email emisor. |
| `MAIL_FROM` / `MAIL_TO` | Remitente y destinatario de las notificaciones. |
| `MAIL_ON_ERROR` | Enviar un email de alerta si una corrida falla. |
| `DRY_RUN` | Si es `true`, calcula el diff pero no escribe ni notifica. |
| `LOG_LEVEL` | Nivel de log (`info`, `debug`, etc.). |

---

## Instalación

```bash
npm ci        # instala las dependencias exactas del lockfile
```

---

## Uso

```bash
npm start              # ejecuta una corrida de sincronización (lo que dispara el cron)
DRY_RUN=true npm start # corrida en seco: calcula el diff, no escribe ni envía mail

# Scripts de verificación de cada integración por separado:
npm run wc:test        # trae y muestra los productos de WooCommerce
npm run sheets:test    # prueba la conexión al Google Sheet
npm run mail:test      # envía un email de prueba

# Calidad:
npm test               # tests unitarios (vitest)
npm run lint           # ESLint
npm run format         # Prettier
```

### Ejemplo de una corrida

```text
INFO: Iniciando sincronización
INFO: Productos traídos de WooCommerce (total: 8, status: publish)
INFO: Conectado al Google Sheet
INFO: Diff calculado (totalWoo: 8, yaEnSheet: 4, nuevos: 4)
INFO: Productos escritos en el Sheet (insertados: 4)
INFO: Email de resumen enviado (nuevos: 4)
INFO: Sincronización completada (duracionMs: 3821)
```

Una segunda corrida inmediata registra `nuevos: 0` y sale sin escribir ni notificar.

### Columnas de la planilla

| ID | Nombre | Precio | URL Imagen | Fecha alta (Woo) | Sincronizado |
|----|--------|--------|-----------|------------------|--------------|

La columna `ID` es la clave de deduplicación.

---

## Detección de productos nuevos (idempotencia)

En cada corrida se leen los IDs ya presentes en la planilla y se insertan
únicamente los productos cuyo ID no figura todavía. Como el estado vive en el
propio Sheet:

- No se generan duplicados aunque el cron corra muchas veces.
- Si una corrida falla, no se corrompe nada: la siguiente se pone al día.
- No hace falta una base de datos aparte.

Se deduplica por `id` (y no por fecha de creación) porque, según los datos reales
de la API, `date_created` puede venir nulo en algunos productos.

---

## Manejo de errores

El sistema está pensado para fallar de forma segura y recuperarse solo:

- **Reintentos selectivos:** las llamadas a WooCommerce se reintentan con backoff
  exponencial solo ante errores *transitorios* (red, timeout, `429`, `5xx`) y
  respetando el header `Retry-After`. Ante errores definitivos (`401/403/404`) no se
  reintenta, porque no cambiaría el resultado.
- **Fail-fast en configuración:** al arrancar se valida toda la config con `zod`; si
  falta o es inválida una variable, el proceso aborta con un mensaje claro.
- **Fail-safe en runtime:** ante cualquier error se aborta sin tocar el estado, se
  registra el error, se intenta una alerta por email (best-effort) y se sale con
  código distinto de cero, para que el scheduler lo detecte.
- **Idempotencia como red de seguridad:** como el estado vive en el Sheet, una corrida
  que falla no corrompe nada; la siguiente (en ≤ 5 min) se pone al día automáticamente.

---

## Despliegue

La opción recomendada para este proyecto es **Google Cloud Run Job + Cloud Scheduler**:
el contenedor corre una vez, sincroniza y termina. En ese entorno, el acceso a
Google Sheets puede resolverse por **ADC** con el service account del runtime,
sin subir el JSON privado al contenedor.

Referencia rápida:

```bash
cp env.cloudrun.example.yaml env.yaml
gcloud run jobs deploy fadua-sync \
  --source . \
  --region southamerica-east1 \
  --service-account fadua-sync-sa@affable-envoy-465305-m0.iam.gserviceaccount.com \
  --env-vars-file env.yaml \
  --max-retries 1 \
  --task-timeout 120s
```

Para el paso a paso completo, ver `DEPLOY-CLOUDRUN.md`. La alternativa VPS
tradicional con cron quedó documentada en `DEPLOY.md`.

---

## Testing

```bash
npm test
```

La suite (26 tests unitarios) cubre la lógica de negocio pura, sin tocar servicios
externos: deduplicación de productos, normalización de datos, política de reintentos
y armado del email (incluyendo escape anti-inyección HTML). Los casos borde salen de
datos reales de la API (`date_created` nulo, `images` vacío, `price` como string).
