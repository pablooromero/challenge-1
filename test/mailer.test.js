import { describe, it, expect } from 'vitest';
import { buildSummaryHtml, buildSummaryText } from '../src/mailer.js';

const producto = (over = {}) => ({
  id: 12,
  name: 'CRONOS',
  price: '100',
  imageUrl: 'https://x/c.png',
  ...over,
});

describe('buildSummaryHtml', () => {
  it('incluye el conteo y los datos del producto', () => {
    const html = buildSummaryHtml([producto()]);
    expect(html).toContain('1 producto(s) nuevo(s)');
    expect(html).toContain('CRONOS');
    expect(html).toContain('https://x/c.png');
  });

  it('escapa HTML para evitar inyección desde el nombre del producto', () => {
    const html = buildSummaryHtml([producto({ name: '<script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('muestra un guion cuando el producto no tiene imagen', () => {
    const html = buildSummaryHtml([producto({ imageUrl: '' })]);
    expect(html).toContain('&mdash;');
    expect(html).not.toContain('<img');
  });
});

describe('buildSummaryText', () => {
  it('lista los productos y formatea el precio', () => {
    const text = buildSummaryText([producto({ price: '1000' })]);
    expect(text).toContain('ID 12');
    expect(text).toContain('CRONOS');
    expect(text).toMatch(/\$1[.,]000/); // formato es-AR: 1.000
  });

  it('indica "(sin imagen)" cuando falta la URL', () => {
    const text = buildSummaryText([producto({ imageUrl: '' })]);
    expect(text).toContain('(sin imagen)');
  });
});
