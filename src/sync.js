/**
 * Orquestador de la sincronización (el "main" que dispara el cron).
 *
 * Flujo:
 *   1. WooCommerce  → traer productos visibles.
 *   2. Google Sheet → leer IDs ya presentes (el estado).
 *   3. Diff         → nuevos = productos cuyo ID no está en el Sheet.
 *   4. Sheet        → appendear los nuevos.
 *   5. Email        → notificar el resumen.
 *
 * Garantías (ver PLAN.md, sección 3.4):
 *   - IDEMPOTENCIA: el estado vive en el propio Sheet (dedup por ID), así una
 *     corrida fallida no duplica ni pierde datos; la siguiente se pone al día.
 *   - ORDEN Sheet → Mail: se escribe ANTES de notificar, para que el email nunca
 *     reporte productos que no quedaron guardados.
 *   - FAIL-SAFE: ante cualquier error se aborta sin corromper el estado, se
 *     registra el error, se intenta una alerta por mail y se sale con código ≠ 0.
 */
import { pathToFileURL } from 'node:url';
import { loadAllConfig } from './config.js';
import { logger } from './logger.js';
import { fetchAllProducts } from './woocommerce.js';
import { SheetsClient } from './sheets.js';
import { Mailer } from './mailer.js';

/**
 * Función pura: dado el catálogo y los IDs existentes, devuelve los productos nuevos.
 * @param {Array<{id:number}>} products
 * @param {Set<string>} existingIds
 */
export function selectNewProducts(products, existingIds) {
  return products.filter((p) => !existingIds.has(String(p.id)));
}

/** Ejecuta una corrida completa de sincronización. */
export async function runSync() {
  const startedAt = Date.now();
  const { runtime } = loadAllConfig(); // fail-fast: valida TODA la config al arrancar
  logger.info({ dryRun: runtime.dryRun }, 'Iniciando sincronización');

  // 1. WooCommerce
  const products = await fetchAllProducts();

  // 2. Estado actual en el Sheet
  const sheets = new SheetsClient();
  await sheets.connect();
  await sheets.ensureHeader();
  const existingIds = await sheets.getExistingIds();

  // 3. Diff
  const nuevos = selectNewProducts(products, existingIds);
  logger.info(
    { totalWoo: products.length, yaEnSheet: existingIds.size, nuevos: nuevos.length },
    'Diff calculado',
  );

  if (nuevos.length === 0) {
    logger.info({ duracionMs: Date.now() - startedAt }, 'Sin novedades: no se escribe ni se notifica');
    return { nuevos: 0 };
  }

  // Modo de prueba seguro: calcula el diff pero no persiste ni notifica.
  if (runtime.dryRun) {
    logger.warn(
      { ids: nuevos.map((p) => p.id) },
      `DRY_RUN activo: ${nuevos.length} producto(s) nuevo(s) detectado(s), pero NO se escribe ni se envía mail`,
    );
    return { nuevos: nuevos.length, dryRun: true };
  }

  // 4. Persistir en el Sheet (ANTES de notificar)
  await sheets.appendProducts(nuevos);
  logger.info({ insertados: nuevos.length }, 'Productos escritos en el Sheet');

  // 5. Notificar
  const mailer = new Mailer();
  await mailer.sendSummary(nuevos);

  logger.info(
    { nuevos: nuevos.length, ids: nuevos.map((p) => p.id), duracionMs: Date.now() - startedAt },
    'Sincronización completada',
  );
  return { nuevos: nuevos.length };
}

/** Punto de entrada: maneja el error global y el código de salida. */
async function main() {
  try {
    await runSync();
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'La sincronización falló');

    // Best-effort: avisar por mail sin tapar el error original.
    try {
      await new Mailer().sendErrorAlert(err);
    } catch (mailErr) {
      logger.error({ err: mailErr.message }, 'Además falló el envío de la alerta de error');
    }

    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
