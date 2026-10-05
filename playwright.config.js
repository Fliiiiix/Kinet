// Tests de bout en bout (npm run test:e2e). Ils ne se connectent pas à un
// compte : ils vérifient ce que voit un visiteur, et qu'aucune erreur
// JavaScript n'apparaît au chargement.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.js/,
  use: { baseURL: 'http://localhost:8765', headless: true },
  webServer: {
    command: 'node tests/e2e/static-server.js',
    url: 'http://localhost:8765',
    reuseExistingServer: true,
  },
});
