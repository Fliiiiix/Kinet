// --- Tests de la page de connexion (js/auth.js, piste A du 15/10) ---
// Le lien par email ouvre un vrai écran « Regarde tes mails » (plus une
// ligne grise sous le bouton), avec « Renvoyer le lien » et « Changer
// d'email ». Le mur d'affiches est rempli depuis une liste fixe.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

function buildContext({ otpError = null } = {}){
  const focused = [];
  const elements = {
    authEmail: stubElement({ value: '', focus(){ focused.push('authEmail'); } }),
    authStatus: stubElement(),
    authForm: stubElement({ hidden: false }),
    authSent: stubElement({ hidden: true }),
    authSentEmail: stubElement(),
    authResendBtn: stubElement({ textContent: 'Renvoyer le lien' }),
    authWall: stubElement(),
  };
  const otpCalls = [];
  const ctx = createContext({
    document: stubDocument(elements),
    window: { location: { href: 'https://fliiiiix.github.io/Kinet/?x=1#/invite/abc' }, addEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }) },
    supabaseClient: {
      auth: {
        signInWithOtp(args){ otpCalls.push(args); return Promise.resolve({ error: otpError }); },
        signInWithOAuth(){ return Promise.resolve({ error: null }); },
      },
      // initAuth() (en bas du fichier) s'arrête tout de suite : site en
      // maintenance simulé, voir checkMaintenance().
      from(){ return { select(){ return { eq(){ return { maybeSingle(){ return Promise.resolve({ data: { maintenance: true, message: '' }, error: null }); } }; } }; } }; },
    },
    buildSortOptions(){}, parseRoute(){ return { name: 'home' }; },
    showOnlyPage(){}, exitHeaderEditMode(){}, blockIfOffline(){ return false; }, showToast(){},
  });
  loadFiles(ctx, ['js/auth.js']);
  return { ctx, elements, otpCalls, focused };
}

test('email vide ou sans @ : message, on reste sur le formulaire, aucun envoi', async () => {
  const { ctx, elements, otpCalls } = buildContext();
  elements.authEmail.value = 'flix';
  await ctx.handleSendMagicLink();
  assert.strictEqual(elements.authStatus.textContent, 'Entre ton email pour recevoir le lien.');
  assert.strictEqual(elements.authSent.hidden, true);
  assert.strictEqual(otpCalls.length, 0);
});

test('lien envoyé : écran « Regarde tes mails » avec l\'email, retour sur la page sans hash ni paramètres', async () => {
  const { ctx, elements, otpCalls } = buildContext();
  elements.authEmail.value = '  toi@exemple.fr ';
  await ctx.handleSendMagicLink();
  assert.strictEqual(otpCalls.length, 1);
  assert.strictEqual(otpCalls[0].email, 'toi@exemple.fr');
  assert.strictEqual(otpCalls[0].options.emailRedirectTo, 'https://fliiiiix.github.io/Kinet/');
  assert.strictEqual(elements.authForm.hidden, true);
  assert.strictEqual(elements.authSent.hidden, false);
  assert.strictEqual(elements.authSentEmail.textContent, 'toi@exemple.fr');
  assert.strictEqual(elements.authStatus.textContent, '');
});

test('erreur Supabase : le message s\'affiche, on reste sur le formulaire', async () => {
  const { ctx, elements } = buildContext({ otpError: { message: 'Trop de demandes' } });
  elements.authEmail.value = 'toi@exemple.fr';
  await ctx.handleSendMagicLink();
  assert.strictEqual(elements.authStatus.textContent, 'Erreur : Trop de demandes');
  assert.strictEqual(elements.authSent.hidden, true);
});

test('« Renvoyer le lien » renvoie au même email ; « Changer d\'email » ramène au formulaire', async () => {
  const { ctx, elements, otpCalls, focused } = buildContext();
  elements.authEmail.value = 'toi@exemple.fr';
  await ctx.handleSendMagicLink();
  await ctx.handleResendMagicLink();
  assert.strictEqual(otpCalls.length, 2);
  assert.strictEqual(otpCalls[1].email, 'toi@exemple.fr');
  assert.strictEqual(elements.authResendBtn.textContent, 'Lien renvoyé');
  ctx.showAuthForm();
  assert.strictEqual(elements.authSent.hidden, true);
  assert.strictEqual(elements.authForm.hidden, false);
  assert.deepStrictEqual(focused, ['authEmail']);
});

test('mur d\'affiches : 24 affiches TMDB en w185, sans texte alternatif (décor)', () => {
  const { elements } = buildContext();
  const imgs = elements.authWall.innerHTML.match(/<img [^>]*>/g) || [];
  assert.strictEqual(imgs.length, 24);
  assert.ok(imgs.every(tag => tag.includes('https://image.tmdb.org/t/p/w185/') && tag.includes('alt=""')));
});

module.exports = run('auth-login.test.js');
