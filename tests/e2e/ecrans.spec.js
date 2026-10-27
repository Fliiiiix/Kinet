// --- Tests d'écrans : tout Kinet, connecté, avec des données de démonstration ---
// Parcourt les pages et les fenêtres principales sur PC et téléphone, en
// thème sombre et clair, et échoue au premier souci visible : erreur
// JavaScript, page plus large que l'écran, « undefined » ou « NaN » à l'écran,
// texte illisible (contraste sous 3:1). Les captures vont dans
// test-results/ecrans/ pour un coup d'œil.
//
// Auparavant un banc d'essai du dossier temporaire de Claude (audit général du
// 16/10), en partie effacé le 27/10 : il vit désormais ici.
// Lancer : npm run test:ecrans (quelques minutes, les affiches viennent de TMDB).
const path = require('path');
const { test, expect } = require('@playwright/test');

const DONNEES = path.join(__dirname, 'donnees-demo.js');
const CAPTURES = path.join(__dirname, '..', '..', 'test-results', 'ecrans');

const PAGES = [
  ['catalogue', '#/'], ['series', '#/series'], ['serie', '#/series/28'], ['film', 'FILM'], ['a-voir', '#/watchlist'],
  ['bientot', '#/prochainement'], ['amis', '#/amis'], ['top', '#/top'], ['profil', '#/profil'], ['parametres', '#/parametres'],
  ['avis', '#/avis'], ['admin', '#/admin'], ['groupes', '#/groupes'], ['groupe', '#/groupes/5'], ['proposition', '#/groupes/5/propositions/12'],
  ['listes', '#/listes'], ['liste', '#/listes/1'], ['liste-ami', '#/listes/3'],
];
const FENETRES = [
  ['notation-nouveau', 'openModal()'], ['notation-film', 'openModal(1)'], ['notation-sans-criteres', 'openModal(2)'],
  ['statistiques', 'openStats()'], ['succes', 'openAchievements()'], ['cartes', 'openTcgModal()'], ['journal', 'openJournal()'],
  ['nouveautes', 'openChangelogModal()'],
  // Série : un épisode vu ouvert, avec sa note et son commentaire.
  ['serie-episode', "location.hash = '#/series/28'; new Promise(r => setTimeout(r, 3000)).then(() => { const b = document.querySelector('[data-sq=\"1-1\"]'); if(b) b.click(); return new Promise(r => setTimeout(r, 500)); }).then(() => { const c = document.querySelector('[data-ep-comment-edit]'); if(c) c.click(); const p = document.querySelector('.sx-sel'); if(p) p.scrollIntoView({ block: 'center' }); })"],
  ['aide-cartes', "Promise.resolve(openTcgModal()).then(() => document.querySelector('#tcgOverlay .help-q').click())"],
  ['aide-notation', "openModal(1); document.querySelector('.nt-head .help-q').click()"],
  // La roulette tourne encore pendant la vérification : seul l'affichage compte ici.
  ['surprends-moi', "location.hash = '#/watchlist'; new Promise(r => setTimeout(r, 2500)).then(() => openSurprise())"],
  ['surprends-moi-criteres', "location.hash = '#/watchlist'; new Promise(r => setTimeout(r, 2500)).then(() => { openSurprise(); toggleSurpriseCriteria(); })"],
  ['ajouter-a-une-liste', 'openAddToListSheet({ tmdbId: __demo.Dune.id, title: __demo.Dune.title, posterUrl: __demo.Dune.poster, releaseYear: 2021 })'],
];

const VARIANTES = [
  { nom: 'pc-sombre', viewport: { width: 1280, height: 860 }, theme: 'dark' },
  { nom: 'tel-sombre', viewport: { width: 375, height: 812 }, mobile: true, theme: 'dark' },
  { nom: 'pc-clair', viewport: { width: 1280, height: 860 }, theme: 'light' },
  { nom: 'tel-clair', viewport: { width: 375, height: 812 }, mobile: true, theme: 'light' },
];

