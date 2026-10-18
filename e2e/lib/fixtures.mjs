// Detection corpus. Top pages are served from origin A; "B:" pages from origin B (cross-site).
// Third-party embed hosts are stubbed by Playwright routing (see stubFor) — no network needed.
export const PORT_A = Number(process.env.TLDW_E2E_PORT_A) || 8931;
export const PORT_B = Number(process.env.TLDW_E2E_PORT_B) || 8932;
export const A = `http://127.0.0.1:${PORT_A}`;
export const B = `http://localhost:${PORT_B}`;
const CLIP = `${A}/clip.webm`;
export const CDN_CLIP = 'https://media.stubcdn.example/clip.webm';
const V = (attrs = '', clip = CLIP) =>
  `<video src="${clip}" muted preload="metadata" width="640" height="360" ${attrs}></video>`;
const page = (body, title = 'Fixture') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const ifr = (src, extra = '') => `<iframe src="${src}" width="640" height="360" ${extra}></iframe>`;

// MSE attach: video.src = blob:… fed by a MediaSource (HLS.js / dash.js / Shaka style).
const MSE = (clip) => `<script>
(async () => {
  const v = document.querySelector('video.mse');
  const ms = new MediaSource();
  v.src = URL.createObjectURL(ms);
  await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }));
  const sb = ms.addSourceBuffer('video/webm; codecs="vp9"');
  const buf = await (await fetch('${clip}')).arrayBuffer();
  sb.appendBuffer(buf);
  await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
  ms.endOfStream();
})();
</script>`;

const MSE_SCRIPT = MSE(CLIP);

// Shadow helpers: define <x-outer>/<x-mid>/<x-inner>… each wrapping the next in an open shadow root.
const shadowChain = (levels, defineDelayMs = 0, tag = 'x-l') => `<script>
const N = ${levels};
function def(){
for (let i = 0; i < N; i++) {
  customElements.define('${tag}' + i, class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = i === N - 1 ? '<video src="${CLIP}?shadow" muted preload="metadata" width="640" height="360"></video>' : '<${tag}' + (i + 1) + '></${tag}' + (i + 1) + '>';
    }
  });
}}
${defineDelayMs ? `setTimeout(def, ${defineDelayMs});` : 'def();'}
</script>`;

export const STUB_HOSTS =
  /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|googleapis\.com|drive\.google\.com|wistia\.net|wistia\.com|loom\.com|dailymotion\.com|brightcove\.net|jwplayer\.com|jwplatform\.com|kaltura\.com|panopto\.com|twitch\.tv|tiktok\.com|facebook\.com|streamable\.com|ytimg\.com|doubleclick\.net|adnxs\.com|adserver\.example|stubcdn\.example)\//i;

/** HTML returned for a stubbed third-party URL. */
export function stubFor(url) {
  const u = new URL(url);
  const playerBody = `<style>html,body{margin:0;height:100%;overflow:hidden}video{width:100%;height:100%;display:block}</style>`;
  if (/ytimg\.com$/.test(u.hostname)) return null; // thumbnails: 404 is fine
  if (/(adserver\.example|doubleclick\.net|adnxs\.com)$/.test(u.hostname)) {
    // Ad-like frame: ~60 nodes, re-renders every 100 ms.
    return page(
      `<div id=ad>${'<span>ad</span>'.repeat(60)}</div><script>setInterval(()=>{const s=document.createElement('span');s.textContent=Math.random();ad.appendChild(s);ad.firstChild.remove()},100)</script>`,
      'ad',
    );
  }
  if (u.hostname === 'drive.google.com' && u.pathname.startsWith('/file/d/')) {
    return page(
      `${playerBody}<iframe src="https://youtube.googleapis.com/embed/?docid=${u.pathname.split('/')[3]}&partnerid=30" style="width:100%;height:100%;border:0"></iframe>`,
      'clip.mp4 - Google Drive',
    );
  }
  if (/(^|\.)youtube\.com$/.test(u.hostname) && /^\/(watch|shorts|live)/.test(u.pathname)) {
    const spa = u.searchParams.get('v')?.startsWith('SPA');
    const quiet = u.searchParams.get('v')?.startsWith('SPQ');
    return page(
      `${V('', CDN_CLIP)}${
        spa
          ? `<script>
      setTimeout(() => { history.pushState({}, '', '/watch?v=SPAAAAAAAA2'); }, 3000);
      setTimeout(() => { document.title = 'Second video - YouTube'; }, 4200);
    </script>`
          : ''
      }${quiet ? `<script>setTimeout(() => history.pushState({}, '', '/watch?v=SPQQQQQQQQ2'), 3000);</script>` : ''}`,
      'First video - YouTube',
    );
  }
  if (/vimeo\.com$/.test(u.hostname) && u.hostname !== 'player.vimeo.com')
    return page(V('', CDN_CLIP), 'A vimeo clip on Vimeo');
  if (url.includes('EMPTY'))
    return page(
      `${playerBody}<div style="width:100%;height:100%;background:#333">poster, video created on click</div>`,
      'Player',
    );
  if (url.includes('MSE'))
    return page(`${playerBody}<video class="mse" muted></video>${MSE(CDN_CLIP)}`, 'Player');
  return page(`${playerBody}${V('', CDN_CLIP)}`, 'Player');
}

