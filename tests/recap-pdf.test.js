// --- Tests de l'export PDF du bilan cinéphile (js/recap.js) ---
// Retour utilisateur : "Export PDF du bilan cinéphile" — un PDF minimal
// construit à la main (pas de librairie), l'image du canvas réencodée en
// JPEG et embarquée telle quelle (/Filter /DCTDecode). Le risque réel ici
// n'est pas la logique métier mais l'arithmétique des offsets xref (chaque
// entrée doit pointer l'octet EXACT où son objet commence) — un PDF
// "presque bon" avec un offset décalé de 1 octet est un fichier corrompu
// pour la plupart des lecteurs, jamais détecté par une simple lecture du
// code. Vérifié ici en RELISANT les offsets déclarés dans le xref généré
// et en confirmant que chacun pointe bien "N 0 obj" à cet octet précis —
// la même vérification qu'un lecteur PDF ferait lui-même à l'ouverture.
const { createSuite, assert } = require('./helpers/tiny-test');
const { createContext, loadFiles, stubDocument, stubElement } = require('./helpers/vm-harness');
const { test, run } = createSuite();

// Uint8Array -> string "binaire" (1 code point par octet, jamais
// réinterprété en UTF-8) — seule façon fiable de relire du contenu mixte
// texte PDF + octets JPEG bruts avec des regex/indexOf simples.
function bytesToBinaryString(bytes){
  let s = '';
  for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function buildContext(){
  const ctx = createContext({
    document: stubDocument(),
    goHome(){}, closeOverlay(){}, openOverlay(){},
    blockIfOffline(){ return false; },
    showToast(){},
    withSubmitGuard: (btn, handler) => handler,
    // atob/TextEncoder/btoa : globals Node réels, un contexte vm frais ne
    // les a pas par défaut (même pitfall que setTimeout, voir
    // tests/README.md) — passés ici tels quels, aucun besoin de les simuler.
    atob, btoa, TextEncoder,
  });
  loadFiles(ctx, ['js/recap.js']);
  return ctx;
}

// Canvas factice : toDataURL() renvoie un JPEG "bidon" dont on connaît le
// contenu exact (encodé via le VRAI btoa, décodable par le VRAI atob
// utilisé en interne par dataUrlToBytes()) — pas besoin d'un vrai canvas
// pour vérifier que le pipeline base64 -> octets bruts -> PDF est correct.
function fakeCanvas(width, height, fakeJpegContent){
  return {
    width, height,
    toDataURL(type){
      assert.strictEqual(type, 'image/jpeg');
      return 'data:image/jpeg;base64,' + btoa(fakeJpegContent);
    },
  };
}

test('dataUrlToBytes() : décode le base64 en octets bruts, sans passer par la partie "data:...;base64,"', () => {
  const ctx = buildContext();
  const bytes = ctx.dataUrlToBytes('data:image/jpeg;base64,' + btoa('ABC'));
  assert.deepStrictEqual(Array.from(bytes), [65, 66, 67]); // codes ASCII de A, B, C
});

test('buildRecapPdf() : commence par l\'en-tête PDF et finit par %%EOF', () => {
  const ctx = buildContext();
  const bytes = ctx.buildRecapPdf(fakeCanvas(100, 50, 'FAKEJPEGBYTES'));
  const s = bytesToBinaryString(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF'));
});

test('buildRecapPdf() : dimensions de l\'image = largeur/hauteur du canvas, MediaBox assortie', () => {
  const ctx = buildContext();
  const bytes = ctx.buildRecapPdf(fakeCanvas(1080, 1350, 'X'));
  const s = bytesToBinaryString(bytes);
  assert.ok(s.includes('/Width 1080 /Height 1350'));
  assert.ok(s.includes('/MediaBox [0 0 1080 1350]'));
});

test('buildRecapPdf() : les octets JPEG bruts sont embarqués VERBATIM (jamais ré-encodés), /Length exact', () => {
  const ctx = buildContext();
  const fakeJpeg = 'FAKE_JPEG_PAYLOAD_1234567890';
  const bytes = ctx.buildRecapPdf(fakeCanvas(10, 10, fakeJpeg));
  const s = bytesToBinaryString(bytes);
  assert.ok(s.includes(fakeJpeg), 'les octets du "JPEG" doivent apparaître tels quels dans le PDF');
  assert.ok(s.includes(`/Length ${fakeJpeg.length} >>\nstream\n`), 'le /Length déclaré pour l\'image doit correspondre exactement à sa taille réelle');
});

test('buildRecapPdf() : chaque offset du xref pointe EXACTEMENT le début du bon objet ("N 0 obj")', () => {
  const ctx = buildContext();
  const bytes = ctx.buildRecapPdf(fakeCanvas(200, 100, 'UN_AUTRE_FAUX_JPEG_PLUS_LONG_POUR_VARIER_LES_TAILLES'));
  const s = bytesToBinaryString(bytes);

  const xrefIdx = s.lastIndexOf('\nxref\n');
  assert.ok(xrefIdx !== -1, 'la section xref doit être présente');
  const xrefSection = s.slice(xrefIdx + 1);

  const lines = xrefSection.split('\n').filter(Boolean);
  assert.strictEqual(lines[0], 'xref');
  assert.strictEqual(lines[1], '0 6');
  assert.strictEqual(lines[2], '0000000000 65535 f ', 'entrée réservée de l\'objet 0, toujours "libre"');

  // Une entrée par objet réel (1 à 5) : l'offset qu'elle déclare doit
  // pointer, dans le fichier complet, exactement "N 0 obj" (N = le numéro
  // d'objet attendu à cette position, 1-indexé).
  for(let n = 1; n <= 5; n++){
    const entry = lines[2 + n];
    const offset = parseInt(entry.slice(0, 10), 10);
    const atOffset = s.slice(offset, offset + `${n} 0 obj`.length);
    assert.strictEqual(atOffset, `${n} 0 obj`, `l'offset xref de l'objet ${n} doit pointer exactement son "${n} 0 obj"`);
  }

  // startxref doit lui-même pointer exactement le début du mot "xref".
  const startxrefMatch = s.match(/startxref\n(\d+)\n%%EOF$/);
  assert.ok(startxrefMatch, 'startxref doit précéder %%EOF avec un nombre entre les deux');
  const startxrefOffset = parseInt(startxrefMatch[1], 10);
  assert.strictEqual(s.slice(startxrefOffset, startxrefOffset + 4), 'xref');
});

module.exports = run('recap-pdf.test.js');
