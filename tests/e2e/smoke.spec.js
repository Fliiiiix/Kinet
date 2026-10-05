// Fumée : la page d'accueil (connexion) s'affiche, sans erreur JavaScript.
const { test, expect } = require('@playwright/test');

test('la page de connexion s\'affiche sans erreur JavaScript', async ({ page }) => {
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if(m.type() === 'error') erreurs.push(m.text()); });

  await page.goto('/');
  await expect(page.getByText('Connexion').first()).toBeVisible();
  // Laisse le temps aux scripts de démarrer avant de compter les erreurs.
  await page.waitForTimeout(800);
  expect(erreurs.filter(e => !/supabase|tmdb|net::ERR|Failed to load resource/i.test(e))).toEqual([]);
});
