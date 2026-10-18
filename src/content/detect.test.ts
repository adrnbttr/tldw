import { describe, it, expect } from 'vitest';
import {
  providerFromUrl,
  externalIdFromUrl,
  dedupe,
  makeDetected,
  pageVideoFromUrl,
  youtubeIdFromUrl,
  vimeoIdFromUrl,
  selfEmbedFromUrl,
  isProviderFrameUrl,
  knownEmbedKey,
  youtubeIdFromThumbnail,
  wistiaIdFromClass,
  facadeVideo,
  backgroundImageUrl,
  isMeaningfulVideoBox,
  isDecorativeVideo,
  keepDecorative,
} from './detect';

describe('providerFromUrl', () => {
  it('recognizes YouTube hosts', () => {
    expect(providerFromUrl('https://www.youtube.com/embed/abc123')).toBe('youtube');
    expect(providerFromUrl('https://www.youtube-nocookie.com/embed/x')).toBe('youtube');
    expect(providerFromUrl('https://youtu.be/x')).toBe('youtube');
  });
  it('recognizes Vimeo player host', () => {
    expect(providerFromUrl('https://player.vimeo.com/video/12345')).toBe('vimeo');
  });
  it('falls back to unknown', () => {
    expect(providerFromUrl('https://example.com/video')).toBe('unknown');
  });

  describe('Google Drive', () => {
    it('detects a drive.google.com preview embed as drive', () => {
      expect(providerFromUrl('https://drive.google.com/file/d/ABC123/preview')).toBe('drive');
    });
    it('detects a drive.google.com view page as drive', () => {
      expect(providerFromUrl('https://drive.google.com/file/d/ABC123/view')).toBe('drive');
    });
    it('detects the youtube.googleapis.com player of Drive videos as drive', () => {
      expect(providerFromUrl('https://youtube.googleapis.com/embed/?authuser=0')).toBe('drive');
    });
    it('does not mistake the Drive player for a regular YouTube embed', () => {
      expect(providerFromUrl('https://www.youtube.com/embed/abc123')).toBe('youtube');
    });
    it('ignores drive.google.com pages that are not file view/preview URLs', () => {
      expect(providerFromUrl('https://drive.google.com/drive/folders/xyz')).toBe('unknown');
    });
  });
});

describe('externalIdFromUrl', () => {
  it('extracts YouTube embed id', () => {
    expect(externalIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube')).toBe(
      'dQw4w9WgXcQ',
    );
  });
  it('extracts YouTube watch id', () => {
    expect(externalIdFromUrl('https://www.youtube.com/watch?v=abc', 'youtube')).toBe('abc');
  });
  it('extracts youtu.be id', () => {
    expect(externalIdFromUrl('https://youtu.be/xyz', 'youtube')).toBe('xyz');
  });
  it('extracts Vimeo id', () => {
    expect(externalIdFromUrl('https://player.vimeo.com/video/76979871', 'vimeo')).toBe('76979871');
  });
  it('extracts the Drive file id from preview and view URLs', () => {
    expect(externalIdFromUrl('https://drive.google.com/file/d/ABC123/preview', 'drive')).toBe(
      'ABC123',
    );
    expect(externalIdFromUrl('https://drive.google.com/file/d/ABC123/view', 'drive')).toBe(
      'ABC123',
    );
  });
  it('yields no id for the Drive player URL', () => {
    expect(externalIdFromUrl('https://youtube.googleapis.com/embed/?authuser=0', 'drive')).toBe('');
  });
});

