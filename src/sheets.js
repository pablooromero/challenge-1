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
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { sheetsConfig } from './config.js';
import { logger } from './logger.js';

/** Encabezados de la hoja (orden = orden de columnas). */
export const HEADERS = ['ID', 'Nombre', 'Precio', 'URL Imagen', 'Fecha alta (Woo)', 'Sincronizado'];

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/** Lee y parsea el JSON del service account, con un error claro si falta. */
function loadCredentials(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `No se encontró el archivo de credenciales en "${path}". ` +
          `Descargá el JSON del service account y colocalo ahí (ver FASE-0-SETUP.md).`,
        { cause: err },
      );
    }
    throw new Error(`No se pudo leer el JSON del service account: ${err.message}`, { cause: err });
  }
}

/** Traduce errores crudos de la API a mensajes accionables. */
function explainConnError(err, cfg, saEmail) {
  const status = err.response?.status;
  if (status === 403) {
    return `Permiso denegado sobre el Sheet. Compartilo (rol Editor) con el service account: ${saEmail}`;
  }
  if (status === 404) {
    return `No se encontró el Sheet con ID "${cfg.sheetId}". Verificá GOOGLE_SHEET_ID en el .env.`;
  }
  return `Error conectando al Google Sheet: ${err.message}`;
}

export class SheetsClient {
  constructor(cfg = sheetsConfig()) {
    this.cfg = cfg;
    this.credentials = loadCredentials(cfg.credentialsPath);
    this.doc = null;
    this.sheet = null;
  }

  get serviceAccountEmail() {
    return this.credentials.client_email;
  }

  /** Abre el documento y resuelve la pestaña de trabajo (creándola si hace falta). */
  async connect() {
    const auth = new JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key,
      scopes: SCOPES,
    });
    const doc = new GoogleSpreadsheet(this.cfg.sheetId, auth);

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
    logger.info(`Service account en uso: ${client.serviceAccountEmail}`);
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
