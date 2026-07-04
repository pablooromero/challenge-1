import { describe, it, expect } from 'vitest';
import { selectNewProducts } from '../src/sync.js';

/**
 * Núcleo del sistema: la deduplicación por ID contra el Sheet.
 * Es lo que garantiza la idempotencia (no duplicar, no perder).
 */
describe('selectNewProducts', () => {
  const catalogo = [{ id: 12 }, { id: 15 }, { id: 21 }];

  it('con el Sheet vacío, todos los productos son nuevos', () => {
    const nuevos = selectNewProducts(catalogo, new Set());
    expect(nuevos.map((p) => p.id)).toEqual([12, 15, 21]);
  });

  it('excluye los que ya están, aunque el Sheet los guarde como string', () => {
    // getExistingIds() devuelve strings; los productos traen id numérico.
    // Este test protege la coerción number<->string (bug clásico de dedup).
    const existentes = new Set(['12', '21']);
    const nuevos = selectNewProducts(catalogo, existentes);
    expect(nuevos.map((p) => p.id)).toEqual([15]);
  });

  it('si ya están todos, no reporta ninguno (segunda corrida idempotente)', () => {
    const existentes = new Set(['12', '15', '21']);
    expect(selectNewProducts(catalogo, existentes)).toEqual([]);
  });

  it('no muta el array de entrada', () => {
    const copia = [...catalogo];
    selectNewProducts(catalogo, new Set(['12']));
    expect(catalogo).toEqual(copia);
  });
});
