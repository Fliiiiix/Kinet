// --- Tests de la persistance des saisons dépliées + progression de l'en-tête
// (js/series.js) --- Retour utilisateur : "je déplie la saison 1, je change
// de page et je reviens sur Kinet, la série n'est plus dépliée. Ca c'est
// pas pratique !" openSeason()/closeSeason() (extraites de l'ancien
// toggleSeason()) mémorisent ce qui est déplié par série (seasonUiCache) et
// ne retéléchargent jamais une saison déjà en cache — testé ici en comptant
// les appels à fetchTvSeason(). renderEpisodesFicheValue()/renderRatingRing()
// sont les lignes "Épisodes"/note de la .fiche (v3.2, draft Scope) —
// anciennement un unique renderSeriesHeroStats() sous le résumé (retour
// utilisateur : "ça laisse un grand espace non utilisé au milieu"), éclaté
// en deux pour suivre le nouveau découpage de la fiche.
//
// Piège vm (voir tests/README.md et episode-notes.test.js) : les `let` de
// script top-level de series.js (seasonUiCache, loadedSeasonEpisodes,
// trackedShows, currentShowId, watchedEpisodeSet...) ne sont lisibles/
// écrivables depuis l'hôte qu'via setState()/getState(), jamais directement
// sur le contexte.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState, getState, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// Un élément avec un VRAI classList (Set-backed) : les stubs par défaut de
// vm-harness ont un classList no-op (contains() renvoie toujours false), ce
// qui ne suffit pas pour vérifier qu'une saison repasse bien "ouverte".
function stubBlock(overrides = {}){
  const classes = new Set();
  return Object.assign(stubElement(overrides), {
    classList: {
      add(c){ classes.add(c); },
      remove(c){ classes.delete(c); },
      toggle(c, on){ on ? classes.add(c) : classes.delete(c); },
      contains(c){ return classes.has(c); },
    },
  });
}

function buildContext(){
  const seasonBlock = stubBlock({ dataset: { season: '1' } });
  const episodesEl = stubElement();
  const episodesFicheEl = stubElement();
  const ratingRingEl = stubElement();
  let fetchCalls = 0;

  const elements = {
    'seasonEpisodes-1': episodesEl,
    'seriesDetailEpisodes': episodesFicheEl,
    'seriesDetailRatingRing': ratingRingEl,
  };
  const doc = stubDocument(elements);
  // document.querySelector(`.season-block[data-season="1"]`) : seule la
  // saison 1 existe dans ce test, pas la peine d'un vrai sélecteur CSS.
  doc.querySelector = (sel) => (sel.includes('data-season="1"') ? seasonBlock : null);

  const ctx = createContext({
    document: doc,
    goToSeries(){},
    blockIfOffline(){ return false; },
    showToast(){},
    escapeHtml(s){ return s; },
    formatDateFr(){ return ''; },
    noteColorClass(){ return ''; },
    pulseCheckbox(){},
    supabaseClient: { from(){ throw new Error('non utilisé dans ce test'); } },
    async fetchTvSeason(){
      fetchCalls++;
      return { episodes: [{ episode_number: 1, name: 'Pilote', air_date: null }, { episode_number: 2, name: 'Suite', air_date: null }] };
    },
  });
  loadFiles(ctx, ['js/series.js']);
  setState(ctx, {
    currentShowId: 1,
    trackedShows: [{ id: 1, tmdbId: 999, numberOfEpisodes: 8, manualNote: null }],
    currentShowSeasons: [{ season_number: 1, episode_count: 8 }],
    watchedEpisodeSet: new Set(['1-1', '1-2', '1-3']),
    watchedEpisodeExtras: {},
    seasonUiCache: { 1: { expanded: new Set(), episodes: {} } },
  });
  // loadedSeasonEpisodes doit être LE MÊME objet que seasonUiCache[1].episodes
  // (c'est ce qu'openShowDetail() fait en vrai, voir js/series.js) — sinon le
  // test ne prouve rien sur le cache par série.
  setState(ctx, { loadedSeasonEpisodes: getState(ctx, 'seasonUiCache')[1].episodes });
  return { ctx, seasonBlock, episodesEl, episodesFicheEl, ratingRingEl, getFetchCalls: () => fetchCalls };
}

test('openSeason() : déplie, télécharge une seule fois, et mémorise que la saison est ouverte', async () => {
  const { ctx, seasonBlock, getFetchCalls } = buildContext();
  await ctx.openSeason(1);
  assert.strictEqual(seasonBlock.classList.contains('open'), true, 'la saison doit être marquée ouverte');
  assert.strictEqual(getFetchCalls(), 1, 'un seul appel TMDB pour le premier déploiement');
  assert.ok(getState(ctx, 'seasonUiCache')[1].expanded.has(1), 'la saison 1 doit être retenue comme dépliée');
});

test('closeSeason() puis openSeason() : se redéplie SANS retélécharger (cache par série)', async () => {
  const { ctx, seasonBlock, getFetchCalls } = buildContext();
  await ctx.openSeason(1);
  ctx.closeSeason(1);
  assert.strictEqual(seasonBlock.classList.contains('open'), false, 'fermée : plus la classe open');
  assert.strictEqual(getState(ctx, 'seasonUiCache')[1].expanded.has(1), false, 'fermée : plus retenue comme dépliée');

  await ctx.openSeason(1);
  assert.strictEqual(seasonBlock.classList.contains('open'), true, 'redéploiement : à nouveau ouverte');
  assert.strictEqual(getFetchCalls(), 1, 'toujours un seul appel TMDB au total : les épisodes étaient déjà en cache');
});

test('openSeason() sur une saison déjà ouverte ne fait rien (pas de double appel)', async () => {
  const { ctx, getFetchCalls } = buildContext();
  await ctx.openSeason(1);
  await ctx.openSeason(1);
  assert.strictEqual(getFetchCalls(), 1, 'un seul appel TMDB malgré les deux appels à openSeason()');
});

test('renderEpisodesFicheValue() : épisodes vus/total si on connaît le total, sinon "—"', () => {
  const { ctx, episodesFicheEl } = buildContext();
  ctx.renderEpisodesFicheValue({ numberOfEpisodes: 8 });
  assert.strictEqual(episodesFicheEl.textContent, '3 / 8 vus');

  setState(ctx, { currentShowSeasons: [], watchedEpisodeSet: new Set() });
  ctx.renderEpisodesFicheValue({ numberOfEpisodes: 0 });
  assert.strictEqual(episodesFicheEl.textContent, '—');
});

test('renderRatingRing() : affiche la note manuelle si elle existe, "—" sinon', () => {
  const { ctx, ratingRingEl } = buildContext();
  ctx.renderRatingRing({ manualNote: null });
  assert.strictEqual(ratingRingEl.textContent, '—');
  assert.strictEqual(ratingRingEl.className, 'counter');

  ctx.renderRatingRing({ manualNote: 4.5 });
  assert.strictEqual(ratingRingEl.textContent, '4.5');
  assert.ok(ratingRingEl.className.startsWith('counter '), ratingRingEl.className);
});

module.exports = run('season-persistence.test.js');
