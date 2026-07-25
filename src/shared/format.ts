/** Formats a duration in seconds as "1 h 05 min 03" / "30 min 47" / "12 s". */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return 'durée inconnue';
  }
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min ${String(seconds).padStart(2, '0')}`;
  }
  if (minutes > 0) {
    return `${minutes} min ${String(seconds).padStart(2, '0')}`;
  }
  return `${seconds} s`;
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
