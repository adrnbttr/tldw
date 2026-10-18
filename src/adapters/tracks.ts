/** Normalized view of a caption track, whatever the host's own shape. */
export interface TrackInfo {
  /** BCP-47-ish language code, e.g. "de" or "pt-BR". */
  lang: string;
  /** True for automatic speech recognition (auto-generated) tracks. */
  auto: boolean;
}

const base = (lang: string): string => lang.toLowerCase().split(/[-_]/)[0];

/**
 * Picks the caption track to use (shared by all adapters).
 *
 * Priority:
 *  1. the video's original spoken language — the language of its ASR track, when
 *     there is one (auto captions are always in the spoken language);
 *  2. the preferred languages, in order (typically the summary output language);
 *  3. manual over automatic;
 *  4. the first track.
 * Each criterion only breaks ties left by the previous ones.
 */
export function pickTrackBy<T>(tracks: T[], preferred: string[], info: (t: T) => TrackInfo): T {
  const spoken = tracks.map(info).find((t) => t.auto)?.lang;
  const spokenBase = spoken ? base(spoken) : null;
  const prefBases = preferred.map(base);

  const score = (t: T): [number, number, number] => {
    const { lang, auto } = info(t);
    const b = base(lang);
    const spokenScore = spokenBase !== null && b === spokenBase ? 1 : 0;
    const prefIdx = prefBases.indexOf(b);
    const prefScore = prefIdx === -1 ? 0 : prefBases.length - prefIdx;
    return [spokenScore, prefScore, auto ? 0 : 1];
  };

  let best = tracks[0];
  let bestScore = score(best);
  for (const t of tracks.slice(1)) {
    const s = score(t);
    for (let i = 0; i < 3; i++) {
      if (s[i] === bestScore[i]) continue;
      if (s[i] > bestScore[i]) {
        best = t;
        bestScore = s;
      }
      break;
    }
  }
  return best;
}
