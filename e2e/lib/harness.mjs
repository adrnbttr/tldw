import { chromium } from 'playwright';
import os from 'node:os';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, SUBPAGES, STUB_HOSTS, stubFor, PORT_A, PORT_B } from './fixtures.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(ROOT, '..');
export const CLIP_FILE = path.join(ROOT, 'fixtures', 'clip.webm');

/** Full Chromium (not the headless shell: extensions need it). `CHROME` overrides. */
export function chromePath() {
  return process.env.CHROME || chromium.executablePath();
}
export function chromiumInstalled() {
  try {
    return fs.existsSync(chromePath());
  } catch {
    return false;
  }
}

/**
 * Copies the built extension to a throw-away dir so the run never touches (or is
 * disturbed by) `dist/`. Returns { dir, cleanup }.
 */
export function stageExtension(src = path.join(REPO, 'dist')) {
  if (!fs.existsSync(path.join(src, 'manifest.json'))) {
    throw new Error(`${src}/manifest.json not found — run \`npm run build\` first.`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tldw-e2e-ext-'));
  fs.cpSync(src, dir, { recursive: true });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function startServers(extraPages = {}) {
  const clip = fs.readFileSync(CLIP_FILE);
  const handler = (q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/clip.webm') {
      r.writeHead(200, {
        'content-type': 'video/webm',
        'content-length': clip.length,
        'access-control-allow-origin': '*',
      });
      return r.end(clip);
    }
    const fx =
      u.pathname.startsWith('/f/') && FIXTURES.find((f) => `/f/${f.id}.html` === u.pathname);
    const html = fx?.html ?? SUBPAGES[u.pathname] ?? extraPages[u.pathname];
    // SPA routes (/second, /route-2) fall back to the referer-less 404 page — only reached on reload.
    if (!html) {
      r.writeHead(404);
      return r.end('nope');
    }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end(html);
  };
  const a = http.createServer(handler).listen(PORT_A, '127.0.0.1');
  const b = http.createServer(handler).listen(PORT_B, 'localhost');
  return () => {
    a.close();
    b.close();
  };
}

export async function launch({ ext, stub = true, extraArgs = [], withExtension = true } = {}) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tldw-e2e-prof-'));
  const args = ['--headless=new', '--autoplay-policy=no-user-gesture-required', ...extraArgs];
  if (withExtension) args.push(`--disable-extensions-except=${ext}`, `--load-extension=${ext}`);
  const ctx = await chromium.launchPersistentContext(prof, {
    executablePath: chromePath(),
    headless: true,
    args,
    viewport: { width: 1280, height: 900 },
  });
  if (stub) {
    await ctx.route(STUB_HOSTS, async (route) => {
      if (route.request().url().endsWith('/clip.webm'))
        return route.fulfill({
          status: 200,
          contentType: 'video/webm',
          body: fs.readFileSync(CLIP_FILE),
          headers: { 'access-control-allow-origin': '*' },
        });
      const html = stubFor(route.request().url());
      if (html == null) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });
  }
  let sw = null;
  if (withExtension)
    sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  return {
    ctx,
    sw,
    close: async () => {
      await ctx.close();
      fs.rmSync(prof, { recursive: true, force: true });
    },
  };
}

/** Asks the extension itself (RESCAN, as the popup's refresh button does) — no logic duplicated here. */
export async function rescan(helper) {
  const res = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'RESCAN' }));
  return res?.videos ?? [];
}

/** Opens an extension page used to send LIST_VIDEOS exactly like the popup does. */
export async function popupProbe(ctx, sw) {
  const id = new URL(sw.url()).host;
  const helper = await ctx.newPage();
  await helper.goto(`chrome-extension://${id}/src/popup/index.html`);
  const list = async (page) => {
    await page.bringToFront();
    const res = await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'LIST_VIDEOS' }));
    return res?.videos ?? [];
  };
  const rescanActive = async (page) => {
    await page.bringToFront();
    return rescan(helper);
  };
  return { list, rescan: rescanActive };
}
