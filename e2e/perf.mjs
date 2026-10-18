// Content-script cost on a heavy page. Usage: node e2e/perf.mjs (needs dist/ built)
// Scenarios: (a) div churn, (b) custom-element churn (YouTube/Reddit-like ytd-*/shreddit-* trees).
// Each: 10k DOM nodes, a mutation every 50 ms, 20 ad iframes (10 on excluded ad hosts, 10 not excluded).
// Measures over 10 s: CPU-profile time inside chrome-extension:// stacks (main frame process),
// and ScriptDuration/TaskDuration deltas vs the same page without the extension.
import { startServers, launch, stageExtension, chromiumInstalled } from './lib/harness.mjs';
import { A } from './lib/fixtures.mjs';

const heavy = (custom, withVideo) => `<!doctype html><html><head><title>heavy</title></head><body>
<div id=root></div>
${withVideo ? `<video src="${A}/clip.webm" muted preload=metadata width=640 height=360></video>` : ''}
<div id=ads>${Array.from({ length: 20 }, (_, i) => `<iframe width=300 height=250 src="https://${i < 10 ? 'securepubads.g.doubleclick.net/gampad/ads?i=' : 'cdn.adserver.example/slot?i='}${i}"></iframe>`).join('')}</div>
<script>
const T = ${custom ? "['yt-card','x-row','x-chip']" : "['div','span','p']"};
const root = document.getElementById('root');
const frag = document.createDocumentFragment();
for (let i = 0; i < 3300; i++) { const e = document.createElement(T[i % 3]); e.className = 'n' + i; e.appendChild(document.createElement('b')).textContent = i; frag.appendChild(e); }
root.appendChild(frag); // ~10k nodes (elements + text)
let k = 0;
setInterval(() => {
  // mutation burst: replace one item, toggle an attribute, edit text
  const e = document.createElement(T[k % 3]); e.textContent = 'live ' + k;
  root.insertBefore(e, root.firstChild); root.lastChild.remove();
  root.children[k % 3000].setAttribute('data-k', k);
  root.children[(k * 7) % 3000].firstChild.textContent = k++;
}, 50);
</script></body></html>`;

const pages = {
  '/heavy-div.html': heavy(false, false),
  '/heavy-custom.html': heavy(true, false),
  '/heavy-custom-video.html': heavy(true, true),
};
if (!chromiumInstalled()) {
  console.error('✗ Chromium (Playwright) introuvable — lance « npm run e2e:install ».');
  process.exit(2);
}
const stop = startServers(pages);
const staged = stageExtension();

async function measure(withExtension, path) {
  const { ctx, close } = await launch({ withExtension, ext: staged.dir });
  const page = await ctx.newPage();
  const exceptions = [];
  page.on('pageerror', (e) => exceptions.push('main-world: ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(
      'frame0: ' +
        (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 200),
    ),
  );
  await page.goto(`${A}${path}`);
  await page.waitForTimeout(3000);
  // OOPIF frames (ad iframes): watch their exceptions too.
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const s = await ctx.newCDPSession(f);
      await s.send('Runtime.enable');
      s.on('Runtime.exceptionThrown', (e) =>
        exceptions.push(
          f.url().slice(0, 50) +
            ': ' +
            (e.exceptionDetails.exception?.description || e.exceptionDetails.text).slice(0, 200),
        ),
      );
    } catch {
      /* same-process frame: covered by the page session */
    }
  }
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const m0 = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  );
  await cdp.send('Profiler.start');
  await page.waitForTimeout(10000);
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  );
  // Attribute each sample to the extension when any frame of its stack is chrome-extension://.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const ext = new Map();
  const isExt = (id) => {
    if (ext.has(id)) return ext.get(id);
    const n = byId.get(id);
    const r =
      n.callFrame.url.startsWith('chrome-extension://') ||
      (parent.has(id) && isExt(parent.get(id)));
    ext.set(id, r);
    return r;
  };
  let extUs = 0,
    totalUs = 0;
  const top = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    const n = byId.get(profile.samples[i]);
    if (n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)') continue;
    totalUs += dt;
    if (isExt(n.id)) {
      extUs += dt;
      const key = n.callFrame.functionName || '(anon)';
      top.set(key, (top.get(key) ?? 0) + dt);
    }
  }
  await close();
  return {
    withExtension,
    path,
    windowMs: 10000,
    extMs: +(extUs / 1000).toFixed(1),
    profiledJsMs: +(totalUs / 1000).toFixed(1),
    scriptMs: +((m1.ScriptDuration - m0.ScriptDuration) * 1000).toFixed(1),
    taskMs: +((m1.TaskDuration - m0.TaskDuration) * 1000).toFixed(1),
    topExtLeaves: [...top.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}:${(v / 1000).toFixed(1)}ms`),
    exceptions,
  };
}

for (const p of Object.keys(pages)) {
  for (const withExt of [false, true]) console.log(JSON.stringify(await measure(withExt, p)));
}
stop();
staged.cleanup();
