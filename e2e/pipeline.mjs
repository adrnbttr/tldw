// Audio-pipeline e2e for tldw: runs the BUILT extension (dist/) in headless
// Chromium through the whole audio fallback — SUMMARIZE on a native <video>
// without captions → service worker → offscreen document → download →
// ffmpeg.wasm → OpenRouter (or Whisper) transcription → summary → history.
//
//   node e2e/pipeline.mjs [--build] [--only=ok,cancel,badkey,whisper] [--dist=DIR]
//
// No real key, no network: openrouter.ai and api.openai.com are mapped to a
// local HTTPS stub (`--host-resolver-rules`) whose certificate is the test-only,
// self-signed pair in e2e/fixtures/stub-cert/ (accepted through
// `--ignore-certificate-errors`; it secures nothing). Playwright's
// context.route is not used for the APIs: the calls come from the service
// worker and the offscreen document, which a host-level remap covers whatever
// the target type.
//
// The media is a 30 s mono WAV tone generated here at startup (nothing large
// committed), served with Range support to a plain <video src>.
//
// Scenarios:
//   ok      — job done, summary in history, ≥1 audio chunk + 1 summary request,
//             progress monotonic up to 100, no offscreen "refused" log, offscreen closed;
//   cancel  — cancel while a chunk is in flight → error CANCELLED, offscreen closed,
//             no stub request after the cancel (+1 s);
//   badkey  — OpenRouter answers 401 → error INVALID_API_KEY;
//   whisper — provider openai, Whisper answers 401 → error INVALID_TRANSCRIPTION_KEY.
// Exit code: 1 on any failure, 2 if Chromium is missing, 0 otherwise.
import { execSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REPO, launch, stageExtension, chromiumInstalled } from './lib/harness.mjs';

const argv = process.argv.slice(2);
const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

if (!chromiumInstalled()) {
  console.error(
    '✗ Chromium (Playwright) introuvable — lance « npm run e2e:install » (ou définis CHROME=/chemin/vers/chrome).',
  );
  process.exit(2);
}
if (argv.includes('--build')) execSync('npm run build', { cwd: REPO, stdio: 'inherit' });

const MEDIA_PORT = Number(process.env.TLDW_E2E_PIPELINE_PORT) || 8941;
const ORIGIN = `http://127.0.0.1:${MEDIA_PORT}`;
const JOB_TIMEOUT_MS = 120_000;
const TONE_SECONDS = 30;
const TRANSCRIPT = 'bonjour ceci est un test';
const SUMMARY = {
  tldr: 'Résumé de test du pipeline audio.',
  keyPoints: ['Le pipeline audio fonctionne de bout en bout.'],
  sections: [{ heading: 'Test', body: 'Une tonalité de trente secondes a été transcrite.' }],
  glossary: [{ term: 'e2e', definition: 'Test de bout en bout.' }],
  takeaways: ['Tout passe par le stub local.'],
};

