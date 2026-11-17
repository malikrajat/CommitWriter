import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const vscodeStub = fileURLToPath(new URL('./test/support/vscode-stub.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      vscode: vscodeStub,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    pool: 'threads',
  },
});