// Exécutée dans la page : la liste des soucis de l'écran affiché.
function verifierEcran(){
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const portee = [...document.querySelectorAll('.overlay.open .modal, .overlay.open')].pop()
    || [...document.querySelectorAll('.page')].find(p => p.style.display !== 'none') || document.body;
  const soucis = [];
  const deborde = document.documentElement.scrollWidth - innerWidth;
  if(deborde > 1) soucis.push(`déborde de ${deborde} px`);
  const lignes = (portee.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  lignes.filter(l => /\bundefined\b|\bNaN\b|\[object |&#39;|&quot;|&amp;|&lt;|&gt;/.test(l)).slice(0, 3)
    .forEach(l => soucis.push(`texte suspect : « ${l.slice(0, 60)} »`));
  // Contraste : couleur du texte contre le premier fond opaque au-dessus.
  const rgb = c => { const m = c && c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fond = el => { for(let e = el; e && e.nodeType === 1; e = e.parentElement){ const cs = getComputedStyle(e); if(cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = rgb(cs.backgroundColor); if(c && c.a > 0.85) return c; } return null; };
  [...portee.querySelectorAll('*')].forEach(el => {
    if(!visible(el) || el.closest('.bar-value')) return; // chiffre posé au-dessus de sa barre : le fond lu serait la barre
    const r = el.getBoundingClientRect();
    if(r.bottom <= 0 || r.right <= 0) return; // hors de l'écran (lien « Aller au contenu » avant le Tab)
    const propre = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
    if(!/[\p{L}\p{N}]/u.test(propre)) return; // émojis décoratifs : pas du texte à lire
    const cs = getComputedStyle(el);
    const texte = rgb(cs.color), arriere = fond(el);
    if(!texte || !arriere || parseFloat(cs.opacity) < 0.6) return;
    const l1 = lum(texte), l2 = lum(arriere);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if(ratio < 3) soucis.push(`illisible (${ratio.toFixed(2)}:1) : « ${el.textContent.trim().slice(0, 40)} »`);
  });
  return soucis.slice(0, 8);
}

test.describe.configure({ mode: 'parallel' });

for(const v of VARIANTES){
  test(`${v.nom} : chaque écran s'affiche sans souci`, async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const context = await browser.newContext({ baseURL: 'http://localhost:8765', viewport: v.viewport, isMobile: !!v.mobile, hasTouch: !!v.mobile, serviceWorkers: 'block' });
    await context.addInitScript((t) => { try{ localStorage.setItem('kinetTheme', t); }catch(e){} }, v.theme);
    const page = await context.newPage();
    let erreurs = [];
    page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 200)));
    page.on('console', m => {
      if(m.type() !== 'error') return;
      const t = m.text();
      // Service worker bloqué exprès, ressources réseau (affiches) hors sujet ici.
      if(/service worker|Failed to load resource|net::ERR/i.test(t)) return;
      erreurs.push(t.slice(0, 200));
    });

    await page.goto('/index.html');
    await page.waitForTimeout(2000);
    await page.addScriptTag({ path: DONNEES });
    await page.evaluate(() => window.__kinetDemo());
    await page.waitForTimeout(2000);
    const filmId = await page.evaluate(() => __demo.Arrival.id);
    const problemes = [];
    const noter = (nom, soucis) => {
      soucis.concat(erreurs.map(e => `erreur JS : ${e}`)).forEach(s => problemes.push(`${v.nom} / ${nom} : ${s}`));
      erreurs = [];
    };
    noter('démarrage', []);

    for(const [nom, hash] of PAGES){
      await page.evaluate(h => { location.hash = h; }, hash === 'FILM' ? `#/film/${filmId}` : hash);
      await page.waitForTimeout(2500);
      noter(nom, await page.evaluate(verifierEcran));
      await page.screenshot({ path: path.join(CAPTURES, `${v.nom}-${nom}.png`), fullPage: true });
    }

    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForTimeout(1200);
    for(const [nom, code] of FENETRES){
      await page.evaluate(c => { const r = eval(c); return r && r.then ? r.then(() => true) : true; }, code);
      await page.waitForTimeout(2000);
      noter(nom, await page.evaluate(verifierEcran));
      await page.screenshot({ path: path.join(CAPTURES, `${v.nom}-${nom}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
        document.documentElement.classList.remove('scroll-locked');
        location.hash = '#/';
      });
      await page.waitForTimeout(700);
    }

    await context.close();
    expect(problemes, problemes.join('\n')).toEqual([]);
  });
}
