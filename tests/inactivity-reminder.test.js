// --- Tests du rappel "tu n'as rien noté depuis longtemps" (js/activityState.js) ---
// Retour utilisateur : basé sur films.added (horloge client, jamais
// viewings.watchedAt — backdatable via import/revisionnage, fausserait la
// mesure). Fermeture mémorisée PAR APPAREIL (localStorage) tant que le
// catalogue n'a pas changé depuis (mostRecentAdded), pour ne jamais
// re-harceler pour la MÊME période déjà fermée.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement, fakeLocalStorage } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const DAY_MS = 24 * 60 * 60 * 1000;

function buildContext(overrides = {}){
  const banner = stubElement();
  const ctx = createContext(Object.assign({
    document: stubDocument({ inactivityReminderBanner: banner }),
    openModal(){},
    localStorage: fakeLocalStorage(),
  }, overrides));
  loadFiles(ctx, ['js/activityState.js']);
  return { ctx, banner };
}

test('daysSinceLastRating() : null si le catalogue est vide (jamais commencé, pas "depuis longtemps")', () => {
  const { ctx } = buildContext();
  setState(ctx, { films: [] });
  assert.strictEqual(ctx.daysSinceLastRating(), null);
});

test('daysSinceLastRating() : nombre de jours depuis le film le plus RÉCEMMENT ajouté', () => {
  const { ctx } = buildContext();
  const now = Date.now();
  setState(ctx, {
    films: [
      { id: 1, added: now - 30 * DAY_MS },
      { id: 2, added: now - 5 * DAY_MS }, // le plus récent
    ],
  });
  assert.strictEqual(ctx.daysSinceLastRating(), 5);
});

test('maybeShowInactivityReminder() : rien en dessous du seuil (21 jours)', () => {
  const { ctx, banner } = buildContext();
  setState(ctx, { films: [{ id: 1, added: Date.now() - 10 * DAY_MS }] });
  ctx.maybeShowInactivityReminder();
  assert.strictEqual(banner.style.display, 'none');
});

test('maybeShowInactivityReminder() : affiché au-delà du seuil, avec le bon décompte de jours', () => {
  const { ctx, banner } = buildContext();
  setState(ctx, { films: [{ id: 1, added: Date.now() - 25 * DAY_MS }] });
  ctx.maybeShowInactivityReminder();
  assert.strictEqual(banner.style.display, '');
  assert.ok(banner.innerHTML.includes('25 jours'));
});

test('maybeShowInactivityReminder() : reste masqué si déjà fermé pour CE catalogue (même mostRecentAdded)', () => {
  const { ctx, banner } = buildContext();
  const added = Date.now() - 30 * DAY_MS;
  setState(ctx, { films: [{ id: 1, added } ] });
  ctx.maybeShowInactivityReminder();
  assert.strictEqual(banner.style.display, '', 'affiché la première fois');
  banner.innerHTML.includes('Plus tard'); // sanity
  // Simule le clic "Plus tard" (le vrai bouton vit dans le HTML généré,
  // pas la peine de le retrouver ici : même effet obtenu en appelant le
  // mécanisme qu'il déclenche directement — mémoriser mostRecentAdded).
  ctx.localStorage.setItem('kinetInactivityDismissedFor', String(added));
  ctx.maybeShowInactivityReminder();
  assert.strictEqual(banner.style.display, 'none', 'ne redoit plus s\'afficher pour la même période');
});

test('maybeShowInactivityReminder() : réapparaît si le catalogue change ENTRE-TEMPS (nouveau film ajouté puis inactivité reprend)', () => {
  const { ctx, banner } = buildContext();
  const firstAdded = Date.now() - 40 * DAY_MS;
  ctx.localStorage.setItem('kinetInactivityDismissedFor', String(firstAdded));
  // Un nouveau film a été ajouté depuis (il y a 22 jours -> toujours
  // au-delà du seuil) : mostRecentAdded a changé, la fermeture précédente
  // ne doit plus s'appliquer.
  setState(ctx, { films: [{ id: 1, added: firstAdded }, { id: 2, added: Date.now() - 22 * DAY_MS }] });
  ctx.maybeShowInactivityReminder();
  assert.strictEqual(banner.style.display, '', 'doit réapparaître : la période fermée n\'est plus la période actuelle');
});

module.exports = run('inactivity-reminder.test.js');
