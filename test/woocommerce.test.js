import { describe, it, expect } from 'vitest';
import { normalizeProduct } from '../src/woocommerce.js';

/**
 * Normalización de productos. Los casos borde salen de datos REALES de la API
 * (ver PLAN.md): `date_created` puede ser null y `images` puede venir vacío.
 */
describe('normalizeProduct', () => {
  it('mapea los campos principales', () => {
    const raw = {
      id: 12,
      name: 'CRONOS',
      price: '100',
      images: [{ src: 'https://x/c.png' }, { src: 'https://x/otra.png' }],
      date_created: '2026-07-02T14:34:13',
    };
    expect(normalizeProduct(raw)).toEqual({
      id: 12,
      name: 'CRONOS',
      price: '100',
      imageUrl: 'https://x/c.png', // toma la primera imagen
      createdAt: '2026-07-02T14:34:13',
    });
  });

  it('tolera images vacío o ausente (imageUrl = "")', () => {
    expect(normalizeProduct({ id: 1, name: 'A', price: '5', images: [] }).imageUrl).toBe('');
    expect(normalizeProduct({ id: 2, name: 'B', price: '6' }).imageUrl).toBe('');
  });

  it('tolera date_created null (dato real del producto FASTBACK)', () => {
    expect(normalizeProduct({ id: 3, name: 'C', price: '7', date_created: null }).createdAt).toBe('');
  });

  it('recorta el nombre y tolera name ausente', () => {
    expect(normalizeProduct({ id: 4, name: '  X  ', price: '1' }).name).toBe('X');
    expect(normalizeProduct({ id: 5, price: '1' }).name).toBe('');
  });
});
