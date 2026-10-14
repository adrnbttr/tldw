import { describe, it, expect } from 'vitest';
import {
  classifyMedia,
  isAudioOnlyUrl,
  isGoogleVideoUrl,
  isMediaUrl,
  normalizeMediaUrl,
  pickBestCandidate,
  resolveSegmentUrls,
  isHlsMaster,
  pickHlsVariant,
  parseHlsMedia,
  parseVimeoMaster,
} from './media';

describe('classifyMedia', () => {
  it('classifies by extension', () => {
    expect(classifyMedia('https://x/y.m3u8')).toBe('hls');
    expect(classifyMedia('https://x/y.mpd?t=1')).toBe('dash');
    expect(classifyMedia('https://x/y.mp4')).toBe('progressive');
    expect(classifyMedia('https://vod-adaptive.vimeocdn.com/a/audio/123')).toBe('segment');
    expect(classifyMedia('https://x/page.html')).toBe('unknown');
  });
});

describe('classifyMedia — Google Drive', () => {
  // A Drive video streams from googlevideo.com/videoplayback (mime=video/mp4
  // served as HTTP range chunks) inside a youtube.googleapis.com embed page.
  // Neither URL carries a media file extension: the googlevideo chunks are
  // recognized via host + mime param, the embed page itself stays unknown.
  const googlevideoUrl =
    'https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1&mime=video%2Fmp4&range=0-1048575&itag=18';
  const embedUrl = 'https://youtube.googleapis.com/embed/?authuser=0';

  it('classifies googlevideo videoplayback as progressive', () => {
    // mime=video/mp4 + a range header => a progressive MP4 chunk.
    expect(classifyMedia(googlevideoUrl)).toBe('progressive');
  });

  it('classifies googlevideo audio itags as progressive too', () => {
    expect(
      classifyMedia('https://rr3---sn-xxx.googlevideo.com/videoplayback?mime=audio%2Fmp4&itag=140'),
    ).toBe('progressive');
  });

  it('leaves googlevideo requests without a media mime unknown', () => {
    expect(classifyMedia('https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1')).toBe(
      'unknown',
    );
  });

  it('still classifies the youtube embed page as unknown', () => {
    expect(classifyMedia(embedUrl)).toBe('unknown');
  });

  it('flags googlevideo URLs (normalized or not) for the range download path', () => {
    expect(isGoogleVideoUrl(googlevideoUrl)).toBe(true);
    expect(isGoogleVideoUrl(normalizeMediaUrl(googlevideoUrl))).toBe(true);
    expect(isGoogleVideoUrl(embedUrl)).toBe(false);
  });

  // Alternative design: a dedicated 'googlevideo' MediaKind (no such value
  // exists yet) would keep Drive chunks distinct from generic progressive MP4s.
  it.todo('classify videoplayback as a dedicated googlevideo kind');
});

describe('isMediaUrl', () => {
  it('accepts media, rejects the rest', () => {
    expect(isMediaUrl('https://x/y.m3u8')).toBe(true);
    expect(
      isMediaUrl('https://rr3---sn-xxx.googlevideo.com/videoplayback?mime=video%2Fmp4&range=0-1'),
    ).toBe(true);
    expect(isMediaUrl('https://x/style.css')).toBe(false);
  });
});

describe('normalizeMediaUrl', () => {
  // A realistic googlevideo chunk URL (tokens kept short on purpose).
  const chunk =
    'https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1&itag=18&mime=video%2Fmp4&range=0-1048575&rn=3&rbuf=0&key=ck2';

  it('strips range/rn/rbuf and preserves everything else verbatim', () => {
    expect(normalizeMediaUrl(chunk)).toBe(
      'https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1&itag=18&mime=video%2Fmp4&key=ck2',
    );
  });

  it('maps every byte-range chunk of one file to the same whole-file URL', () => {
    const first = normalizeMediaUrl(chunk);
    const second = normalizeMediaUrl(
      'https://rr3---sn-xxx.googlevideo.com/videoplayback?expire=1&itag=18&mime=video%2Fmp4&range=1000000-1999999&rn=7&rbuf=942080&key=ck2',
    );
    expect(second).toBe(first);
  });

  it('matches param names case-insensitively and drops an emptied query', () => {
    expect(normalizeMediaUrl('https://x/videoplayback?Range=0-1&Rn=3&RBUF=0')).toBe(
      'https://x/videoplayback',
    );
  });

  it('returns URLs without a query unchanged', () => {
    expect(normalizeMediaUrl('https://x/y.mp4')).toBe('https://x/y.mp4');
  });
});

describe('isAudioOnlyUrl', () => {
  it('detects audio-mime stream URLs only', () => {
    expect(isAudioOnlyUrl('https://x/videoplayback?mime=audio%2Fmp4&itag=140')).toBe(true);
    expect(isAudioOnlyUrl('https://x/videoplayback?mime=video%2Fmp4&itag=18')).toBe(false);
  });
});

