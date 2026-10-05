// Capture de contrôle du thème clair (pas un test de régression : une image à
// regarder). Lancer : npx playwright test theme-capture
const { test } = require('@playwright/test');

test('capture du thème clair sur la page de connexion', async ({ page }) => {
  // Même réglage que le bouton « thème clair » des Paramètres (js/ui.js, kinetTheme).
  await page.addInitScript(() => localStorage.setItem('kinetTheme', 'light'));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByText('Connexion').first().waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/theme-clair.png' });
});
