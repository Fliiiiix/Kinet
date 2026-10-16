// --- Tests de la notation en pas à pas (js/notation.js) ---
// Audit des six écrans, piste B choisie par Flix le 16/10 : un nouveau film
// se note critère par critère, un film déjà noté s'ouvre sur son résumé, ou
// sur sa note directe s'il a été noté sans critères.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const elements = {
    manualToggle: stubElement({ checked: false }),
    manualScoreSlider: stubElement({ value: '2.5' }),
  };
  const toasts = [];
  const ctx = createContext({
    document: stubDocument(elements),
    showToast(m){ toasts.push(m); },
    blockIfOffline(){ return false; },
    noteColorClass(n){ return n == null ? '' : n >= 4 ? 'rate-high' : n >= 2.5 ? 'rate-mid' : 'rate-low'; },
  });
  loadFiles(ctx, ['js/data.js', 'js/app.js', 'js/notation.js']);
  ctx.escapeHtml = (s) => String(s);
  ctx.showToast = (m) => toasts.push(m); // la vraie, dans app.js, écrit dans le DOM
  // tmdbSelected vit dans js/tmdb.js, non chargé ici.
  ctx.tmdbSelected = null;
  return { ctx, elements, toasts };
}

const crit = { scenario: 0.9, mise_en_scene: 0.75, jeu: 0.95, esthetique: 0.9, son: 0.8, musique: 0.9, ressenti: 0.85 };

test('les trois repères d’un critère, sans le préfixe de l’ancienne échelle', () => {
  const { ctx } = buildContext();
  const a = ctx.ntAnchors(getState(ctx, 'CRITERIA[0]'));
  assert.strictEqual(a.length, 3);
  assert.ok(!/→/.test(a.join(' ')), a.join(' | '));
  assert.ok(a[0].startsWith('incohérente'), a[0]);
});

test('grille et note directe égales (audit N1) : s’ouvre sur le résumé, en critères', () => {
  const { ctx, elements } = buildContext();
  const film = { id: 1, title: 'Arrival', crit, manualNote: 4.5 };
  setState(ctx, { films: [film], editingId: 1 });
  elements.manualToggle.checked = true;
  ctx.ntOpen(film);
  assert.strictEqual(getState(ctx, 'ntScreen'), 'summary');
  assert.strictEqual(elements.manualToggle.checked, false);
});

test('noté sans critères : s’ouvre sur la note directe', () => {
  const { ctx, elements } = buildContext();
  const film = { id: 2, title: 'Paprika', crit: {}, manualNote: 5 };
  setState(ctx, { films: [film], editingId: 2 });
  ctx.ntOpen(film);
  assert.strictEqual(getState(ctx, 'ntScreen'), 'direct');
  assert.strictEqual(elements.manualToggle.checked, true);
});

test('note directe différente de la grille : c’est elle qui compte, on ouvre la note directe', () => {
  const { ctx } = buildContext();
  const film = { id: 3, title: 'Whiplash', crit, manualNote: 3 };
  setState(ctx, { films: [film], editingId: 3 });
  ctx.ntOpen(film);
  assert.strictEqual(getState(ctx, 'ntScreen'), 'direct');
});

test('film vu mais pas noté (import) : premier critère', () => {
  const { ctx } = buildContext();
  const film = { id: 4, title: 'November', crit: {}, manualNote: null };
  setState(ctx, { films: [film], editingId: 4 });
  ctx.ntOpen(film);
  assert.strictEqual(getState(ctx, 'ntScreen'), 'step');
  assert.strictEqual(getState(ctx, 'ntStep'), 0);
});

test('nouveau film : choisir le film d’abord, puis le premier critère', () => {
  const { ctx } = buildContext();
  setState(ctx, { films: [], editingId: null });
  ctx.ntOpen(null);
  assert.strictEqual(getState(ctx, 'ntScreen'), 'pick');
  ctx.tmdbSelected = { tmdb_id: 9, title: 'Zodiac', release_year: 2007 };
  ctx.ntOnFilmChosen();
  assert.strictEqual(getState(ctx, 'ntScreen'), 'step');
});

test('on n’enregistre pas un résumé sans aucun critère réglé', () => {
  const { ctx, toasts } = buildContext();
  setState(ctx, { films: [], editingId: null, ntScreen: 'summary', critPristine: true });
  assert.strictEqual(ctx.ntCanSave(), false);
  assert.ok(/critère/.test(toasts[0]));
  setState(ctx, { critPristine: false });
  assert.strictEqual(ctx.ntCanSave(), true);
});

module.exports = run('notation-steps.test.js');
