// --- Tests des réglages partagés entre appareils (js/prefsSync.js) ---
// Idée retenue par Flix le 28/10 : thème, sons, pays, affichages... suivent le
// compte (user_prefs.settings, migration 068) au lieu de chaque appareil.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, setState } = require('./helpers/vm-harness');
const { test, run } = createSuite();

const plain = (v) => JSON.parse(JSON.stringify(v));

// Une table user_prefs en mémoire, partagée entre deux « appareils ».
function fakeBase({ migrated = true, settings = null } = {}){
  const base = { row: settings ? { user_id: 'u1', settings } : null, upserts: 0 };
  base.client = {
    from(table){
      assert.strictEqual(table, 'user_prefs');
      const q = {
        select(){ return q; }, eq(){ return q; },
        maybeSingle(){
          if(!migrated) return Promise.resolve({ data: null, error: { message: 'column user_prefs.settings does not exist' } });
          return Promise.resolve({ data: base.row ? { settings: JSON.parse(JSON.stringify(base.row.settings)) } : null, error: null });
        },
        upsert(row){
          base.upserts++;
          base.row = { user_id: row.user_id, settings: JSON.parse(JSON.stringify(row.settings)) };
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  };
  return base;
}

function device(base, local = {}){
  const calls = { theme: [] };
  const ctx = createContext({
    supabaseClient: base.client,
    getThemeChoice(){ return ctx.localStorage.getItem('kinetTheme') || 'dark'; },
    setTheme(t){ calls.theme.push(t); },
    setInterval(){ return 1; }, clearInterval(){},
  });
  loadFiles(ctx, ['js/prefsSync.js']);
  Object.keys(local).forEach(k => ctx.localStorage.setItem(k, local[k]));
  setState(ctx, { currentUser: { id: 'u1' } });
  return { ctx, calls };
}

test('migration 068 pas lancée : chaque appareil garde ses réglages, rien n’est envoyé', async () => {
  const base = fakeBase({ migrated: false });
  const { ctx } = device(base, { kinetTheme: 'light' });
  await ctx.syncPrefs();
  await ctx.pushLocalPrefs();
  assert.strictEqual(base.upserts, 0);
  assert.strictEqual(ctx.localStorage.getItem('kinetTheme'), 'light');
});

test('premier appareil après la migration : ses réglages partent dans la base', async () => {
  const base = fakeBase();
  const { ctx } = device(base, { kinetTheme: 'light', kinetWatchRegion: 'ZA' });
  await ctx.syncPrefs();
  assert.strictEqual(base.row.settings.kinetTheme, 'light');
  assert.strictEqual(base.row.settings.kinetWatchRegion, 'ZA');
});

test('deuxième appareil : à la connexion, il prend les réglages de la base et les montre', async () => {
  const base = fakeBase({ settings: { kinetTheme: 'light', kinetWatchRegion: 'ZA' } });
  const { ctx, calls } = device(base, { kinetTheme: 'dark' });
  await ctx.syncPrefs();
  assert.strictEqual(ctx.localStorage.getItem('kinetTheme'), 'light');
  assert.strictEqual(ctx.localStorage.getItem('kinetWatchRegion'), 'ZA');
  assert.deepStrictEqual(calls.theme, ['light'], 'le thème change tout de suite, sans recharger');
});

test('deux appareils changent chacun un réglage : aucun n’efface l’autre', async () => {
  const base = fakeBase({ settings: { kinetTheme: 'dark', kinetWatchRegion: 'FR' } });
  const phone = device(base);
  const pc = device(base);
  await phone.ctx.syncPrefs();
  await pc.ctx.syncPrefs();
  phone.ctx.localStorage.setItem('kinetTheme', 'light');   // sur le téléphone
  await phone.ctx.pushLocalPrefs();
  pc.ctx.localStorage.setItem('kinetWatchRegion', 'ZA');   // sur le PC, entre-temps
  await pc.ctx.pushLocalPrefs();
  assert.deepStrictEqual(plain(base.row.settings), { kinetTheme: 'light', kinetWatchRegion: 'ZA' });
  assert.strictEqual(pc.ctx.localStorage.getItem('kinetTheme'), 'light', 'le PC reçoit le thème du téléphone');
  await pc.ctx.pushLocalPrefs();
  assert.strictEqual(base.row.settings.kinetTheme, 'light', 'et ne le remet pas à l’ancien au tour suivant');
});

test('rien de changé : aucun envoi', async () => {
  const base = fakeBase({ settings: { kinetTheme: 'dark' } });
  const { ctx } = device(base);
  await ctx.syncPrefs();
  const before = base.upserts;
  await ctx.pushLocalPrefs();
  assert.strictEqual(base.upserts, before);
});

test('base : seules les clés connues, et seulement du texte', () => {
  const { ctx } = device(fakeBase());
  assert.deepStrictEqual(plain(ctx.cleanRemotePrefs({ kinetTheme: 'light', kinetSoundVolume: 50, inconnu: 'x', kinetWatchRegion: null })), { kinetTheme: 'light', kinetWatchRegion: null });
});

module.exports = run('prefs-sync.test.js');
