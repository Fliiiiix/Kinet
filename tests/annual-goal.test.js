// --- Tests de l'objectif annuel chiffré + barre de progression (js/recap.js) ---
// Retour utilisateur (étude comparative "Reading Challenge" de Goodreads) :
// Kinet n'avait qu'un bilan RÉTROSPECTIF (js/recap.js, computeRecap) jamais
// un objectif fixé À L'AVANCE et suivi en continu. renderAnnualGoalWidget()
// doit rester silencieuse (jamais d'exception) tant que la migration 056
// (profiles.annual_goal_year/annual_goal_count) n'est pas appliquée —
// select('*') omet alors ces deux colonnes, jamais une erreur.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(overrides = {}){
  const widgetEl = stubElement();
  const doc = stubDocument({ annualGoalWidget: widgetEl });
  const toasts = [];
  const ctx = createContext(Object.assign({
    document: doc,
    getDisplayNote(f){ return f.manualNote != null ? f.manualNote : null; },
    GENRE_MAP: {},
    openOverlay(){}, closeOverlay(){},
    showToast(msg){ toasts.push(msg); },
    currentUser: { id: 'me' },
    currentProfile: { display_name: 'Test' },
  }, overrides));
  loadFiles(ctx, ['js/recap.js']);
  setState(ctx, { films: [], viewings: [] });
  return { ctx, widgetEl, toasts };
}

test('renderAnnualGoalWidget() : pas de colonne migration 056 appliquée (currentProfile sans les champs) -> formulaire "définir un objectif", pas d\'exception', () => {
  const { ctx, widgetEl } = buildContext();
  ctx.renderAnnualGoalWidget();
  assert.ok(widgetEl.innerHTML.includes('annualGoalForm'), widgetEl.innerHTML);
  assert.ok(widgetEl.innerHTML.includes(String(new Date().getFullYear())));
});

test('renderAnnualGoalWidget() : currentProfile absent -> widget vidé, pas d\'exception (ex. avant le premier chargement du profil)', () => {
  const { ctx, widgetEl } = buildContext({ currentProfile: null });
  widgetEl.innerHTML = 'contenu précédent';
  ctx.renderAnnualGoalWidget();
  assert.strictEqual(widgetEl.innerHTML, '');
});

test('renderAnnualGoalWidget() : objectif fixé cette année -> barre de progression avec le bon compte et le bon pourcentage', () => {
  const year = new Date().getFullYear();
  const { ctx, widgetEl } = buildContext({
    currentProfile: { display_name: 'Test', annual_goal_year: year, annual_goal_count: 10 },
  });
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [] },
      { id: 2, title: 'B', manualNote: 3, fav: false, genreIds: [] },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(year, 2, 1).getTime() },
      { filmId: 2, watchedAt: new Date(year, 3, 1).getTime() },
    ],
  });
  ctx.renderAnnualGoalWidget();
  assert.ok(widgetEl.innerHTML.includes('2 / 10'), widgetEl.innerHTML);
  // scaleX() plutôt que width (audit design, emil-design-eng : transform/
  // opacity seuls sont compositor-friendly) — voir --pct, css/style.css.
  assert.ok(widgetEl.innerHTML.includes('--pct:0.2'), widgetEl.innerHTML);
  assert.ok(!widgetEl.innerHTML.includes('is-complete'), 'pas encore atteint à 2/10');
});

test('renderAnnualGoalWidget() : objectif atteint -> classe is-complete + message de félicitations, barre plafonnée à 100%', () => {
  const year = new Date().getFullYear();
  const { ctx, widgetEl } = buildContext({
    currentProfile: { display_name: 'Test', annual_goal_year: year, annual_goal_count: 2 },
  });
  setState(ctx, {
    films: [
      { id: 1, title: 'A', manualNote: 4, fav: false, genreIds: [] },
      { id: 2, title: 'B', manualNote: 3, fav: false, genreIds: [] },
      { id: 3, title: 'C', manualNote: 5, fav: false, genreIds: [] },
    ],
    viewings: [
      { filmId: 1, watchedAt: new Date(year, 2, 1).getTime() },
      { filmId: 2, watchedAt: new Date(year, 3, 1).getTime() },
      { filmId: 3, watchedAt: new Date(year, 4, 1).getTime() },
    ],
  });
  ctx.renderAnnualGoalWidget();
  assert.ok(widgetEl.innerHTML.includes('is-complete'), widgetEl.innerHTML);
  assert.ok(widgetEl.innerHTML.includes('--pct:1'), 'jamais au-delà de 100% (scaleX(1) max) même à 3/2');
  assert.ok(widgetEl.innerHTML.includes('atteint'), widgetEl.innerHTML);
});

test('renderAnnualGoalWidget() : objectif fixé une ANNÉE PASSÉE (pas celle-ci) -> traité comme "pas d\'objectif", reprompt pour cette année', () => {
  const year = new Date().getFullYear();
  const { ctx, widgetEl } = buildContext({
    currentProfile: { display_name: 'Test', annual_goal_year: year - 1, annual_goal_count: 40 },
  });
  ctx.renderAnnualGoalWidget();
  assert.ok(widgetEl.innerHTML.includes('annualGoalForm'), 'doit reproposer un formulaire, pas afficher l\'ancien objectif');
});

test('saveAnnualGoal() : succès -> met à jour currentProfile et redessine le widget', async () => {
  const year = new Date().getFullYear();
  const updateCalls = [];
  const { ctx, widgetEl } = buildContext({
    supabaseClient: {
      from(table){
        assert.strictEqual(table, 'profiles');
        return {
          update(payload){
            updateCalls.push(payload);
            return {
              eq(){ return this; },
              select(){ return this; },
              single(){ return Promise.resolve({ data: { display_name: 'Test', annual_goal_year: year, annual_goal_count: 25 }, error: null }); },
            };
          },
        };
      },
    },
  });
  await ctx.saveAnnualGoal(year, 25);
  // Objet construit DANS le contexte vm (autre realm) : comparaison via
  // JSON pour éviter le faux-négatif deepStrictEqual sur des prototypes
  // Object différents entre deux realms — même repli qu'ailleurs dans
  // cette suite (ex. tests/comment-reactions.test.js).
  assert.deepStrictEqual(JSON.parse(JSON.stringify(updateCalls[0])), { annual_goal_year: year, annual_goal_count: 25 });
  const profile = ctx.currentProfile;
  assert.strictEqual(profile.annual_goal_count, 25);
  assert.ok(widgetEl.innerHTML.includes('0 / 25'), widgetEl.innerHTML);
});

test('saveAnnualGoal() : erreur réseau (ex. migration 056 pas encore appliquée, colonne inconnue) -> toast, currentProfile INCHANGÉ, pas d\'exception', async () => {
  const year = new Date().getFullYear();
  const { ctx, toasts } = buildContext({
    currentProfile: { display_name: 'Test' },
    supabaseClient: {
      from(){
        return {
          update(){
            return {
              eq(){ return this; },
              select(){ return this; },
              single(){ return Promise.resolve({ data: null, error: { message: 'column "annual_goal_year" does not exist' } }); },
            };
          },
        };
      },
    },
  });
  await ctx.saveAnnualGoal(year, 25);
  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(ctx.currentProfile.annual_goal_count, undefined);
});

module.exports = run('annual-goal.test.js');
