// --- Harnais minimal pour exécuter les modules js/*.js de Kinet hors
// navigateur (Node pur, aucune dépendance npm — cohérent avec le reste du
// projet, 100% vanilla, sans build). Beaucoup de fichiers js/ font du
// wiring en bas de fichier (document.getElementById('x').addEventListener(
// ...)) exécuté immédiatement au chargement : les stubs ci-dessous
// suffisent pour que ça ne plante pas, sans essayer de simuler un vrai DOM
// (pas de jsdom, pas de dépendance). Un test qui a besoin d'un comportement
// DOM précis (lire un textContent, etc.) enrichit son propre stub avant de
// charger le fichier concerné plutôt que d'alourdir ce module partagé.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function stubElement(overrides = {}){
  const el = {
    addEventListener(){}, removeEventListener(){},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    style: {}, dataset: {},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    appendChild(){}, click(){}, focus(){}, blur(){},
    textContent: '', innerHTML: '', value: '', checked: false,
  };
  return Object.assign(el, overrides);
}

// document.getElementById par défaut : renvoie un stub générique pour
// N'IMPORTE QUEL id demandé (les fichiers js/ interrogent des dizaines
// d'ids au chargement) — un test précis peut passer sa propre `elements`
// map pour des ids qu'il veut vraiment inspecter/piloter.
function stubDocument(elements = {}){
  return {
    getElementById: (id) => elements[id] || stubElement(),
    addEventListener(){}, removeEventListener(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    createElement(){ return stubElement(); },
    body: stubElement(),
  };
}

function fakeLocalStorage(){
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for(const k in store) delete store[k]; },
  };
}

// Charge un ou plusieurs fichiers js/ RELATIFS à la racine du repo, dans
// l'ordre donné, sur le MÊME contexte vm (comme index.html les charge tous
// dans le même scope global) — nécessaire quand un fichier lit une
// fonction/variable définie par un autre (ex. importExternal.js attend
// showToast(), normalizeSearch() de js/app.js).
function loadFiles(context, relPaths){
  for(const relPath of relPaths){
    const code = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
    vm.runInContext(code, context, { filename: relPath });
  }
}

function createContext(overrides = {}){
  const base = {
    console,
    document: stubDocument(),
    localStorage: fakeLocalStorage(),
    window: { addEventListener(){}, removeEventListener(){}, matchMedia: () => ({ matches: false, addEventListener(){} }) },
    location: { hash: '' },
    navigator: { onLine: true },
  };
  const ctx = Object.assign(base, overrides);
  return vm.createContext(ctx);
}

// Assigne l'état interne (`let x = ...` en haut d'un fichier js/) d'un
// contexte APRÈS l'avoir chargé — un `let` de script top-level crée une
// liaison lexicale qui MASQUE une éventuelle propriété du même nom déjà
// posée sur l'objet contexte (donc la passer à createContext() AVANT de
// charger le fichier ne sert à rien, elle est écrasée par le `let x = ...`
// du fichier au chargement). En assignant SANS mot-clé (`x = valeur;`,
// exécuté dans le contexte via cette fonction) plutôt qu'en re-déclarant,
// la résolution de portée retrouve la bonne liaison `let` et la mute pour
// de vrai. `valeur` est passée via une propriété temporaire du contexte
// (jamais masquée puisque jamais déclarée par un `let` du fichier chargé).
function setState(context, values){
  for(const key in values){
    const tempKey = `__set_${key}`;
    context[tempKey] = values[key];
    vm.runInContext(`${key} = ${tempKey};`, context);
    delete context[tempKey];
  }
}

// Lit l'état interne (`let x = ...`) d'un contexte APRÈS chargement — même
// raison que setState() ci-dessus : un `let` de script top-level ne devient
// PAS une propriété de l'objet contexte (contrairement à une fonction
// déclarée avec `function`, elle bien exposée), donc `context.x` depuis le
// realm hôte ne lit rien pour une variable `let`/`const`. On exécute la
// simple expression `x` DANS le contexte pour retrouver la bonne liaison
// lexicale.
function getState(context, key){
  return vm.runInContext(key, context);
}

module.exports = { createContext, loadFiles, setState, getState, stubElement, stubDocument, fakeLocalStorage, REPO_ROOT };
