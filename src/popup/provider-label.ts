/**
 * Badge text of a video host in the popup (video list and history): the
 * brand name for YouTube / Vimeo / Drive, the localized generic "Video" label
 * for everything else (page videos, hosted players).
 */
export function providerLabel(provider: string, videoLabel: string): string {
  if (provider === 'youtube') return 'YouTube';
  if (provider === 'vimeo') return 'Vimeo';
  if (provider === 'drive') return 'Drive';
  return videoLabel;
}
