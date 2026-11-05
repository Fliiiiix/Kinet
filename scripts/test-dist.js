// --- Tous les tests de bout en bout, sur le site construit (dist/) ---
// Ce que GitHub Pages sert est dist/, pas les sources : c'est donc lui qu'on
// vérifie avant chaque mise en ligne. Lancer : npm run test:dist
const { spawnSync } = require('child_process');

const res = spawnSync('npx', ['playwright', 'test', '--workers=4', '--reporter=line', ...process.argv.slice(2)], {
  stdio: 'inherit', shell: true, env: Object.assign({}, process.env, { KINET_DIST: '1' }),
});
process.exit(res.status === null ? 1 : res.status);