// ---------------------------------------------------------------------------
// Media: deterministic 30 s mono 16-bit PCM WAV (16 kHz), a slowly warbling tone.
// ---------------------------------------------------------------------------
function toneWav(seconds = TONE_SECONDS, rate = 16000) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const f = 440 + 110 * Math.sin((2 * Math.PI * i) / (rate * 2));
    phase += (2 * Math.PI * f) / rate;
    buf.writeInt16LE(Math.round(Math.sin(phase) * 8000), 44 + i * 2);
  }
  return buf;
}
const WAV = toneWav();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Pipeline e2e tone</title></head>
<body><h1>tone</h1><video id="v" src="/tone.wav" width="640" height="360" preload="auto" controls></video></body></html>`;

function startMediaServer() {
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/tone.wav') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(q.headers.range ?? '');
      const headers = {
        'content-type': 'audio/wav',
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
      };
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), WAV.length - 1) : WAV.length - 1;
        r.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${WAV.length}`,
          'content-length': end - start + 1,
        });
        return r.end(WAV.subarray(start, end + 1));
      }
      r.writeHead(200, { ...headers, 'content-length': WAV.length });
      return r.end(WAV);
    }
    if (u.pathname === '/tone.html') {
      r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return r.end(PAGE);
    }
    r.writeHead(404);
    r.end('nope');
  });
  return new Promise((resolve) => server.listen(MEDIA_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// API stub (HTTPS, self-signed test cert) for openrouter.ai and api.openai.com.
// ---------------------------------------------------------------------------
const CERT_DIR = path.join(ROOT, 'fixtures', 'stub-cert');

function startStub() {
  const stub = {
    /** Every request received: { t, host, path, kind, model, responseFormat, audioBytes, status }. */
    requests: [],
    /** 'ok' | 'unauthorized' — answer to transcription requests. */
    transcription: 'ok',
    /** Delay before answering a transcription request (ms). */
    transcriptionDelayMs: 0,
    /** Resolves once the next transcription request arrives. */
    waiters: [],
    port: 0,
    server: null,
  };
  const reply = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };
  stub.server = https.createServer(
    {
      key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')),
      cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
    },
    (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        });
        return res.end();
      }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const raw = Buffer.concat(chunks);
        const host = (req.headers.host ?? '').split(':')[0];
        const entry = {
          t: Date.now(),
          host,
          path: req.url,
          kind: 'other',
          model: null,
          responseFormat: null,
          audioBytes: 0,
          status: 0,
        };
        stub.requests.push(entry);
        const send = (status, body) => {
          entry.status = status;
          reply(res, status, body);
        };

        if (host === 'api.openai.com' && req.url.startsWith('/v1/audio/transcriptions')) {
          entry.kind = 'whisper';
          entry.audioBytes = raw.length; // multipart body, audio included
          for (const w of stub.waiters.splice(0)) w(entry);
          if (stub.transcription === 'unauthorized')
            return send(401, { error: { message: 'Incorrect API key provided' } });
          return send(200, {
            language: 'french',
            duration: TONE_SECONDS,
            text: TRANSCRIPT,
            segments: [{ start: 0, end: TONE_SECONDS, text: TRANSCRIPT }],
          });
        }
        if (host !== 'openrouter.ai' || !req.url.startsWith('/api/v1/chat/completions'))
          return send(404, { error: { message: 'stub: unknown route' } });

        let body;
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          return send(400, { error: { message: 'stub: bad json' } });
        }
        entry.model = body.model ?? null;
        entry.responseFormat = body.response_format?.type ?? null;
        const audio = (body.messages ?? [])
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .find((c) => c?.type === 'input_audio');
        if (audio) {
          entry.kind = 'transcription';
          entry.audioBytes = Buffer.from(audio.input_audio?.data ?? '', 'base64').length;
          for (const w of stub.waiters.splice(0)) w(entry);
          if (stub.transcriptionDelayMs)
            await new Promise((r) => setTimeout(r, stub.transcriptionDelayMs));
          if (res.destroyed || req.destroyed) {
            entry.status = 'aborted'; // the client went away meanwhile (cancel)
            return;
          }
          if (stub.transcription === 'unauthorized')
            return send(401, { error: { message: 'No auth credentials found', code: 401 } });
          return send(200, {
            choices: [{ message: { content: TRANSCRIPT }, finish_reason: 'stop' }],
          });
        }
        if (body.response_format) {
          entry.kind = 'summary';
          return send(200, {
            choices: [{ message: { content: JSON.stringify(SUMMARY) }, finish_reason: 'stop' }],
          });
        }
        entry.kind = 'chat';
        return send(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
      });
    },
  );
  stub.nextTranscription = () => new Promise((resolve) => stub.waiters.push(resolve));
  return new Promise((resolve) =>
    stub.server.listen(0, '127.0.0.1', () => {
      stub.port = stub.server.address().port;
      resolve(stub);
    }),
  );
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
async function openBrowser(ext, stub) {
  const b = await launch({
    ext,
    stub: false,
    extraArgs: [
      `--host-resolver-rules=MAP openrouter.ai 127.0.0.1:${stub.port}, MAP api.openai.com 127.0.0.1:${stub.port}`,
      '--ignore-certificate-errors',
    ],
  });
  const id = new URL(b.sw.url()).host;
  const swLogs = [];
  b.sw.on('console', (m) => swLogs.push(m.text()));
  const helper = await b.ctx.newPage();
  await helper.goto(`chrome-extension://${id}/src/popup/index.html`);
  // Every JOB_STATE broadcast the popup would receive, in order.
  await helper.evaluate(() => {
    window.__states = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'JOB_STATE') window.__states.push(m.state);
    });
  });
  return { ...b, id, helper, swLogs };
}

