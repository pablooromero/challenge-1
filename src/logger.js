/**
 * Logger estructurado (pino).
 *
 * - En desarrollo usa `pino-pretty` para una salida legible con colores.
 * - En producción emite JSON (ideal para archivos de log / agregadores).
 * - Nunca depende de `config.js` (para evitar dependencias circulares): lee
 *   `LOG_LEVEL` / `NODE_ENV` directamente del entorno con valores por defecto.
 * - `redact` censura por las dudas cualquier campo sensible que llegara a loguearse.
 */
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level,
  redact: {
    paths: ['consumerSecret', 'WC_CONSUMER_SECRET', 'smtpPass', 'SMTP_PASS', 'password', 'auth'],
    censor: '[REDACTED]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});
