// Decides what the release gate does with the detection e2e suite.
// Pure so it can be unit-tested without a browser.

/**
 * @param {{ skip: boolean, chromiumInstalled: boolean }} input
 * @returns {{ action: 'run' | 'skip' | 'fail', message?: string }}
 */
export function planE2e({ skip, chromiumInstalled }) {
  if (skip) {
    return {
      action: 'skip',
      message:
        'E2E DE DÉTECTION IGNORÉS (--skip-e2e) — la release n’est PAS protégée contre une détection cassée. ' +
        'Lance « npm run test:e2e » sur une machine avec Chromium avant de publier.',
    };
  }
  if (!chromiumInstalled) {
    return {
      action: 'fail',
      message:
        'Chromium (Playwright) introuvable pour les e2e de détection — lance « npm run e2e:install », ' +
        'ou relance avec --skip-e2e (déconseillé : release non protégée).',
    };
  }
  return { action: 'run' };
}
