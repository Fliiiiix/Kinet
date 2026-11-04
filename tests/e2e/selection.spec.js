// --- Pas de surlignage en glissant la souris (retour de Flix, 04/11) ---
// Une app ne sélectionne pas ses affiches et ses titres. Le texte à copier
// (résumé, critique, champs) reste sélectionnable.
const path = require('path');
const { test, expect } = require('@playwright/test');

test('glisser la souris sur la grille ne sélectionne rien, un résumé se sélectionne', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ baseURL: 'http://localhost:8765', viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  await page.addScriptTag({ path: path.join(__dirname, 'donnees-demo.js') });
  await page.evaluate(() => window.__kinetDemo());
  await page.waitForTimeout(2000);

  // Comme sur la capture : de la première carte à une carte plus bas.
  const cartes = page.locator('#filmList .film-row');
  await expect(cartes.nth(7)).toBeVisible();
  const debut = await cartes.nth(0).boundingBox();
  const fin = await cartes.nth(7).boundingBox();
  await page.mouse.move(debut.x + 10, debut.y + debut.height - 10);
  await page.mouse.down();
  await page.mouse.move(fin.x + fin.width - 10, fin.y + fin.height - 10, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#filmList img')).webkitUserDrag)).toBe('none');

  // La recherche reste un champ normal.
  await page.locator('#search').fill('dune');
  await expect(page.locator('#search')).toHaveValue('dune');
  await page.locator('#search').fill('');

  // Le résumé d'une fiche, lui, se sélectionne.
  await page.evaluate(() => { location.hash = `#/film/${__demo.Arrival.id}`; });
  await expect(page.locator('#filmDetailOverview')).not.toBeEmpty({ timeout: 10000 });
  await page.locator('#filmDetailOverview').click({ clickCount: 3 });
  expect((await page.evaluate(() => window.getSelection().toString())).length).toBeGreaterThan(10);
  await context.close();
});
