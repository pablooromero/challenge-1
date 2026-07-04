/**
 * Cliente de la WooCommerce REST API (v3).
 *
 * Responsabilidades:
 *  - Autenticarse con Basic Auth sobre HTTPS (consumer key/secret).
 *  - Traer TODOS los productos visibles paginando de forma estable
 *    (orderby=id&order=asc, per_page=100, guiándose por el header X-WP-TotalPages).
 *  - Reintentar ante fallos transitorios (backoff exponencial).
 *  - Normalizar cada producto al shape mínimo que nos interesa.
 *
 * Decisiones de diseño (fundamentadas en datos reales de la API — ver PLAN.md):
 *  - Se filtra por `status=publish` porque "productos visibles en la web" excluye
 *    los borradores (draft), que la API devolvería por defecto.
 *  - NO se usa `date_created` para detectar novedades (puede venir null); la
 *    deduplicación se hace por `id` contra el Google Sheet (ver sheets.js).
 *  - Acceso defensivo a `images` (puede venir vacío).
 */
import axios from 'axios';
import { wooConfig } from './config.js';
import { logger } from './logger.js';
import { withRetry } from './utils/retry.js';

const PER_PAGE = 100; // máximo permitido por la WooCommerce REST API

/**
 * Normaliza un producto crudo de WooCommerce al shape que sincronizamos.
 * Función pura y sin side-effects (fácil de testear).
 */
export function normalizeProduct(raw) {
  return {
    id: raw.id,
    name: (raw.name ?? '').trim(),
    price: raw.price ?? '',
    imageUrl: raw.images?.[0]?.src ?? '',
    createdAt: raw.date_created ?? '',
  };
}

/** Crea el cliente axios apuntando a la REST API de WooCommerce. */
function createClient(cfg) {
  return axios.create({
    baseURL: `${cfg.baseUrl}/wp-json/wc/v3`,
    timeout: cfg.timeoutMs,
    auth: { username: cfg.consumerKey, password: cfg.consumerSecret },
    headers: { Accept: 'application/json' },
  });
}

/**
 * Trae todos los productos (paginados) con el estado configurado.
 * @param {object} [overrides] Config parcial para sobrescribir (útil en tests).
 * @returns {Promise<Array<{id,name,price,imageUrl,createdAt}>>}
 */
export async function fetchAllProducts(overrides = {}) {
  const cfg = { ...wooConfig(), ...overrides };
  const client = createClient(cfg);

  const products = [];
  let page = 1;

  for (;;) {
    const res = await withRetry(
      () =>
        client.get('/products', {
          params: {
            per_page: PER_PAGE,
            page,
            status: cfg.productStatus,
            orderby: 'id',
            order: 'asc',
          },
        }),
      {
        retries: cfg.maxRetries,
        onRetry: (err, attempt, delay) =>
          logger.warn(
            { attempt, delay, reason: err.code || err.response?.status },
            `WooCommerce falló, reintentando en ${delay}ms (intento ${attempt})`,
          ),
      },
    );

    const batch = res.data.map(normalizeProduct);
    products.push(...batch);

    const totalPages = Number(res.headers['x-wp-totalpages'] || 1);
    logger.debug({ page, totalPages, recibidos: batch.length }, 'Página de productos procesada');

    if (page >= totalPages) break;
    page += 1;
  }

  logger.info({ total: products.length, status: cfg.productStatus }, 'Productos traídos de WooCommerce');
  return products;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ejecución directa para probar el módulo:  `npm run wc:test`
 * ──────────────────────────────────────────────────────────────────────────── */
async function main() {
  try {
    const products = await fetchAllProducts();
    logger.info(`\n${products.length} producto(s) visible(s):\n`);
    for (const p of products) {
      logger.info(
        `  #${p.id}  ${p.name.padEnd(12)} $${String(p.price).padEnd(8)} img=${p.imageUrl || '(sin imagen)'}`,
      );
    }
  } catch (err) {
    logger.error(
      { code: err.code, status: err.response?.status },
      `Error trayendo productos: ${err.message}`,
    );
    process.exit(1);
  }
}

// Ejecutar main() sólo si el archivo se corre directamente (no al importarse).
import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
