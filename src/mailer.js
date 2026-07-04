/**
 * Notificaciones por email (nodemailer sobre SMTP).
 *
 * - `sendSummary(products)`: resumen de los productos nuevos de la corrida.
 *   Envía SOLO si hay ≥1 producto nuevo (para no spammear cada 5 minutos).
 * - `sendErrorAlert(error)`: aviso opcional si una corrida falla (MAIL_ON_ERROR).
 * - `verify()`: chequea la conexión/credenciales SMTP antes de enviar.
 *
 * Las funciones que arman el cuerpo (`buildSummaryHtml`/`buildSummaryText`) son
 * puras y exportadas para poder testearlas sin enviar mails reales.
 */
import { pathToFileURL } from 'node:url';
import nodemailer from 'nodemailer';
import { mailConfig } from './config.js';
import { logger } from './logger.js';

/** Escapa caracteres HTML (los nombres de producto son datos externos). */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Precio "crudo" (string) → formato legible. Si no es numérico, lo deja igual. */
function formatPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) && price !== '' ? `$${n.toLocaleString('es-AR')}` : String(price ?? '');
}

/** Cuerpo en texto plano (fallback para clientes sin HTML). */
export function buildSummaryText(products) {
  const lines = products.map(
    (p) => `  ID ${p.id}  |  ${p.name}  |  ${formatPrice(p.price)}  |  ${p.imageUrl || '(sin imagen)'}`,
  );
  return [
    'Sincronización de productos - FADUA',
    '',
    `Se sincronizaron ${products.length} producto(s) nuevo(s) desde WooCommerce hacia Google Sheets.`,
    '',
    ...lines,
    '',
    `Mensaje automático generado el ${new Date().toLocaleString('es-AR')}.`,
    'Sistema de sincronización WooCommerce -> Google Sheets.',
  ].join('\n');
}

/** Cuerpo en HTML: diseño sobrio, sin emojis. */
export function buildSummaryHtml(products) {
  const th =
    'padding:10px 8px;border-bottom:2px solid #1f2937;color:#374151;font-weight:600;text-align:left';
  const td = 'padding:10px 8px;border-bottom:1px solid #ececec;vertical-align:middle';

  const rows = products
    .map(
      (p) => `
        <tr>
          <td style="${td};color:#6b7280">${escapeHtml(p.id)}</td>
          <td style="${td};font-weight:600">${escapeHtml(p.name)}</td>
          <td style="${td}">${escapeHtml(formatPrice(p.price))}</td>
          <td style="${td}">${
            p.imageUrl
              ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" width="52" height="52" style="object-fit:contain;border:1px solid #ececec;border-radius:4px;background:#fafafa"/>`
              : '<span style="color:#9ca3af">&mdash;</span>'
          }</td>
        </tr>`,
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#f4f4f5;padding:24px">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;border-collapse:collapse;border:1px solid #e0e0e0;background:#ffffff">
      <tr>
        <td style="background:#1f2937;padding:18px 24px">
          <span style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:.3px">Sincronización de productos &middot; FADUA</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px">
          <p style="margin:0 0 18px;font-size:14px;line-height:1.5">
            Se sincronizaron <strong>${products.length} producto(s) nuevo(s)</strong> desde WooCommerce hacia Google Sheets en la última ejecución.
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">
            <thead>
              <tr>
                <th style="${th}">ID</th>
                <th style="${th}">Producto</th>
                <th style="${th}">Precio</th>
                <th style="${th}">Imagen</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;border-top:1px solid #e0e0e0;background:#f9fafb">
          <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">
            Mensaje automático generado el ${new Date().toLocaleString('es-AR')}.<br/>
            Sistema de sincronización WooCommerce &rarr; Google Sheets.
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

export class Mailer {
  constructor(cfg = mailConfig()) {
    this.cfg = cfg;
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465, // 465 = SSL directo; 587 = STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  /** Valida credenciales/conexión SMTP (lanza si fallan). */
  async verify() {
    await this.transporter.verify();
    return true;
  }

  /** Envía el resumen. Devuelve null si no hay productos nuevos (no envía nada). */
  async sendSummary(products) {
    if (!products?.length) return null;
    const info = await this.transporter.sendMail({
      from: this.cfg.from,
      to: this.cfg.to,
      subject: `Sincronización FADUA - ${products.length} producto(s) nuevo(s)`,
      text: buildSummaryText(products),
      html: buildSummaryHtml(products),
    });
    logger.info({ to: this.cfg.to, nuevos: products.length }, 'Email de resumen enviado');
    return info;
  }

  /** Aviso de error de corrida (sólo si MAIL_ON_ERROR está activo). */
  async sendErrorAlert(error) {
    if (!this.cfg.alertOnError) return null;
    const info = await this.transporter.sendMail({
      from: this.cfg.from,
      to: this.cfg.to,
      subject: 'Sincronización FADUA - Error en la ejecución',
      text:
        `La ejecución de la sincronización falló con el siguiente error:\n\n` +
        `${error.stack || error.message}\n\n` +
        `El sistema es idempotente: la próxima corrida (en <= 5 min) se pondrá al día automáticamente.`,
    });
    logger.info({ to: this.cfg.to }, 'Email de alerta de error enviado');
    return info;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ejecución directa para probar el envío:  `npm run mail:test`
 * Usa datos de ejemplo (no toca WooCommerce ni el Sheet).
 * ──────────────────────────────────────────────────────────────────────────── */
async function main() {
  const sample = [
    {
      id: 12,
      name: 'CRONOS',
      price: '100',
      imageUrl: 'https://fadua.ar/pruebas/wp-content/uploads/2026/07/CRONOS.png',
      createdAt: '2026-07-02T14:34:13',
    },
    {
      id: 15,
      name: '600',
      price: '200',
      imageUrl: 'https://fadua.ar/pruebas/wp-content/uploads/2026/07/600.png',
      createdAt: '2026-07-02T14:39:45',
    },
  ];
  try {
    const mailer = new Mailer();
    logger.info('Verificando conexión SMTP...');
    await mailer.verify();
    logger.info('SMTP OK. Enviando email de prueba...');
    await mailer.sendSummary(sample);
    logger.info(`Email de prueba enviado a ${mailer.cfg.to}`);
  } catch (err) {
    logger.error(`Falló el envío: ${err.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
