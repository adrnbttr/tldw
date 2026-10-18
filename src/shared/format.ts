interface DurationUnits {
  h: string;
  min: string;
  s: string;
  unknown: string;
}

const DURATION_UNITS: Record<string, DurationUnits> = {
  en: { h: 'h', min: 'min', s: 's', unknown: 'unknown duration' },
  fr: { h: 'h', min: 'min', s: 's', unknown: 'durée inconnue' },
  de: { h: 'Std.', min: 'Min.', s: 'Sek.', unknown: 'Dauer unbekannt' },
  es: { h: 'h', min: 'min', s: 's', unknown: 'duración desconocida' },
};

/**
 * Formats a duration in seconds in `locale` (English fallback):
 * "1 h 05 min 03" / "30 min 47" / "12 s" (de: "1 Std. 05 Min. 03").
 */
export function formatDuration(totalSeconds: number | null, locale = 'en'): string {
  const u = DURATION_UNITS[locale] ?? DURATION_UNITS.en;
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return u.unknown;
  }
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (hours > 0) return `${hours} ${u.h} ${pad(minutes)} ${u.min} ${pad(seconds)}`;
  if (minutes > 0) return `${minutes} ${u.min} ${pad(seconds)}`;
  return `${seconds} ${u.s}`;
}

/** ASCII-safe, filesystem-friendly slug for export filenames (F8). */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'video'
  );
}

/** ISO date (YYYY-MM-DD) for filenames and headers. */
export function isoDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Clock "m:ss" / "h:mm:ss" for a position in a video. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
