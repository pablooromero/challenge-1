/**
 * Configuración centralizada y validada.
 *
 * Estrategia:
 *  - Se lee `.env` con dotenv y se valida con zod (fail-fast: si falta o es
 *    inválida una variable, el proceso aborta con un mensaje claro).
 *  - La config está dividida en secciones (woocommerce / sheets / mail / runtime).
 *    Cada sección se valida de forma perezosa (lazy) y sólo cuando se usa, de modo
 *    que un módulo pueda probarse aislado (ej: el cliente de WooCommerce) sin
 *    necesitar todavía las credenciales de Google o SMTP.
 *  - `loadAllConfig()` valida TODAS las secciones de una (lo usa el orquestador
 *    `sync.js` para fallar rápido al arrancar).
 */
import 'dotenv/config';
import { z } from 'zod';

/** Convierte "true"/"false" (string de env) a booleano, con default. */
const boolFromEnv = (defaultValue) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');

const schemas = {
  woocommerce: z.object({
    WC_BASE_URL: z.url(),
    WC_CONSUMER_KEY: z.string().min(1),
    WC_CONSUMER_SECRET: z.string().min(1),
    WC_PRODUCT_STATUS: z.string().min(1).default('publish'),
    WC_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    WC_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  }),
  sheets: z.object({
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),
    GOOGLE_SHEET_ID: z.string().min(1),
    GOOGLE_SHEET_TAB: z.string().min(1).default('Productos'),
  }),
  mail: z.object({
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_USER: z.string().min(1),
    SMTP_PASS: z.string().min(1),
    MAIL_FROM: z.email(),
    MAIL_TO: z.email(),
    MAIL_ON_ERROR: boolFromEnv(true),
  }),
  runtime: z.object({
    DRY_RUN: boolFromEnv(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
};

/** Mapea los nombres de env (UPPER_SNAKE) a un objeto camelCase más cómodo. */
const shapers = {
  woocommerce: (d) => ({
    baseUrl: d.WC_BASE_URL.replace(/\/+$/, ''),
    consumerKey: d.WC_CONSUMER_KEY,
    consumerSecret: d.WC_CONSUMER_SECRET,
    productStatus: d.WC_PRODUCT_STATUS,
    timeoutMs: d.WC_TIMEOUT_MS,
    maxRetries: d.WC_MAX_RETRIES,
  }),
  sheets: (d) => ({
    credentialsPath: d.GOOGLE_APPLICATION_CREDENTIALS,
    sheetId: d.GOOGLE_SHEET_ID,
    tab: d.GOOGLE_SHEET_TAB,
  }),
  mail: (d) => ({
    host: d.SMTP_HOST,
    port: d.SMTP_PORT,
    user: d.SMTP_USER,
    pass: d.SMTP_PASS,
    from: d.MAIL_FROM,
    to: d.MAIL_TO,
    alertOnError: d.MAIL_ON_ERROR,
  }),
  runtime: (d) => ({
    dryRun: d.DRY_RUN,
    logLevel: d.LOG_LEVEL,
  }),
};

const cache = {};

/** Valida y devuelve una sección de config; cachea el resultado. */
function getSection(name) {
  if (cache[name]) return cache[name];

  const result = schemas[name].safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    console.error(
      `\n❌ Configuración inválida en la sección "${name}". Revisá tu archivo .env:\n${details}\n`,
    );
    process.exit(1);
  }

  cache[name] = shapers[name](result.data);
  return cache[name];
}

export const wooConfig = () => getSection('woocommerce');
export const sheetsConfig = () => getSection('sheets');
export const mailConfig = () => getSection('mail');
export const runtimeConfig = () => getSection('runtime');

/** Valida TODAS las secciones (fail-fast al arrancar el orquestador). */
export function loadAllConfig() {
  return {
    woocommerce: wooConfig(),
    sheets: sheetsConfig(),
    mail: mailConfig(),
    runtime: runtimeConfig(),
  };
}
