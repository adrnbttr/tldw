// Builds the extension and packages it for a non-technical user to install by
// hand (Load unpacked). Produces tldw-share-vX.Y.Z.zip containing a clearly named
// `tldw-extension/` folder plus a plain-language INSTALL.txt. Email it as-is.
//
// (For a Chrome Web Store upload, use `npm run package` instead — that zips the
// dist/ contents at the archive root, with no wrapper folder or extra files.)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipName = `tldw-share-v${version}.zip`;
const stage = join(root, '.tmp', 'share');

// Bundled notice — the recipient reads this after unzipping (French: written for
// a non-technical colleague). Mirrors docs/INSTALL.md.
const INSTALL_TXT = `Installer tldw (aucun compte, aucune compilation)
================================================

Ce qu'il te faut
----------------
- Un navigateur Chromium : Chrome, Edge, Opera, Brave ou Arc.
- Ce dossier "tldw-extension" (déjà dézippé à côté de ce fichier).
- Une clé API OpenRouter gratuite (c'est elle qui génère les résumés) :
  crée un compte sur https://openrouter.ai/keys et copie ta clé.

Étapes
------
1. Dézippe l'archive si ce n'est pas déjà fait. Tu obtiens un dossier
   "tldw-extension". Garde-le à un endroit stable : si tu le déplaces ou le
   supprimes plus tard, le navigateur retire l'extension.

2. Ouvre la page des extensions de ton navigateur :
   - Chrome : chrome://extensions
   - Edge   : edge://extensions
   - Opera  : opera://extensions

3. Active le "Mode développeur" (interrupteur en haut à droite sur Chrome/Edge,
   dans la barre latérale sur Opera).

4. Clique sur "Charger l'extension non empaquetée" et sélectionne le dossier
   "tldw-extension".

5. Ouvre l'icône tldw. Un petit assistant se lance au premier lancement :
   choisis tes langues et le thème, puis colle ta clé OpenRouter et termine.

C'est prêt : ouvre une page avec une vidéo et clique l'icône tldw.

Bon à savoir
------------
- Ta clé reste sur ta machine (stockage local du navigateur). Elle n'est jamais
  incluse dans l'archive et n'est envoyée qu'à OpenRouter.
- Mise à jour : remplace le dossier "tldw-extension" par la nouvelle version,
  puis clique sur "↻ recharger" sur la carte tldw dans la page des extensions.

En cas de souci
---------------
- "Aucune vidéo trouvée" : lance la lecture puis rouvre le popup, ou clique le
  bouton ⟳ (rescan). La détection se fait sur la page active.
- "Clé OpenRouter manquante" : ouvre ⚙️ Paramètres et colle ta clé.
- L'extension a disparu : le dossier a été déplacé ou supprimé — refais
  "Charger l'extension non empaquetée" depuis son nouvel emplacement.
`;

console.log('› Building…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

console.log('› Staging…');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'tldw-extension'), { recursive: true });
cpSync(join(root, 'dist'), join(stage, 'tldw-extension'), { recursive: true });
writeFileSync(join(stage, 'INSTALL.txt'), INSTALL_TXT);

rmSync(join(root, zipName), { force: true });
console.log(`› Packaging → ${zipName}`);
execSync(
  `cd "${stage}" && zip -r -q "${join(root, zipName)}" tldw-extension INSTALL.txt -x '*.map'`,
  {
    stdio: 'inherit',
    shell: '/bin/bash',
  },
);
rmSync(stage, { recursive: true, force: true });

console.log(`✓ ${zipName} ready — email it to your colleague. See docs/INSTALL.md.`);
