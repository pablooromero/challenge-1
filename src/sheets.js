/**
 * Cliente de Google Sheets.
 *
 * El Sheet cumple DOS roles a la vez:
 *   1. Destino de los datos (append-only).
 *   2. Almacén del estado para deduplicar: la columna `ID` nos dice qué
 *      productos ya fueron sincronizados. Así el proceso es idempotente y no
 *      necesita una base de datos aparte.
 *
 * Autenticación: Service Account (JWT) con el scope mínimo `spreadsheets`.
 * El acceso se concede compartiendo el Sheet con el email del service account.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT, GoogleAuth } from 'google-auth-library';
import { sheetsConfig } from './config.js';
import { logger } from './logger.js';

/** Encabezados de la hoja (orden = orden de columnas). */
export const HEADERS = ['ID', 'Nombre', 'Precio', 'URL Imagen', 'Fecha alta (Woo)', 'Sincronizado'];

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * Construye el mecanismo de autenticación con Google:
 *  - Desarrollo: si existe el JSON del service account, se usa como JWT.
 *  - Producción (Cloud Run / GCP): si NO hay key file, se usa Application Default
 *    Credentials (ADC), es decir, la identidad del runtime service account.
 *    Ventaja de seguridad: la clave privada nunca sale de Google (no se sube).
 * @returns {{ auth: JWT|GoogleAuth, email: string|null }}
 */
function buildAuth(path) {
  if (path && existsSync(path)) {
    let creds;
    try {
      creds = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`No se pudo leer el JSON del service account: ${err.message}`, { cause: err });
    }
    const auth = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
    return { auth, email: creds.client_email };
  }
  // Sin key file: ADC (la identidad del entorno de ejecución, p. ej. Cloud Run).
  return { auth: new GoogleAuth({ scopes: SCOPES }), email: null };
}

/** Traduce errores crudos de la API a mensajes accionables. */
function explainConnError(err, cfg, saEmail) {
  const status = err.response?.status;
  if (status === 403) {
    const quien = saEmail ?? 'el runtime service account (ADC)';
    return `Permiso denegado sobre el Sheet. Compartilo (rol Editor) con el service account: ${quien}`;
  }
  if (status === 404) {
    return `No se encontró el Sheet con ID "${cfg.sheetId}". Verificá GOOGLE_SHEET_ID en el .env.`;
  }
  return `Error conectando al Google Sheet: ${err.message}`;
}

export class SheetsClient {
  constructor(cfg = sheetsConfig()) {
    this.cfg = cfg;
    const { auth, email } = buildAuth(cfg.credentialsPath);
    this.auth = auth;
    this.serviceAccountEmail = email; // null cuando se usa ADC (runtime service account)
    this.doc = null;
    this.sheet = null;
  }

  /** Abre el documento y resuelve la pestaña de trabajo (creándola si hace falta). */
  async connect() {
    const doc = new GoogleSpreadsheet(this.cfg.sheetId, this.auth);

    try {
      await doc.loadInfo();
    } catch (err) {
      throw new Error(explainConnError(err, this.cfg, this.serviceAccountEmail), { cause: err });
    }

    let sheet = doc.sheetsByTitle[this.cfg.tab];
    if (!sheet) {
      if (doc.sheetCount === 1) {
        // Hoja nueva: reutilizamos la pestaña default renombrándola.
        sheet = doc.sheetsByIndex[0];
        await sheet.updateProperties({ title: this.cfg.tab });
        logger.info({ tab: this.cfg.tab }, 'Pestaña default renombrada');
      } else {
        sheet = await doc.addSheet({ title: this.cfg.tab, headerValues: HEADERS });
        logger.info({ tab: this.cfg.tab }, 'Pestaña creada');
      }
    }

    this.doc = doc;
    this.sheet = sheet;
    logger.info({ documento: doc.title, pestaña: sheet.title }, 'Conectado al Google Sheet');
    return this;
  }

  /** Garantiza que la fila de encabezados exista y sea la correcta (idempotente). */
  async ensureHeader() {
    try {
      await this.sheet.loadHeaderRow();
      const current = this.sheet.headerValues ?? [];
      const matches = HEADERS.every((h, i) => current[i] === h);
      if (!matches) await this.sheet.setHeaderRow(HEADERS);
    } catch {
      // La hoja no tiene fila de encabezados todavía (está vacía).
      await this.sheet.setHeaderRow(HEADERS);
    }
  }

  /** Devuelve un Set con los IDs ya presentes en el Sheet (estado para deduplicar). */
  async getExistingIds() {
    const rows = await this.sheet.getRows();
    const ids = new Set();
    for (const row of rows) {
      const id = row.get('ID');
      if (id !== undefined && String(id).trim() !== '') {
        ids.add(String(id).trim());
      }
    }
    return ids;
  }

  /**
   * Appendea productos nuevos en una sola llamada (batch).
   * @param {Array<{id,name,price,imageUrl,createdAt}>} products
   * @returns {Promise<Array>} las filas escritas.
   */
  async appendProducts(products) {
    if (!products.length) return [];
    const syncedAt = new Date().toISOString();
    const rows = products.map((p) => ({
      ID: p.id,
      Nombre: p.name,
      Precio: p.price,
      'URL Imagen': p.imageUrl,
      'Fecha alta (Woo)': p.createdAt,
      Sincronizado: syncedAt,
    }));
    await this.sheet.addRows(rows);
    return rows;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ejecución directa para probar la conexión:  `npm run sheets:test`
 * Verifica de punta a punta la Fase 0: credenciales válidas + Sheet compartido.
 * ──────────────────────────────────────────────────────────────────────────── */
async function main() {
  try {
    const client = new SheetsClient();
    logger.info(`Autenticación: ${client.serviceAccountEmail ?? 'ADC (identidad del entorno)'}`);
    await client.connect();
    await client.ensureHeader();
    const ids = await client.getExistingIds();
    logger.info(`Conexión OK. Encabezados asegurados. Filas con ID existentes: ${ids.size}`);
    if (ids.size) logger.info(`IDs: ${[...ids].join(', ')}`);
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
