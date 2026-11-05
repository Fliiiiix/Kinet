// --- Mise en ligne : construit le site et le publie sur la branche gh-pages ---
// Depuis le 05/11, GitHub Pages sert la branche gh-pages, qui ne contient que
// dist/ (le site construit par Vite, voir vite.config.mjs). Pousser main ne met
// donc plus rien en ligne : c'est ce script qui le fait, à partir du dernier
// commit de main. Lancer : npm run deploy
// Retour en arrière en cas de souci : refaire npm run deploy depuis un commit
// sain, ou remettre GitHub Pages sur main (Settings > Pages) le temps de réparer.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const git = (args, cwd = RACINE) => execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function deployer(){
  // Ce qui part en ligne doit correspondre à un commit, pour savoir ce qui y est.
  if(git('status --porcelain --untracked-files=no')) throw new Error('Des changements ne sont pas commités : commite d\'abord.');
  const commit = git('rev-parse --short HEAD');
  execSync('npx vite build', { cwd: RACINE, stdio: 'inherit' });

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'kinet-gh-pages-'));
  try{
    if(git('ls-remote --heads origin gh-pages')){
      git('fetch -q origin gh-pages');
      git(`worktree add -q -B gh-pages "${dossier}" origin/gh-pages`);
    }else{
      git(`worktree add -q --detach "${dossier}"`);
      git('checkout -q --orphan gh-pages', dossier);
    }
    // On repart de zéro : seul le site construit est en ligne.
    fs.readdirSync(dossier).filter(f => f !== '.git').forEach(f => fs.rmSync(path.join(dossier, f), { recursive: true, force: true }));
    fs.cpSync(path.join(RACINE, 'dist'), dossier, { recursive: true });
    git('add -A', dossier);
    if(!git('status --porcelain', dossier)){
      console.log('Rien de neuf à mettre en ligne.');
      return;
    }
    git(`commit -q -m "Mise en ligne de ${commit}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`, dossier);
    git('push -q origin gh-pages', dossier);
    console.log(`En ligne : ${commit}, visible d'ici une minute sur https://fliiiiix.github.io/Kinet/`);
  }finally{
    git(`worktree remove --force "${dossier}"`);
  }
}

deployer();
