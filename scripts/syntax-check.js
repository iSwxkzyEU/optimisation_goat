/* ============================================================
   Contrôle de syntaxe des fichiers JS, sans Node.

   JScript est en ES3 : il refuse deux choses que le code moderne
   autorise, et qui ne sont PAS des erreurs. On les neutralise avant
   de parser, sinon on obtient des faux positifs :
     - les virgules finales   ({ a: 1, })
     - les mots réservés utilisés comme propriétés (.catch, .delete…)

   new Function(src) PARSE sans EXÉCUTER : c'est exactement ce qu'on
   veut pour du code navigateur (document, window… n'existent pas ici).

   Usage : cscript //nologo scripts\syntax-check.js
   ============================================================ */

function readUtf8(path) {
  var st = new ActiveXObject("ADODB.Stream");
  st.Type = 2; st.Charset = "utf-8"; st.Open();
  st.LoadFromFile(path);
  var t = st.ReadText(-1); st.Close();
  return t;
}

var fso = new ActiveXObject("Scripting.FileSystemObject");
var BASE = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

// Sans argument : les fichiers du site. Avec : les chemins donnés.
var FILES = ["js\\parser.js", "js\\optimizer.js", "js\\variants.js",
             "js\\store.js", "js\\app.js"];
if (WScript.Arguments.length) {
  FILES = [];
  for (var a = 0; a < WScript.Arguments.length; a++) FILES.push(WScript.Arguments(a));
  BASE = "";
}

var RESERVED = ["catch", "delete", "for", "in", "new", "class", "default", "this"];

function neutralize(src) {
  // Virgules finales — y compris quand un commentaire les sépare de
  // l'accolade fermante ("open: null,   // note\n};"), cas très courant
  // et qui faisait passer du code valide pour une erreur.
  src = src.replace(/,(\s*(?:\/\/[^\n]*\n\s*)*[}\]])/g, "$1");
  for (var i = 0; i < RESERVED.length; i++) {          // .catch( -> .zcatch(
    src = src.replace(new RegExp("\\.(" + RESERVED[i] + ")\\s*\\(", "g"), ".z$1(");
  }
  return src;
}

var bad = 0;
for (var f = 0; f < FILES.length; f++) {
  var path = BASE ? BASE + "\\" + FILES[f] : FILES[f];
  if (!fso.FileExists(path)) { WScript.Echo("  ABSENT  " + FILES[f]); bad++; continue; }
  var src = neutralize(readUtf8(path));
  try {
    new Function(src);
    WScript.Echo("  OK      " + FILES[f]);
  } catch (e) {
    WScript.Echo("  ERREUR  " + FILES[f] + "  ->  " + e.message);
    bad++;
  }
}

WScript.Echo("");
WScript.Echo(bad ? bad + " fichier(s) en erreur." : "Tous les fichiers parsent.");
WScript.Quit(bad ? 1 : 0);
