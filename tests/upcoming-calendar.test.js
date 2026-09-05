// --- Tests du calendrier visuel de Prochainement (js/upcoming.js) ---
// Retour utilisateur : remplacer la simple liste triée par date par un
// vrai calendrier. renderUpcomingCalendar() est pure DOM (pas d'appel
// réseau) mais sa logique de regroupement par jour et de grille (semaines
// démarrant le lundi, cases hors mois en tête/queue) mérite un test —
// c'est exactement le genre de calcul de dates hors-ligne facile à casser
// silencieusement (mauvais jour de la semaine, décalage d'un jour...).
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  // Élément persistant (contrairement au stub par défaut de getElementById,
  // qui recrée un stub NEUF à chaque appel pour un id non fourni ici) — sans
  // ça, lire calendarEl.innerHTML après l'appel ne verrait jamais ce que la
  // fonction a réellement écrit dedans.
  const calendarEl = stubElement();
  const ctx = createContext({
    document: stubDocument({ upcomingCalendar: calendarEl }),
    goToUpcoming(){}, goHome(){}, observeReveal(){}, goToSeriesDetail(){},
    escapeHtml(s){ return s; },
    formatDateFr(iso){ return iso; },
    FILM_PLACEHOLDER_SVG: '<svg data-film-placeholder></svg>',
    TV_PLACEHOLDER_SVG: '<svg data-tv-placeholder></svg>',
  });
  loadFiles(ctx, ['js/upcoming.js']);
  return { ctx, calendarEl };
}

test('renderUpcomingCalendar() : place un item watchlist sur la bonne case du mois affiché', () => {
  const { ctx, calendarEl } = buildContext();
  setState(ctx, {
    upcomingCalMonth: new Date(2026, 2, 1), // mars 2026 (mois 2 = mars, 0-indexé)
    upcomingSoon: [
      { type: 'movie', key: 'movie-1', title: 'Film Test', posterUrl: null, date: '2026-03-15', dateObj: new Date(2026, 2, 15), sub: 'Film' },
    ],
  });
  ctx.renderUpcomingCalendar();

  // Grille complète = multiple de 7 cases.
  const dayCellCount = (calendarEl.innerHTML.match(/upcoming-cal-day/g) || []).length;
  assert.ok(dayCellCount > 0 && dayCellCount % 7 === 0, `le nombre de cases doit être un multiple de 7 (obtenu ${dayCellCount})`);

  // L'entête du mois affiché doit apparaître (mars 2026).
  assert.ok(/mars/i.test(calendarEl.innerHTML), 'le libellé du mois (mars 2026) doit être affiché');

  // L'item du 15 mars doit produire une mini-affiche (placeholder ici, pas
  // de posterUrl) quelque part dans le HTML généré.
  assert.ok(calendarEl.innerHTML.includes('upcoming-cal-poster-placeholder'), 'l\'item sans affiche doit utiliser le placeholder');
});

test('renderUpcomingCalendar() : mars 2026 (1er = dimanche) donne 6 cases hors-mois en tête, 5 en queue, 42 au total', () => {
  const { ctx, calendarEl } = buildContext();
  // Semaines Lundi-Dimanche : le 1er mars 2026 est un dimanche (vérifié via
  // `new Date(2026,2,1).getDay()` = 0), donc 6 jours de fin février
  // complètent la première semaine avant lui.
  setState(ctx, {
    upcomingCalMonth: new Date(2026, 2, 1),
    upcomingSoon: [],
  });
  ctx.renderUpcomingCalendar();
  const totalCells = (calendarEl.innerHTML.match(/upcoming-cal-day(?:"| )/g) || []).length;
  const outsideCells = (calendarEl.innerHTML.match(/upcoming-cal-day is-outside/g) || []).length;
  assert.strictEqual(totalCells, 42, '31 jours + 6 en tête + 5 en queue = 42 cases (6 semaines complètes)');
  assert.strictEqual(outsideCells, 11, '6 cases hors-mois en tête + 5 en queue');
});

module.exports = run('upcoming-calendar.test.js');
