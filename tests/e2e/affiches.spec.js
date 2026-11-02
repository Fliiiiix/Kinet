// --- Les vraies affiches sous le service worker ---
// Retour de Flix (02/11) : plus aucune image sur téléphone en v321. Le cache du
// navigateur gardait les affiches sans leur autorisation cors, et le service
// worker les redemandait en cors. Ce test passe par les vraies images de TMDB :
// une fausse réponse (context.route) coupe le cache du navigateur et masque ce
// bug, c'est pour ça que tests/e2e/hors-ligne.spec.js ne l'avait pas vu.
const { test, expect } = require('@playwright/test');

const AFFICHES = [
  'https://image.tmdb.org/t/p/w342/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
  'https://image.tmdb.org/t/p/w342/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg',
  'https://image.tmdb.org/t/p/w185/kjOuNoHNy8IF6v6BHzfEbli1G3W.jpg',
];

const afficher = (page) => page.evaluate((urls) => Promise.all(urls.map(u => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(img.naturalWidth > 0);
  img.onerror = () => resolve(false);
  img.src = u;
}))), AFFICHES);

test('une affiche déjà vue s\'affiche sous le service worker, et reste là sans réseau', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ baseURL: 'http://localhost:8765' });
  const page = await context.newPage();

  // Avant tout service worker : comme les affiches vues avant la v321.
  await page.goto('/manifest.json');
  const vues = await afficher(page);
  test.skip(vues.includes(false), 'TMDB injoignable');

  await page.goto('/index.html');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 25000 });
  await page.waitForTimeout(3000); // la première prise en main recharge la page
  expect(await afficher(page)).toEqual(AFFICHES.map(() => true));
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('kinet-images-v1')).keys()).length)).toBeGreaterThanOrEqual(AFFICHES.length);

  await context.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1500);
  expect(await afficher(page), 'gardées pour l\'avion').toEqual(AFFICHES.map(() => true));
  await context.close();
});
