// --- Tests de l'album sans hasard (js/album.js, draft Profil du 15/10) ---
// Chaque film noté donne sa carte, son rang suit ta note ; un réalisateur ou
// un acteur monte avec le nombre de ses films que tu as vus ; « Bientôt dans
// ta collection » met d'abord ce qu'un film d'À voir ferait monter.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext(){
  const ctx = createContext({ document: stubDocument(), escapeHtml(s){ return String(s); }, uiIcon(){ return ''; }, FILM_PLACEHOLDER_SVG: '' });
  loadFiles(ctx, ['js/album.js']);
  return ctx;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('rang d\'un film : 5 Légende, 4.5 Tête d\'affiche, 4 Second rôle, sinon Figurant', () => {
  const ctx = buildContext();
  assert.deepStrictEqual([5, 4.5, 4, 3.5].map(ctx.albumFilmRank), [4, 3, 2, 1]);
});

test('rang d\'une personne : 1 film Figurant, 2 Second rôle, 4 Tête d\'affiche, 7 Légende', () => {
  const ctx = buildContext();
  assert.deepStrictEqual([1, 2, 3, 4, 6, 7, 12].map(ctx.albumPersonRank), [1, 2, 2, 3, 3, 4, 4]);
  assert.deepStrictEqual(plain(ctx.albumNextStep(3)), { rank: 3, need: 1, progress: 0.75 });
  assert.strictEqual(ctx.albumNextStep(7), null);
});

function sample(ctx){
  const rated = [
    { tmdbId: 1, title: 'Orange mécanique', note: 5 },
    { tmdbId: 2, title: 'Shining', note: 4.5 },
    { tmdbId: 3, title: 'No Country for Old Men', note: 5 },
  ];
  const wl = [{ tmdbId: 4, title: 'La Ballade de Buster Scruggs' }];
  const filmCards = [{ id: 11, tmdb_id: 1 }, { id: 12, tmdb_id: 2 }, { id: 13, tmdb_id: 3 }, { id: 14, tmdb_id: 4 }];
  const persons = [
    { id: 101, card_type: 'director', name: 'Stanley Kubrick' },
    { id: 102, card_type: 'director', name: 'Joel Coen' },
    { id: 103, card_type: 'actor', name: 'Javier Bardem' },
  ];
  const links = [
    { film_card_id: 11, person_card_id: 101 }, { film_card_id: 12, person_card_id: 101 },
    { film_card_id: 13, person_card_id: 102 }, { film_card_id: 14, person_card_id: 102 },
    { film_card_id: 13, person_card_id: 103 },
  ];
  return ctx.buildAlbum(rated, wl, filmCards, links, persons);
}

test('album : une carte par film noté, les personnes comptent leurs films vus', () => {
  const ctx = buildContext();
  const a = sample(ctx);
  assert.strictEqual(a.films.length, 3);
  assert.deepStrictEqual(plain(a.directors.map(d => [d.person.name, d.count, d.rank])), [['Stanley Kubrick', 2, 2], ['Joel Coen', 1, 1]]);
  assert.deepStrictEqual(plain(a.actors.map(d => d.person.name)), ['Javier Bardem']);
  assert.strictEqual(ctx.albumSummaryText(a), '3 films · 2 réalisateurs · 1 acteur');
});

test('un film d\'À voir ne compte pas, mais met la personne en tête de « Bientôt »', () => {
  const ctx = buildContext();
  const a = sample(ctx);
  assert.strictEqual(a.next[0].card.person.name, 'Joel Coen');
  assert.strictEqual(ctx.albumNextSub(a.next[0]), 'La Ballade de Buster Scruggs est dans ton À voir');
});

test('les films notés sans cartes générées sont signalés pour le rattrapage', () => {
  const ctx = buildContext();
  const a = ctx.buildAlbum([{ tmdbId: 9, title: 'Nouveau', note: 4 }], [], [], [], []);
  assert.deepStrictEqual(plain(a.missing), [9]);
  assert.strictEqual(a.films.length, 1, 'la carte du film existe quand même');
});

test('un film vu sans note donne une carte Figurant et compte pour ses acteurs', () => {
  const ctx = buildContext();
  const a = ctx.buildAlbum(
    [{ tmdbId: 1, title: 'Heat', note: null }, { tmdbId: 2, title: 'Collateral', note: 4 }],
    [], [{ id: 11, tmdb_id: 1 }, { id: 12, tmdb_id: 2 }],
    [{ film_card_id: 11, person_card_id: 101 }, { film_card_id: 12, person_card_id: 101 }],
    [{ id: 101, card_type: 'director', name: 'Michael Mann' }]
  );
  assert.deepStrictEqual(plain(a.films.map(f => [f.film.title, f.rank])), [['Collateral', 2], ['Heat', 1]]);
  assert.strictEqual(a.directors[0].count, 2);
  assert.ok(ctx.albumCardHtml(a.films[1], 1).includes('pas encore noté'));
});

module.exports = run('album.test.js');
