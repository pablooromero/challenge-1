import { describe, it, expect } from 'vitest';
import { isRetryableError, withRetry } from '../src/utils/retry.js';

describe('isRetryableError', () => {
  it('reintenta ante errores de red (sin response)', () => {
    expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
  });

  it('reintenta ante 429 (rate limit) y 5xx', () => {
    expect(isRetryableError({ response: { status: 429 } })).toBe(true);
    expect(isRetryableError({ response: { status: 500 } })).toBe(true);
    expect(isRetryableError({ response: { status: 503 } })).toBe(true);
  });

  it('NO reintenta ante 4xx definitivos', () => {
    expect(isRetryableError({ response: { status: 401 } })).toBe(false);
    expect(isRetryableError({ response: { status: 404 } })).toBe(false);
  });
});

describe('withRetry', () => {
  it('devuelve el resultado si un error transitorio se resuelve al reintentar', async () => {
    let intentos = 0;
    const fn = async () => {
      intentos += 1;
      if (intentos < 3) throw new Error('transitorio');
      return 'ok';
    };
    const res = await withRetry(fn, { retries: 3, baseDelayMs: 0 });
    expect(res).toBe('ok');
    expect(intentos).toBe(3);
  });

  it('lanza tras agotar los reintentos (1 inicial + N)', async () => {
    let intentos = 0;
    const fn = async () => {
      intentos += 1;
      throw new Error('siempre falla');
    };
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 0 })).rejects.toThrow('siempre falla');
    expect(intentos).toBe(3);
  });

  it('no reintenta errores no transitorios (4xx): un solo intento', async () => {
    let intentos = 0;
    const fn = async () => {
      intentos += 1;
      const err = new Error('no autorizado');
      err.response = { status: 401 };
      throw err;
    };
    await expect(withRetry(fn, { retries: 5, baseDelayMs: 0 })).rejects.toThrow('no autorizado');
    expect(intentos).toBe(1);
  });
});