/**
 * expect: tokens that must be listed — 'native', 'native:blob', '<provider>:<externalId>'.
 * expect: null → report-only (no pass/fail). wait: ms after load before reading.
 * flow: optional async fn(page) run after load (clicks, etc.).
 */
export const FIXTURES = [
  { id: 'native-src', html: page(V('controls')), expect: ['native'] },
  {
    id: 'native-source',
    html: page(
      `<video controls muted preload="metadata" width="640" height="360"><source src="${CLIP}" type="video/webm"></video>`,
    ),
    expect: ['native'],
  },
  {
    id: 'native-blob-mse',
    html: page(`<video class="mse" controls muted width="640" height="360"></video>${MSE_SCRIPT}`),
    expect: ['native:blob'],
  },
  {
    id: 'native-lazy-3s',
    html: page(`<div id=c></div><script>setTimeout(()=>{c.innerHTML='${V()}'}, 3000)</script>`),
    expect: ['native'],
    wait: 5000,
  },
  {
    id: 'native-src-set-late',
    html: page(
      `<video id=v muted width=640 height=360></video><script>setTimeout(()=>{v.src='${CLIP}'}, 2500)</script>`,
    ),
    expect: ['native'],
    wait: 5000,
    note: 'video exists empty at idle, src assigned later (player JS)',
  },
  { id: 'shadow-2-levels', html: page(`<x-l0></x-l0>${shadowChain(2)}`), expect: ['native'] },
  {
    id: 'shadow-3-levels-mux-like',
    html: page(`<x-l0></x-l0>${shadowChain(3)}`),
    expect: ['native'],
  },
  { id: 'shadow-4-levels', html: page(`<x-l0></x-l0>${shadowChain(4)}`), expect: ['native'] },
  {
    id: 'shadow-late-upgrade',
    html: page(`<x-l0></x-l0>${shadowChain(2, 2500)}`),
    expect: ['native'],
    wait: 6000,
    note: 'custom element defined (upgraded) after document_idle, as with async/deferred player bundles',
  },
  {
    id: 'shadow-appended-1s',
    html: page(
      `<div id=c></div>${shadowChain(2)}<script>setTimeout(()=>c.appendChild(document.createElement('x-l0')), 1000)</script>`,
    ),
    expect: ['native'],
    wait: 7000,
    note: 'player custom element appended shortly after idle',
  },
  {
    id: 'shadow-on-div',
    html: page(`<div id=h></div><script>h.attachShadow({mode:'open'}).innerHTML='${V()}'</script>`),
    expect: ['native'],
    note: 'shadow root on a plain <div> (no dash in tag)',
  },
  {
    id: 'shadow-plus-tiny-light-video',
    html: page(
      `<video src="${CLIP}" muted width=2 height=2></video><x-l0></x-l0>${shadowChain(2)}`,
    ),
    expect: ['native'],
    expectMediaSrc: 'clip.webm?shadow',
    note: 'a 2x2 light-DOM video suppresses the shadow walk (2x2 is filtered like tiny-hidden-top: only the shadow video is expected; was [native,native])',
  },
  {
    id: 'about-blank-docwrite',
    html: page(
      `<iframe id=f width=660 height=380></iframe><script>const d=f.contentDocument;d.open();d.write('<!doctype html><body style=margin:0><video src=${CLIP} muted preload=metadata width=640 height=360></video></body>');d.close();</script>`,
    ),
    expect: ['native'],
  },
  {
    id: 'srcdoc-iframe',
    html: page(
      `<iframe width=660 height=380 srcdoc='<body>${V().replace(/'/g, '')}</body>'></iframe>`,
    ),
    expect: ['native'],
  },
  { id: 'cross-origin-iframe', html: page(ifr(`${B}/b-video.html`)), expect: ['native'] },
  {
    id: 'nested-3-levels',
    html: page(ifr(`${B}/b-nest2.html`, 'width=700 height=420')),
    expect: ['native'],
  },
  {
    id: 'youtube-embed',
    html: page(ifr('https://www.youtube.com/embed/dQw4w9WgXcQ')),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'youtube-nocookie-embed',
    html: page(ifr('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0')),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'youtube-embed-lazy-datasrc',
    html: page(
      `<iframe class="lazyload" data-src="https://www.youtube.com/embed/dQw4w9WgXcQ" width=640 height=360></iframe>`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
    note: 'lazysizes / WP Rocket pattern: src only set when scrolled into view',
  },
  {
    id: 'youtube-embed-loading-lazy-offscreen',
    html: page(
      `<div style="height:5000px"></div>${ifr('https://www.youtube.com/embed/dQw4w9WgXcQ', 'loading=lazy')}`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'vimeo-embed',
    html: page(ifr('https://player.vimeo.com/video/76979871?h=8272103f6e')),
    expect: ['vimeo:76979871'],
  },
  {
    id: 'wistia-embed',
    html: page(ifr('https://fast.wistia.net/embed/iframe/abc123xyz9')),
    expect: ['native'],
    note: 'ideal: wistia:abc123xyz9',
  },
  {
    id: 'wistia-embed-mse',
    html: page(ifr('https://fast.wistia.net/embed/iframe/MSEabc1234')),
    expect: ['native:blob'],
  },
  {
    id: 'wistia-embed-poster-only',
    html: page(ifr('https://fast.wistia.net/embed/iframe/EMPTYabc12')),
    expect: ['native'],
    note: 'player that creates its <video> only on click; ideal: listed from URL shape',
  },
  {
    id: 'wistia-js-api-div',
    html: page(
      `<div class="wistia_embed wistia_async_abc123xyz9" style="width:640px;height:360px"></div>`,
    ),
    expect: ['native'],
    note: 'Wistia JS embed before E-v1.js runs (no network) — report',
    reportOnly: true,
  },
  {
    id: 'loom-embed',
    html: page(ifr('https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184')),
    expect: ['native'],
  },
  {
    id: 'dailymotion-embed',
    html: page(ifr('https://www.dailymotion.com/embed/video/x8abcd1')),
    expect: ['native'],
  },
  {
    id: 'dailymotion-geo-embed',
    html: page(ifr('https://geo.dailymotion.com/player.html?video=x8abcd1')),
    expect: ['native'],
  },
  {
    id: 'brightcove-embed',
    html: page(
      ifr(
        'https://players.brightcove.net/1234567890/default_default/index.html?videoId=6312345678112',
      ),
    ),
    expect: ['native'],
  },
  {
    id: 'jwplayer-embed',
    html: page(ifr('https://cdn.jwplayer.com/players/AbCd1234-EfGh5678.html')),
    expect: ['native'],
  },
  {
    id: 'kaltura-embed',
    html: page(
      ifr(
        'https://cdnapisec.kaltura.com/p/1234/sp/123400/embedIframeJs/uiconf_id/456/partner_id/1234?iframeembed=true&entry_id=1_abcd1234',
      ),
    ),
    expect: ['native'],
  },
  {
    id: 'panopto-embed',
    html: page(
      ifr(
        'https://demo.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=6d7f1a4b-1111-2222-3333-abcdefabcdef',
      ),
    ),
    expect: ['native'],
  },
  {
    id: 'twitch-embed',
    html: page(ifr(`https://player.twitch.tv/?video=1234567&parent=127.0.0.1`)),
    expect: ['native'],
  },
  { id: 'streamable-embed', html: page(ifr('https://streamable.com/e/abc12')), expect: ['native'] },
  {
    id: 'drive-preview-iframe',
    html: page(ifr('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/preview')),
    expect: ['drive:1AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
  },
  {
    id: 'facade-lite-youtube',
    html: page(
      `<lite-youtube videoid="dQw4w9WgXcQ" style="background-image:url('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');width:640px;height:360px;display:block"><button class="lty-playbtn"></button></lite-youtube>`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'facade-div-data-video-id',
    html: page(
      `<div class="yt-facade" data-video-id="dQw4w9WgXcQ" style="width:640px;height:360px"><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"></div>`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'facade-data-youtube-id',
    html: page(`<div data-youtube-id="dQw4w9WgXcQ"></div>`),
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'facade-lite-vimeo',
    html: page(
      `<lite-vimeo videoid="76979871" style="display:block;width:640px;height:360px"></lite-vimeo>`,
    ),
    expect: ['vimeo:76979871'],
  },
  {
    id: 'facade-click-then-iframe',
    html: page(
      `<div id=f data-video-id="dQw4w9WgXcQ" style="width:640px;height:360px;background:#000"></div><script>f.onclick=()=>{f.innerHTML='<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1" width=640 height=360></iframe>'}</script>`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
    flow: async (p) => {
      await p.waitForTimeout(1500);
      await p.click('#f');
    },
    wait: 3000,
    note: 'after the click',
  },
  {
    id: 'plyr-youtube-div',
    html: page(
      `<div id="player" data-plyr-provider="youtube" data-plyr-embed-id="dQw4w9WgXcQ"></div>`,
    ),
    expect: ['youtube:dQw4w9WgXcQ'],
    note: 'Plyr progressive-enhancement markup before Plyr JS (no network) — report',
    reportOnly: true,
  },
  {
    id: 'videojs-markup',
    html: page(
      `<div class="video-js vjs-fluid" style="width:640px"><video class="vjs-tech" src="${CLIP}" muted preload="metadata" width="640" height="360"></video><div class="vjs-control-bar"></div></div>`,
    ),
    expect: ['native'],
  },
  {
    id: 'plyr-markup',
    html: page(
      `<div class="plyr plyr--video"><div class="plyr__video-wrapper"><video playsinline controls muted preload="metadata" width="640" height="360"><source src="${CLIP}" type="video/webm"></video></div></div>`,
    ),
    expect: ['native'],
  },
  {
    id: 'tiny-hidden-top',
    html: page(
      `<video src="${CLIP}" muted width=1 height=1></video><video src="${CLIP}?h" muted style="display:none"></video>`,
    ),
    expect: [],
    note: 'should be ignored',
  },
  {
    id: 'tiny-hidden-subframe',
    html: page(ifr(`${B}/b-tiny.html`)),
    expect: [],
    note: 'should be ignored',
  },
  {
    id: 'decorative-bg-loop',
    html: page(
      `<section style="position:relative;height:500px"><video src="${CLIP}" autoplay muted loop playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1"></video><h1>Hero</h1></section>`,
    ),
    expect: null,
    note: 'report-only',
  },
  {
    id: 'audio-only',
    html: page(`<audio src="${CLIP}" controls preload="metadata"></audio>`),
    expect: null,
    note: 'report-only (podcast pages)',
  },
  {
    id: 'youtube-watch-page',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'youtube-shorts-page',
    url: 'https://www.youtube.com/shorts/aBcDeFgHiJk',
    expect: ['youtube:aBcDeFgHiJk'],
  },
  {
    id: 'youtube-live-page',
    url: 'https://www.youtube.com/live/aBcDeFgHiJk',
    expect: ['youtube:aBcDeFgHiJk'],
  },
  {
    id: 'youtube-mobile-watch',
    url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    expect: ['youtube:dQw4w9WgXcQ'],
  },
  { id: 'vimeo-page', url: 'https://vimeo.com/76979871', expect: ['vimeo:76979871'] },
  {
    id: 'vimeo-channel-page',
    url: 'https://vimeo.com/channels/staffpicks/76979871',
    expect: ['vimeo:76979871'],
  },
  {
    id: 'spa-youtube-pushstate',
    url: 'https://www.youtube.com/watch?v=SPAAAAAAAA1',
    expect: ['youtube:SPAAAAAAAA2'],
    expectTitle: 'Second video',
    wait: 7000,
    note: 'pushState at +3s, title updated at +4.2s',
  },
  {
    id: 'spa-youtube-pushstate-no-dom-change',
    url: 'https://www.youtube.com/watch?v=SPQQQQQQQQ1',
    expect: ['youtube:SPQQQQQQQQ2'],
    wait: 6000,
  },
  {
    id: 'spa-native-swap',
    html: page(
      `<div id=c>${V()}</div><script>setTimeout(()=>{history.pushState({},'', '/second'); c.innerHTML='<video src="${CLIP}?second" muted preload="metadata" width=640 height=360></video>'}, 3000)</script>`,
    ),
    expect: ['native'],
    expectMediaSrc: 'clip.webm?second',
    wait: 6000,
  },
  {
    id: 'spa-pushstate-keeps-subframe-video',
    html: page(
      `${ifr(`${B}/b-video.html`)}<p id=t>page 1</p><script>setTimeout(()=>{history.pushState({},'', '/route-2'); t.textContent='page 2'}, 3000)</script>`,
    ),
    expect: ['native'],
    wait: 6000,
    note: 'top-frame route change; the iframe player is untouched',
  },
  {
    id: 'hashchange-keeps-subframe-video',
    html: page(
      `${ifr(`${B}/b-video.html`)}<script>setTimeout(()=>{location.hash='chapter-2'}, 3000)</script>`,
    ),
    expect: ['native'],
    wait: 6000,
  },
  {
    id: 'accordion-revealed-subframe',
    html: page(
      `<div id=acc style="display:none">${ifr(`${B}/b-video-fluid.html`)}</div><script>setTimeout(()=>{acc.style.display='block'}, 3000)</script>`,
    ),
    expect: ['native'],
    wait: 6000,
    note: 'iframe player in a hidden tab/accordion/modal, revealed later',
  },
  {
    id: 'false-positive-yt-subscribe-plus-native',
    html: page(
      `${V('controls')}<iframe src="https://www.youtube.com/subscribe_embed?channelid=UC123&layout=default" width=200 height=30></iframe>`,
    ),
    expect: ['native'],
    note: 'YouTube subscribe button iframe next to the page own video',
  },
  {
    id: 'false-positive-url-mentions-youtube',
    html: page(
      `${V('controls')}<iframe src="https://www.facebook.com/plugins/like.php?href=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc" width=100 height=30></iframe>`,
    ),
    expect: ['native'],
    note: 'share/like widget whose query string mentions youtube.com',
  },
  {
    id: 'mixed-native-and-youtube',
    html: page(
      `${V('controls')}<p>related:</p>${ifr('https://www.youtube.com/embed/dQw4w9WgXcQ')}`,
    ),
    expect: ['native', 'youtube:dQw4w9WgXcQ'],
    note: 'news article: own native video + related YouTube embed',
  },
  {
    id: 'mixed-wistia-and-youtube',
    html: page(
      `${ifr('https://fast.wistia.net/embed/iframe/abc123xyz9')}${ifr('https://www.youtube.com/embed/dQw4w9WgXcQ')}`,
    ),
    expect: ['native', 'youtube:dQw4w9WgXcQ'],
  },
  {
    id: 'hashchange-with-rotating-ad-frame',
    html: page(`${ifr(`${B}/b-video.html`)}<iframe id=ad width=300 height=250></iframe><script>
      const d = ad.contentDocument; d.open(); d.write('<body style=margin:0><video id=v src=${CLIP}?ad0 muted autoplay width=300 height=250></video>'); d.close();
      let n = 0; setInterval(() => { d.getElementById('v').src = '${CLIP}?ad' + (++n); }, 2000);
      setTimeout(() => { location.hash = 'comments'; }, 3000);
    </script>`),
    expect: ['native', 'native:any'],
    wait: 6000,
    note: 'ad frame republishes after the hash change -> worker marks tab live, popup no longer asks',
  },
  {
    id: 'shadow-appended-plus-iframe-video',
    html: page(
      `${ifr(`${B}/b-video.html`)}<div id=c></div>${shadowChain(2)}<script>setTimeout(()=>c.appendChild(document.createElement('x-l0')), 1000)</script>`,
    ),
    expect: ['native', 'native'],
    wait: 7000,
    note: 'shadow player appended after idle while another frame already published',
  },
  {
    id: 'accordion-plus-visible-player',
    html: page(
      `${ifr(`${B}/b-video.html?visible`)}<div id=acc style="display:none">${ifr(`${B}/b-video-fluid.html`)}</div><script>setTimeout(()=>{acc.style.display='block'}, 3000)</script>`,
    ),
    expect: ['native', 'native'],
    wait: 6000,
  },
  {
    id: 'ad-video-aboutblank-160x90',
    html: page(
      `${V('controls')}<iframe id=ad width=160 height=90 style=border:0></iframe><script>const d=ad.contentDocument;d.open();d.write('<body style=margin:0><video src=${CLIP}?ad muted autoplay loop width=160 height=90></video>');d.close();</script>`,
    ),
    expect: ['native'],
    note: 'w3schools-style ad slot video (seen live: 159x89 data: video in about:blank ad frame)',
  },
  {
    id: 'wikimedia-tmh-placeholder',
    html: page(
      `<video id="mwe_player_0_placeholder" poster="x.jpg" preload="none" data-mw-tmh="" width="800" height="450" data-durationhint="635" data-mwtitle="Big_Buck_Bunny_4K.webm" playsinline disabled></video><video preload="none" data-mw-tmh="" width="120" height="68" data-durationhint="635" data-mwtitle="Big_Buck_Bunny_4K.webm" disabled></video>`,
    ),
    expect: ['native'],
    note: 'MediaWiki TimedMediaHandler lazy placeholder (copied from commons.wikimedia.org): no src until click; main + 120x68 thumb of same file',
  },
  {
    id: 'dailymotion-watch-page',
    url: 'https://www.dailymotion.com/video/x8abcd1',
    expect: ['native'],
    note: 'ideal: dailymotion:x8abcd1',
  },
  {
    id: 'youtube-playlist-embed',
    html: page(ifr('https://www.youtube.com/embed/videoseries?list=PLabcdef')),
    expect: null,
    note: 'report-only: externalId for playlist embed',
  },
];

/** Pages served at origin B (and A) by path. */
export const SUBPAGES = {
  '/b-video.html': page(V()),
  '/b-video-fluid.html': page(
    `<style>html,body{margin:0;height:100%}video{width:100%;height:100%}</style><video src="${CLIP}?fluid" muted preload="metadata"></video>`,
  ),
  '/b-tiny.html': page(
    `<video src="${CLIP}" muted width=1 height=1></video><video src="${CLIP}?x" muted style="display:none"></video>`,
  ),
  '/b-nest2.html': page(ifr(`${A}/a-nest3.html`, 'width=680 height=400')),
  '/a-nest3.html': page(ifr(`${B}/b-video.html`, 'width=660 height=380')),
};
