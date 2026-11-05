// --- Construction de Kinet (étape 1 du passage à React, 05/11) ---
// Vite assemble le site dans dist/ avant chaque mise en ligne (scripts/deploy.js).
// Les fichiers de js/ restent pour l'instant des scripts classiques, qui se
// partagent tout (l'étape 2 en fera des modules) : ils sont seulement compactés,
// sans rien renommer à l'intérieur, et leur nom suit leur contenu
// (app-1a2b3c4d.js). C'est ce qui remplace le ?v=N monté à la main. Le CSS passe
// par Vite, compacté et nommé de même. Le reste est copié tel quel.
// En développement (npm run dev), rien de tout ça : Vite sert les fichiers bruts.
import { defineConfig } from 'vite';
import { minify } from 'rolldown/utils';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Lus par l'app à leur adresse exacte : copiés sans changer de nom.
const COPIES = ['manifest.json', 'icons', 'data'];
const SCRIPT_CLASSIQUE = /<script src="(js\/[^"]+\.js)"><\/script>/g;

const empreinte = (contenu) => createHash('sha256').update(contenu).digest('hex').slice(0, 8);

function scriptsClassiques(){
  const noms = new Map(); // js/app.js -> assets/app-1a2b3c4d.js
  return {
    name: 'kinet-scripts-classiques',
    apply: 'build',
    async buildStart(){
      const html = fs.readFileSync('index.html', 'utf8');
      for(const [, src] of html.matchAll(SCRIPT_CLASSIQUE)){
        const code = fs.readFileSync(src, 'utf8');
        // Ni renommage ni réécriture : seulement commentaires et espaces en moins.
        const compact = src.includes('/vendor/') ? code : (await minify(src, code, { compress: false, mangle: false })).code;
        const fileName = `assets/${path.basename(src, '.js')}-${empreinte(compact)}.js`;
        this.emitFile({ type: 'asset', fileName, source: compact });
        noms.set(src, fileName);
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(SCRIPT_CLASSIQUE, (tag, src) => `<script src="${noms.get(src)}" vite-ignore></script>`),
    },
  };
}

// Les commentaires d'index.html (plus de la moitié de son poids) restent dans le
// dépôt, pas en ligne.
function sansCommentairesHtml(){
  return {
    name: 'kinet-sans-commentaires',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<!--[\s\S]*?-->\n?/g, '') },
  };
}

// Le CSS garde exactement ses règles : commentaires et espaces en moins, rien
// d'autre. Le compacteur de Vite fusionnait backdrop-filter et
// -webkit-backdrop-filter en ne gardant que le second, que Chrome ignore :
// plus aucun flou derrière les fenêtres (vu en comparant les captures, 05/11).
function cssCompact(){
  return {
    name: 'kinet-css-compact',
    apply: 'build',
    generateBundle(options, bundle){
      Object.values(bundle).filter(f => f.type === 'asset' && f.fileName.endsWith('.css')).forEach(f => {
        f.source = String(f.source).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};])\s*/g, '$1').trim();
      });
    },
  };
}

function copiesEtServiceWorker(){
  return {
    name: 'kinet-copies',
    apply: 'build',
    writeBundle(options, bundle){
      const out = options.dir;
      COPIES.forEach(p => fs.cpSync(p, path.join(out, p), { recursive: true }));
      // Le nom du cache suit le contenu du site : c'est lui qui fait voir la mise
      // à jour aux appareils déjà venus (voir sw.js).
      const contenu = Object.values(bundle).map(f => f.fileName + (f.source || f.code)).sort().join('|') + fs.readFileSync('sw.js', 'utf8');
      const sw = fs.readFileSync('sw.js', 'utf8').replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'critique-films-shell-${empreinte(contenu)}';`);
      fs.writeFileSync(path.join(out, 'sw.js'), sw);
      // GitHub Pages passe sinon le site à Jekyll, qui ignore certains fichiers.
      fs.writeFileSync(path.join(out, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  build: { outDir: 'dist', emptyOutDir: true, cssMinify: false },
  plugins: [scriptsClassiques(), sansCommentairesHtml(), cssCompact(), copiesEtServiceWorker()],
});
