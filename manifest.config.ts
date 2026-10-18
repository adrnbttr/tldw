import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

/**
 * Manifest V3 definition.
 *
 * Permissions are kept as narrow as the spec allows:
 * - `storage`   : API keys, preferences, summary history (F9)
 * - `activeTab` + `scripting` : read the DOM of the current tab on demand (F1)
 * - `downloads` : export the summary as a `.md` file (F8)
 * - `webRequest`: observe media segment URLs for the audio fallback (F5, Phase 3)
 *
 * `host_permissions` is intentionally broad because embedded players can live on
 * any authenticated site the user legitimately visits. All network calls stay in
 * the browser; no data is sent anywhere except the user's own API providers.
 */
/**
 * `match_origin_as_fallback` (Chrome ≥ 99) also injects into frames whose URL
 * has no matchable origin — sandboxed srcdoc, blob:, data: frames — matched by
 * their creator's origin, where `match_about_blank` alone does not reach (opaque
 * origins). Spread in: crxjs's manifest type does not know the key yet.
 */
const ORIGIN_FALLBACK = { match_origin_as_fallback: true } as Record<string, unknown>;

export default defineManifest({
  manifest_version: 3,
  name: 'tldw — Video Summaries',
  short_name: 'tldw',
  description: pkg.description,
  version: pkg.version,
  icons: {
    16: 'public/icons/icon-16.png',
    48: 'public/icons/icon-48.png',
    128: 'public/icons/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'tldw — summarize this video',
    default_icon: {
      16: 'public/icons/icon-16.png',
      48: 'public/icons/icon-48.png',
      128: 'public/icons/icon-128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  // A single entry: crxjs keys content scripts by file, so two entries on the same
  // file overwrite each other's web_accessible_resources (and break the loader on
  // every site but the last entry's). Runs in every frame — including about:blank /
  // srcdoc ones — so videos inside cross-origin player iframes (Drive, Wistia,
  // Loom, Brightcove, LMS embeds…) can be detected and driven. Sub-frames publish
  // their own list (keyed by frame in the worker); see src/content/index.ts.
  content_scripts: [
    {
      ...ORIGIN_FALLBACK,
      matches: ['<all_urls>'],
      // Ad / tracker frames never hold a video worth summarizing, and the script
      // would otherwise run in each of them on every page.
      exclude_matches: [
        '*://*.doubleclick.net/*',
        '*://*.googlesyndication.com/*',
        '*://*.adnxs.com/*',
        '*://*.googleadservices.com/*',
        '*://*.amazon-adsystem.com/*',
        '*://*.taboola.com/*',
        '*://*.outbrain.com/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: true,
      match_about_blank: true,
    },
  ],
  permissions: ['storage', 'activeTab', 'scripting', 'downloads', 'webRequest', 'offscreen'],
  host_permissions: ['<all_urls>'],
  // ffmpeg.wasm needs wasm-unsafe-eval; the single-threaded core avoids COOP/COEP.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  minimum_chrome_version: '116',
});
