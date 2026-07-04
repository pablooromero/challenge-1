import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      // Módulos de infraestructura (I/O puro) que no aportan a la cobertura útil.
      exclude: ['src/logger.js'],
    },
  },
});