describe('pickBestCandidate', () => {
  it('prefers progressive over hls over segment', () => {
    const best = pickBestCandidate([
      { url: 'a', kind: 'segment' },
      { url: 'b', kind: 'hls' },
      { url: 'c', kind: 'progressive' },
    ]);
    expect(best?.url).toBe('c');
  });
  it('returns null when empty', () => {
    expect(pickBestCandidate([])).toBeNull();
  });
  it('prefers the audio-only stream when kinds tie', () => {
    const best = pickBestCandidate([
      { url: 'https://x/videoplayback?mime=video%2Fmp4&itag=18', kind: 'progressive' },
      { url: 'https://x/videoplayback?mime=audio%2Fmp4&itag=140', kind: 'progressive' },
    ]);
    expect(best?.url).toContain('mime=audio');
  });
});

describe('resolveSegmentUrls', () => {
  it('resolves relative and absolute segment URIs', () => {
    const playlist = [
      '#EXTM3U',
      '#EXTINF:4.0,',
      'seg0.ts',
      '#EXTINF:4.0,',
      'https://cdn/seg1.ts',
    ].join('\n');
    const urls = resolveSegmentUrls(playlist, 'https://host/path/index.m3u8');
    expect(urls).toEqual(['https://host/path/seg0.ts', 'https://cdn/seg1.ts']);
  });
});

describe('classifyMedia — Vimeo master', () => {
  it('detects master.json', () => {
    expect(classifyMedia('https://vod.vimeocdn.com/x/sep/video/y/master.json?base64_init=1')).toBe(
      'vimeo_master',
    );
  });
});

describe('parseVimeoMaster', () => {
  const masterUrl = 'https://vod.vimeocdn.com/exp/sep/video/abc/master.json?base64_init=1';
  const master = {
    base_url: '../',
    audio: [
      {
        base_url: 'audio/def/chop/',
        bitrate: 128000,
        init_segment: 'aGVsbG8=',
        segments: [{ url: 'segment-1.m4s' }, { url: 'segment-2.m4s' }],
      },
      { base_url: 'audio/hi/', bitrate: 256000, init_segment: 'x', segments: [{ url: 's.m4s' }] },
    ],
    video: [],
  };

  it('picks the lowest-bitrate audio and resolves nested base URLs', () => {
    const plan = parseVimeoMaster(master, masterUrl);
    expect(plan.initBase64).toBe('aGVsbG8=');
    // master.json → ../ → audio/def/chop/ → segment-1.m4s
    expect(plan.segmentUrls[0]).toBe(
      'https://vod.vimeocdn.com/exp/sep/video/audio/def/chop/segment-1.m4s',
    );
    expect(plan.segmentUrls).toHaveLength(2);
  });

  it('returns empty when there is no rendition', () => {
    expect(parseVimeoMaster({ audio: [], video: [] }, masterUrl)).toEqual({
      initBase64: null,
      segmentUrls: [],
    });
  });
});

describe('parseHlsMedia', () => {
  it('extracts the fMP4 init segment and media fragments', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4.0,',
      'seg0.m4s',
      '#EXTINF:4.0,',
      'seg1.m4s',
    ].join('\n');
    const { initUrl, segmentUrls } = parseHlsMedia(playlist, 'https://h/a/audio.m3u8');
    expect(initUrl).toBe('https://h/a/init.mp4');
    expect(segmentUrls).toEqual(['https://h/a/seg0.m4s', 'https://h/a/seg1.m4s']);
  });

  it('returns null init for plain TS segments', () => {
    const { initUrl, segmentUrls } = parseHlsMedia('#EXTM3U\nseg.ts', 'https://h/x.m3u8');
    expect(initUrl).toBeNull();
    expect(segmentUrls).toEqual(['https://h/seg.ts']);
  });
});

describe('HLS master handling', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="en",URI="audio/aud.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
    'video/hi.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000',
    'video/lo.m3u8',
  ].join('\n');

  it('detects a master playlist', () => {
    expect(isHlsMaster(master)).toBe(true);
    expect(isHlsMaster('#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\nseg.m4s')).toBe(false);
  });

  it('prefers the audio rendition', () => {
    expect(pickHlsVariant(master, 'https://h/master.m3u8')).toBe('https://h/audio/aud.m3u8');
  });

  it('falls back to the lowest-bandwidth variant when no audio track', () => {
    const noAudio = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
      'hi.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000',
      'lo.m3u8',
    ].join('\n');
    expect(pickHlsVariant(noAudio, 'https://h/master.m3u8')).toBe('https://h/lo.m3u8');
  });
});
