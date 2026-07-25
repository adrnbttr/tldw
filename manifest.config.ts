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
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'activeTab', 'scripting', 'downloads', 'webRequest'],
  host_permissions: ['<all_urls>'],
  minimum_chrome_version: '110',
});
