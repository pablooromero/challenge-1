/**
 * Reintentos con backoff exponencial para operaciones que pueden fallar
 * transitoriamente (típicamente llamadas HTTP).
 *
 * Se reintenta sólo ante errores *transitorios*:
 *   - Errores de red / sin respuesta (timeout, ECONNRESET, DNS, etc.)
 *   - HTTP 429 (rate limit) y 5xx (errores del servidor)
 * NO se reintenta ante errores definitivos (ej: 401/403/404), porque reintentar
 * no cambiaría el resultado y sólo agregaría demora.
 *
 * Si el servidor indica un header `Retry-After`, se respeta ese tiempo en lugar
 * del backoff calculado (buena práctica ante rate limiting).
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tope para no quedarnos esperando un Retry-After absurdamente largo. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Decide si vale la pena reintentar según el tipo de error de axios. */
export function isRetryableError(err) {
  // Sin respuesta del servidor => problema de red/timeout => transitorio.
  if (!err.response) return true;
  const status = err.response.status;
  return status === 429 || status >= 500;
}

/**
 * Lee el header `Retry-After` (en segundos o como HTTP-date) y lo pasa a ms.
 * Devuelve null si no está presente o no es interpretable.
 */
export function getRetryAfterMs(err, now = Date.now()) {
  const raw = err.response?.headers?.['retry-after'];
  if (raw == null) return null;

  let ms;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    ms = seconds * 1000;
  } else {
    const dateMs = Date.parse(raw);
    if (Number.isNaN(dateMs)) return null;
    ms = dateMs - now;
  }

  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
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

      // Preferimos el Retry-After del servidor; si no está, backoff exponencial.
      const retryAfter = getRetryAfterMs(err);
      const delay = retryAfter != null ? retryAfter : baseDelayMs * factor ** (attempt - 1);

      if (onRetry) onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
}
