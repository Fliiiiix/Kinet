// Petit serveur statique pour les tests de bout en bout (aucune dépendance) :
// sert la racine du projet sur le port 8765, comme GitHub Pages le ferait.
const http = require('http');
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const chemin = path.join(RACINE, url === '/' ? 'index.html' : url);
  if(!chemin.startsWith(RACINE)){ res.writeHead(403); return res.end(); }
  fs.readFile(chemin, (err, contenu) => {
    if(err){ res.writeHead(404); return res.end('introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream' });
    res.end(contenu);
  });
}).listen(8765, () => console.log('serveur de test sur http://localhost:8765'));