/** Writes settings like the popup's saveSettings (getSettings merges the defaults). */
async function configure(helper, patch) {
  await helper.evaluate(async (p) => {
    const cur = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...cur, ...p } });
  }, patch);
}

const send = (helper, msg) => helper.evaluate((m) => chrome.runtime.sendMessage(m), msg);

/** Opens the tone page and returns the detected native video, as the popup lists it. */
async function detectTone(b) {
  const page = await b.ctx.newPage();
  await page.goto(`${ORIGIN}/tone.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('v').readyState >= 1, null, {
    timeout: 15000,
  });
  const deadline = Date.now() + 15000;
  for (;;) {
    await page.bringToFront();
    const res = await send(b.helper, { type: 'LIST_VIDEOS' });
    const video = (res?.videos ?? []).find(
      (v) => v.provider === 'native' && (v.mediaSrc ?? '').endsWith('/tone.wav'),
    );
    if (video && video.duration) return { page, video };
    if (Date.now() > deadline)
      throw new Error(`tone video not detected: ${JSON.stringify(res?.videos ?? [])}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function jobOf(jobs, videoId) {
  return (jobs ?? []).map((j) => j.state).find((s) => s && s.videoId === videoId);
}

/** Polls GET_JOBS until the job settles; collects the percents seen. */
async function waitJob(b, videoId, { until = (s) => s.phase !== 'running' } = {}) {
  const t0 = Date.now();
  const percents = [];
  let last;
  for (;;) {
    const res = await send(b.helper, { type: 'GET_JOBS' });
    last = jobOf(res?.jobs, videoId);
    if (last?.phase === 'running' && last.progress) percents.push(last.progress.percent);
    if (last && until(last)) return { state: last, percents, ms: Date.now() - t0 };
    if (Date.now() - t0 > JOB_TIMEOUT_MS)
      throw new Error(`job not settled after ${JOB_TIMEOUT_MS / 1000}s: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function offscreenContexts(b) {
  return b.sw.evaluate(async () =>
    (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).map(
      (c) => c.documentUrl,
    ),
  );
}

/** Offscreen document gone (polled briefly: closing is async). */
async function waitOffscreenClosed(b, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const open = await offscreenContexts(b);
    if (open.length === 0) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function storedLogs(helper) {
  return helper.evaluate(
    async () => (await chrome.storage.local.get('tldw.logs'))['tldw.logs'] ?? [],
  );
}

function summarizeRequests(reqs, since = 0) {
  return reqs
    .filter((r) => r.t >= since)
    .map(
      (r) =>
        `${r.kind}(${r.host}${r.model ? ` ${r.model}` : ''}${r.responseFormat ? ` rf=${r.responseFormat}` : ''}${r.audioBytes ? ` audio=${r.audioBytes}B` : ''} → ${r.status || 'pending'})`,
    )
    .join(', ');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const BASE_SETTINGS = {
  onboarded: true,
  openRouterKey: 'sk-or-test',
  outputLanguage: 'fr',
  uiLanguage: 'fr',
  transcriptionProvider: 'openrouter',
};

const SCENARIOS = {
  async ok(b, stub, check) {
    await configure(b.helper, BASE_SETTINGS);
    const { video } = await detectTone(b);
    await b.helper.bringToFront();
    const t0 = Date.now();
    const accepted = await send(b.helper, { type: 'SUMMARIZE', video });
    check(accepted?.ok === true, `SUMMARIZE accepted (${JSON.stringify(accepted)?.slice(0, 80)})`);
    const { state, percents, ms } = await waitJob(b, video.id);
    check(
      state.phase === 'done',
      `job done in ${(ms / 1000).toFixed(1)} s (got ${state.phase}${state.code ? ` ${state.code}: ${state.message} ${state.detail ?? ''}` : ''})`,
    );
    const broadcast = await b.helper.evaluate(() =>
      window.__states
        .filter((s) => s.phase === 'running' && s.progress)
        .map((s) => s.progress.percent),
    );
    const mono = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
    const lastBroadcast = await b.helper.evaluate(() => window.__states.at(-1));
    check(
      mono(broadcast) &&
        mono(percents) &&
        [...broadcast, ...percents].every((p) => p >= 0 && p <= 100),
      `progress monotonic within 0-100 (broadcast: ${broadcast.join('→')}; polled: ${[...new Set(percents)].join('→')})`,
    );
    // The orchestrator replaces the last running state (capped below 100) by
    // the terminal done state, which the popup renders as complete.
    check(
      lastBroadcast?.phase === 'done',
      `last broadcast is the terminal done state (${lastBroadcast?.phase})`,
    );
    const history = await b.helper.evaluate(
      async () => (await chrome.storage.local.get('history')).history ?? [],
    );
    const hit = JSON.stringify(history).includes(SUMMARY.tldr);
    check(
      hit,
      `history holds the summary (${history.length} entr${history.length > 1 ? 'ies' : 'y'})`,
    );
    const tr = stub.requests.filter((r) => r.kind === 'transcription');
    const sm = stub.requests.filter((r) => r.kind === 'summary');
    check(
      tr.length >= 1 && tr.every((r) => r.audioBytes > 0),
      `stub got ${tr.length} audio chunk(s), ${tr.map((r) => r.audioBytes).join('/')} bytes`,
    );
    check(sm.length === 1, `stub got ${sm.length} summary request (rf=${sm[0]?.responseFormat})`);
    await new Promise((r) => setTimeout(r, 600)); // let debounced logs land
    const logs = await storedLogs(b.helper);
    const refused = logs.filter((l) => /refused/i.test(l.msg));
    check(refused.length === 0, `no "refused" log line (${refused.map((l) => l.msg).join('; ')})`);
    check(await waitOffscreenClosed(b), 'offscreen document closed');
    return `total ${((Date.now() - t0) / 1000).toFixed(1)} s; stub: ${summarizeRequests(stub.requests)}`;
  },

  async cancel(b, stub, check) {
    await configure(b.helper, BASE_SETTINGS);
    stub.transcriptionDelayMs = 8000;
    const { video } = await detectTone(b);
    await b.helper.bringToFront();
    const inFlight = stub.nextTranscription();
    await send(b.helper, { type: 'SUMMARIZE', video });
    const first = await Promise.race([
      inFlight,
      new Promise((r) => setTimeout(() => r(null), JOB_TIMEOUT_MS)),
    ]);
    check(first != null, 'a transcription chunk reached the stub before the cancel');
    const open = await offscreenContexts(b);
    check(open.length === 1, `offscreen document open mid-job (${open.length})`);
    const cancelAt = Date.now();
    const count = stub.requests.length;
    await send(b.helper, { type: 'CANCEL', videoId: video.id });
    const { state } = await waitJob(b, video.id, { until: (s) => s.phase !== 'running' }).catch(
      () => ({ state: null }),
    );
    // cancelJob settles the job to the neutral error CANCELLED.
    const res = await send(b.helper, { type: 'GET_JOBS' });
    const after = jobOf(res?.jobs, video.id);
    check(
      after?.phase === 'error' && after.code === 'CANCELLED',
      `job cancelled (GET_JOBS: ${after ? after.phase + (after.code ? ' ' + after.code : '') : 'gone'}${state ? `, settled as ${state.phase}` : ''})`,
    );
    check(await waitOffscreenClosed(b), 'offscreen document closed after cancel');
    await new Promise((r) => setTimeout(r, 1000 + stub.transcriptionDelayMs));
    const late = stub.requests.slice(count);
    check(
      late.length === 0,
      `no stub request after the cancel (+${((Date.now() - cancelAt) / 1000).toFixed(1)} s): ${summarizeRequests(late) || 'none'}`,
    );
    check(!stub.requests.some((r) => r.kind === 'summary'), 'no summary request was made');
    return `stub: ${summarizeRequests(stub.requests)}`;
  },

  async badkey(b, stub, check) {
    await configure(b.helper, { ...BASE_SETTINGS, openRouterKey: 'sk-or-wrong' });
    stub.transcription = 'unauthorized';
    const { video } = await detectTone(b);
    await b.helper.bringToFront();
    await send(b.helper, { type: 'SUMMARIZE', video });
    const { state, ms } = await waitJob(b, video.id);
    check(
      state.phase === 'error' && state.code === 'INVALID_API_KEY',
      `error INVALID_API_KEY in ${(ms / 1000).toFixed(1)} s (got ${state.phase} ${state.code ?? ''}: ${state.message ?? ''})`,
    );
    check(!!state.message, `error message for the user: "${state.message}"`);
    const tr = stub.requests.filter((r) => r.kind === 'transcription');
    check(tr.length === 1, `401 not retried (${tr.length} transcription request)`);
    check(!stub.requests.some((r) => r.kind === 'summary'), 'no summary request');
    check(await waitOffscreenClosed(b), 'offscreen document closed');
    return `stub: ${summarizeRequests(stub.requests)}`;
  },

  async whisper(b, stub, check) {
    await configure(b.helper, {
      ...BASE_SETTINGS,
      transcriptionProvider: 'openai',
      transcriptionKey: 'sk-openai-wrong',
    });
    stub.transcription = 'unauthorized';
    const { video } = await detectTone(b);
    await b.helper.bringToFront();
    await send(b.helper, { type: 'SUMMARIZE', video });
    const { state, ms } = await waitJob(b, video.id);
    check(
      state.phase === 'error' && state.code === 'INVALID_TRANSCRIPTION_KEY',
      `error INVALID_TRANSCRIPTION_KEY in ${(ms / 1000).toFixed(1)} s (got ${state.phase} ${state.code ?? ''}: ${state.message ?? ''})`,
    );
    const wh = stub.requests.filter((r) => r.kind === 'whisper');
    check(wh.length === 1 && wh[0].audioBytes > 0, `Whisper stub hit once (${wh.length})`);
    check(await waitOffscreenClosed(b), 'offscreen document closed');
    return `stub: ${summarizeRequests(stub.requests)}`;
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const only = arg('only')?.split(',');
const names = Object.keys(SCENARIOS).filter((n) => !only || only.includes(n));
if (names.length === 0) {
  console.error(`✗ aucun scénario ne correspond à --only=${only?.join(',')}`);
  process.exit(1);
}

const media = await startMediaServer();
const staged = stageExtension(arg('dist'));
const t0 = Date.now();
let failed = 0;
try {
  for (const name of names) {
    const stub = await startStub();
    const b = await openBrowser(staged.dir, stub);
    const lines = [];
    let ok = true;
    const check = (cond, label) => {
      lines.push(`   ${cond ? '✓' : '✗'} ${label}`);
      if (!cond) ok = false;
    };
    const ts = Date.now();
    let note = '';
    try {
      note = await SCENARIOS[name](b, stub, check);
    } catch (e) {
      ok = false;
      lines.push(`   ✗ ${e.message}`);
    }
    if (!ok) {
      const logs = await storedLogs(b.helper).catch(() => []);
      lines.push('   logs:');
      for (const l of logs.slice(-25))
        lines.push(
          `     [${l.source}/${l.level}] ${l.msg} ${l.data ? JSON.stringify(l.data).slice(0, 200) : ''}`,
        );
      if (b.swLogs.length) lines.push(`   sw console: ${b.swLogs.slice(-10).join(' | ')}`);
    }
    console.log(`${ok ? '✓' : '✗'} ${name} (${((Date.now() - ts) / 1000).toFixed(1)} s)`);
    for (const l of lines) console.log(l);
    if (note) console.log(`   ${note}`);
    if (!ok) failed++;
    await b.close();
    stub.server.close();
  }
} finally {
  media.close();
  staged.cleanup();
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failed) {
  console.error(`✗ e2e pipeline: ${failed}/${names.length} scénario(s) en échec.`);
  process.exit(1);
}
console.log(`✓ e2e pipeline: ${names.length} scénarios OK.`);
