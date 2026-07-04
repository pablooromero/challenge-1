/**
 * Reintentos con backoff exponencial para operaciones que pueden fallar
 * transitoriamente (típicamente llamadas HTTP).
 *
 * Se reintenta sólo ante errores *transitorios*:
 *   - Errores de red / sin respuesta (timeout, ECONNRESET, DNS, etc.)
 *   - HTTP 429 (rate limit) y 5xx (errores del servidor)
 * NO se reintenta ante errores definitivos (ej: 401/403/404), porque reintentar
 * no cambiaría el resultado y sólo agregaría demora.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decide si vale la pena reintentar según el tipo de error de axios. */
export function isRetryableError(err) {
  // Sin respuesta del servidor => problema de red/timeout => transitorio.
  if (!err.response) return true;
  const status = err.response.status;
  return status === 429 || status >= 500;
}

/**
 * Ejecuta `fn` reintentando ante errores transitorios.
 * @param {() => Promise<any>} fn        Función a ejecutar.
 * @param {object} [opts]
 * @param {number} [opts.retries=3]      Reintentos (además del intento inicial).
 * @param {number} [opts.baseDelayMs=500] Demora base para el backoff.
 * @param {number} [opts.factor=2]       Factor de crecimiento del backoff.
 * @param {(err:Error, attempt:number, delay:number)=>void} [opts.onRetry]
 */
export async function withRetry(fn, opts = {}) {
  const { retries = 3, baseDelayMs = 500, factor = 2, onRetry } = opts;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryableError(err)) throw err;
      const delay = baseDelayMs * factor ** (attempt - 1);
      if (onRetry) onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
}
