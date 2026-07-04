import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = process.env;

async function loadConfigModule(env = {}) {
  vi.resetModules();
  const nextEnv = { ...originalEnv, DOTENV_CONFIG_PATH: '/dev/null' };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete nextEnv[key];
      continue;
    }
    nextEnv[key] = value;
  }
  process.env = nextEnv;
  return import('../src/config.js');
}

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

describe('sheetsConfig', () => {
  it('permite omitir GOOGLE_APPLICATION_CREDENTIALS para usar ADC', async () => {
    const { sheetsConfig } = await loadConfigModule({
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_SHEET_TAB: 'Productos',
    });

    expect(sheetsConfig()).toMatchObject({
      credentialsPath: null,
      sheetId: 'sheet-id',
      tab: 'Productos',
    });
  });

  it('trata un valor vacío como ausencia de archivo de credenciales', async () => {
    const { sheetsConfig } = await loadConfigModule({
      GOOGLE_APPLICATION_CREDENTIALS: '   ',
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_SHEET_TAB: 'Productos',
    });

    expect(sheetsConfig().credentialsPath).toBeNull();
  });

  it('mantiene la ruta local cuando se define un JSON de service account', async () => {
    const { sheetsConfig } = await loadConfigModule({
      GOOGLE_APPLICATION_CREDENTIALS: './credentials/service-account.json',
      GOOGLE_SHEET_ID: 'sheet-id',
      GOOGLE_SHEET_TAB: 'Productos',
    });

    expect(sheetsConfig().credentialsPath).toBe('./credentials/service-account.json');
  });
});