describe('pageVideoFromUrl', () => {
  it('detects a youtube.com watch page', () => {
    expect(pageVideoFromUrl('https://www.youtube.com/watch?v=abc123&t=10')).toEqual({
      provider: 'youtube',
      externalId: 'abc123',
    });
  });
  it('detects youtu.be', () => {
    expect(pageVideoFromUrl('https://youtu.be/xyz')).toEqual({
      provider: 'youtube',
      externalId: 'xyz',
    });
  });
  it('detects a vimeo.com page', () => {
    expect(pageVideoFromUrl('https://vimeo.com/76979871')).toEqual({
      provider: 'vimeo',
      externalId: '76979871',
    });
  });
  it('detects a drive.google.com view page', () => {
    expect(pageVideoFromUrl('https://drive.google.com/file/d/ABC123/view')).toEqual({
      provider: 'drive',
      externalId: 'ABC123',
    });
  });
  it('returns null for other pages', () => {
    expect(pageVideoFromUrl('https://example.com/page')).toBeNull();
    expect(pageVideoFromUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(pageVideoFromUrl('https://drive.google.com/drive/folders/xyz')).toBeNull();
  });
});

describe('dedupe', () => {
  it('removes duplicate provider+externalId', () => {
    const list = [
      makeDetected({ provider: 'youtube', externalId: 'a' }),
      makeDetected({ provider: 'youtube', externalId: 'a' }),
      makeDetected({ provider: 'youtube', externalId: 'b' }),
    ];
    expect(dedupe(list)).toHaveLength(2);
  });
});

describe('YouTube URL parsing (host + path, never the whole string)', () => {
  it('reads embed, watch, shorts, live, mobile, music and youtu.be ids', () => {
    expect(youtubeIdFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdFromUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeIdFromUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdFromUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeIdFromUrl('https://www.youtube.com/shorts/aBcDeFgHiJk')).toBe('aBcDeFgHiJk');
    expect(youtubeIdFromUrl('https://www.youtube.com/live/aBcDeFgHiJk?si=x')).toBe('aBcDeFgHiJk');
    expect(youtubeIdFromUrl('https://youtu.be/aBcDeFgHiJk?t=3')).toBe('aBcDeFgHiJk');
  });

  it('rejects YouTube widgets and pseudo-ids', () => {
    expect(youtubeIdFromUrl('https://www.youtube.com/subscribe_embed?channelid=UC1')).toBeNull();
    expect(youtubeIdFromUrl('https://www.youtube.com/live_chat?v=abc&embed_domain=x')).toBeNull();
    expect(youtubeIdFromUrl('https://www.youtube.com/embed/videoseries?list=PL1')).toBeNull();
    expect(youtubeIdFromUrl('https://www.youtube.com/embed/live_stream?channel=UC1')).toBeNull();
    expect(youtubeIdFromUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });

  it('ignores youtube.com mentioned in another host query string', () => {
    const like =
      'https://www.facebook.com/plugins/like.php?href=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc';
    expect(youtubeIdFromUrl(like)).toBeNull();
    expect(providerFromUrl(like)).toBe('unknown');
    expect(providerFromUrl('https://www.youtube.com/subscribe_embed?channelid=UC1')).toBe(
      'unknown',
    );
    expect(providerFromUrl('https://evil.example/youtube.com/embed/x')).toBe('unknown');
  });
});

describe('Vimeo URL parsing', () => {
  it('reads player, page, channel, showcase and group ids', () => {
    expect(vimeoIdFromUrl('https://player.vimeo.com/video/76979871?h=1')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/76979871')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/76979871/abcdef1234')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/channels/staffpicks/76979871')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/showcase/123/video/76979871')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/groups/x/videos/76979871')).toBe('76979871');
    expect(vimeoIdFromUrl('https://vimeo.com/features')).toBeNull();
  });
  it('lists only player.vimeo.com/video frames as Vimeo embeds', () => {
    expect(providerFromUrl('https://player.vimeo.com/api/player.js')).toBe('unknown');
  });
});

describe('pageVideoFromUrl — watch-page shapes', () => {
  it('covers shorts, live, mobile and music YouTube pages', () => {
    for (const url of [
      'https://www.youtube.com/shorts/aBcDeFgHiJk',
      'https://www.youtube.com/live/aBcDeFgHiJk',
      'https://m.youtube.com/watch?v=aBcDeFgHiJk',
      'https://music.youtube.com/watch?v=aBcDeFgHiJk',
    ]) {
      expect(pageVideoFromUrl(url)).toEqual({ provider: 'youtube', externalId: 'aBcDeFgHiJk' });
    }
  });
  it('covers Vimeo channel / showcase pages', () => {
    expect(pageVideoFromUrl('https://vimeo.com/channels/staffpicks/76979871')).toEqual({
      provider: 'vimeo',
      externalId: '76979871',
    });
  });
  it('does not treat an embed URL as a watch page (the frame reports itself instead)', () => {
    expect(pageVideoFromUrl('https://www.youtube.com/embed/aBcDeFgHiJk')).toBeNull();
    expect(selfEmbedFromUrl('https://www.youtube.com/embed/aBcDeFgHiJk')).toEqual({
      provider: 'youtube',
      externalId: 'aBcDeFgHiJk',
    });
    expect(selfEmbedFromUrl('https://player.vimeo.com/video/9')).toEqual({
      provider: 'vimeo',
      externalId: '9',
    });
    expect(selfEmbedFromUrl('https://example.com/')).toBeNull();
  });
});

describe('isProviderFrameUrl', () => {
  it('flags YouTube / Vimeo / Drive (and its player) frames only', () => {
    expect(isProviderFrameUrl('https://www.youtube.com/embed/x')).toBe(true);
    expect(isProviderFrameUrl('https://youtube.googleapis.com/embed/?docid=1')).toBe(true);
    expect(isProviderFrameUrl('https://player.vimeo.com/video/9')).toBe(true);
    expect(isProviderFrameUrl('https://drive.google.com/file/d/A/preview')).toBe(true);
    expect(isProviderFrameUrl('https://fast.wistia.net/embed/iframe/abc')).toBe(false);
    expect(isProviderFrameUrl('https://example.com/?u=youtube.com')).toBe(false);
  });
});

describe('knownEmbedKey', () => {
  it('reads the id of known hosted players', () => {
    const cases: Array<[string, string]> = [
      ['https://fast.wistia.net/embed/iframe/abc123xyz9?videoFoam=true', 'wistia:abc123xyz9'],
      [
        'https://www.loom.com/embed/0281766fa2d04bb788eaf19e65135184',
        'loom:0281766fa2d04bb788eaf19e65135184',
      ],
      ['https://www.dailymotion.com/embed/video/x8abcd1', 'dailymotion:x8abcd1'],
      ['https://geo.dailymotion.com/player.html?video=x8abcd1', 'dailymotion:x8abcd1'],
      ['https://www.dailymotion.com/video/x8abcd1', 'dailymotion:x8abcd1'],
      [
        'https://players.brightcove.net/1234567890/default_default/index.html?videoId=6312345678112',
        'brightcove:1234567890/6312345678112',
      ],
      ['https://cdn.jwplayer.com/players/AbCd1234-EfGh5678.html', 'jwplayer:AbCd1234'],
      [
        'https://cdnapisec.kaltura.com/p/1/sp/100/embedIframeJs/uiconf_id/4/partner_id/1?iframeembed=true&entry_id=1_abcd1234',
        'kaltura:1_abcd1234',
      ],
      [
        'https://demo.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=6d7f1a4b-1111',
        'panopto:6d7f1a4b-1111',
      ],
      ['https://streamable.com/e/abc12', 'streamable:abc12'],
      ['https://player.twitch.tv/?video=1234567&parent=x.com', 'twitch:v1234567'],
    ];
    for (const [url, key] of cases) expect(knownEmbedKey(url)).toBe(key);
  });

  it('hashes the URL of a known host without a readable id, unless an id is required', () => {
    const key = knownEmbedKey('https://fast.wistia.net/some/thing?x=1#frag');
    expect(key).toMatch(/^wistia:#[0-9a-f]{8}$/);
    expect(knownEmbedKey('https://fast.wistia.net/some/thing?x=1')).toBe(key);
    expect(knownEmbedKey('https://wistia.com/', { requireId: true })).toBeNull();
  });

  it('is null for unknown hosts and non-http URLs', () => {
    expect(knownEmbedKey('https://example.com/embed/abc')).toBeNull();
    expect(knownEmbedKey('about:blank')).toBeNull();
  });
});

describe('facades', () => {
  const attrs = (o: Record<string, string>) => (n: string) => o[n] ?? null;

  it('reads lite-youtube / lite-vimeo / data-*-id / Plyr markup', () => {
    expect(facadeVideo('lite-youtube', attrs({ videoid: 'dQw4w9WgXcQ' }))).toEqual({
      provider: 'youtube',
      externalId: 'dQw4w9WgXcQ',
    });
    expect(facadeVideo('lite-vimeo', attrs({ videoid: '76979871' }))).toEqual({
      provider: 'vimeo',
      externalId: '76979871',
    });
    expect(facadeVideo('div', attrs({ 'data-youtube-id': 'abc' }))?.externalId).toBe('abc');
    expect(facadeVideo('div', attrs({ 'data-vimeo-id': '9' }))?.provider).toBe('vimeo');
    expect(
      facadeVideo('div', attrs({ 'data-plyr-provider': 'youtube', 'data-plyr-embed-id': 'abc' })),
    ).toEqual({ provider: 'youtube', externalId: 'abc' });
    expect(
      facadeVideo(
        'div',
        attrs({
          'data-plyr-provider': 'vimeo',
          'data-plyr-embed-id': 'https://vimeo.com/76979871',
        }),
      ),
    ).toEqual({ provider: 'vimeo', externalId: '76979871' });
  });

  it('needs a YouTube thumbnail to trust a generic data-video-id', () => {
    const el = attrs({ 'data-video-id': 'dQw4w9WgXcQ' });
    expect(facadeVideo('div', el)).toBeNull();
    expect(facadeVideo('div', el, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')).toEqual({
      provider: 'youtube',
      externalId: 'dQw4w9WgXcQ',
    });
  });

  it('maps a Wistia JS embed to a native video with a wistia identity', () => {
    expect(
      facadeVideo('div', attrs({ class: 'wistia_embed wistia_async_abc123xyz9 videoFoam=true' })),
    ).toEqual({ provider: 'native', externalId: 'wistia:abc123xyz9' });
    expect(wistiaIdFromClass('wistia_embed')).toBeNull();
  });

  it('parses thumbnails and background images', () => {
    expect(youtubeIdFromThumbnail('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeIdFromThumbnail('https://i9.ytimg.com/vi_webp/abc_DEF-1/mq.webp')).toBe(
      'abc_DEF-1',
    );
    expect(youtubeIdFromThumbnail('https://example.com/vi/abc/x.jpg')).toBeNull();
    expect(
      backgroundImageUrl("background-image:url('https://i.ytimg.com/vi/x/hq.jpg');width:1px"),
    ).toBe('https://i.ytimg.com/vi/x/hq.jpg');
    expect(backgroundImageUrl(null)).toBeNull();
  });
});

describe('pollution filters', () => {
  it('uses an ad-slot threshold in strict (about:blank / data:) frames', () => {
    expect(isMeaningfulVideoBox(160, 90)).toBe(true);
    expect(isMeaningfulVideoBox(160, 90, true)).toBe(false);
    expect(isMeaningfulVideoBox(300, 250, true)).toBe(true);
  });

  it('spots decorative loops and keeps only a large one', () => {
    const loop = { muted: true, loop: true, autoplay: true, controls: false };
    expect(isDecorativeVideo(loop)).toBe(true);
    expect(isDecorativeVideo({ ...loop, controls: true })).toBe(false);
    expect(isDecorativeVideo({ ...loop, loop: false })).toBe(false);
    const viewport = { width: 1280, height: 900 };
    expect(keepDecorative({ width: 1280, height: 500 }, viewport)).toBe(true);
    expect(keepDecorative({ width: 400, height: 300 }, viewport)).toBe(false);
  });
});

describe('dedupe — shared identity', () => {
  it('collapses two <video> with the same file, keeps distinct url-less ones', () => {
    const src = 'https://cdn.x/a.mp4';
    const list = [
      makeDetected({ provider: 'native', mediaSrc: src }),
      makeDetected({ provider: 'native', mediaSrc: src }),
      makeDetected({ provider: 'native' }),
      makeDetected({ provider: 'native' }),
    ];
    expect(dedupe(list)).toHaveLength(3);
  });

  it('collapses natives sharing a host identity (MediaWiki file, Wistia container)', () => {
    const list = [
      makeDetected({ provider: 'native', externalId: 'mw:Big_Buck_Bunny_4K.webm' }),
      makeDetected({ provider: 'native', externalId: 'mw:Big_Buck_Bunny_4K.webm' }),
    ];
    expect(dedupe(list)).toHaveLength(1);
  });

  it('keeps a caller-provided stable id', () => {
    expect(makeDetected({ provider: 'native', id: 'fixed' }).id).toBe('fixed');
  });
});

describe('localId', () => {
  it('stays unique and unpredictable without crypto.randomUUID (http pages)', async () => {
    // Regression (v0.4.0 RC review): the fallback `vid-${Date.now()}-${counter}`
    // collided across the frames of a tab (same millisecond, same counter).
    const { localId } = await import('./detect');
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 200 }, () => localId()));
      expect(ids.size).toBe(200);
      for (const id of ids) expect(id).toMatch(/^vid-[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
