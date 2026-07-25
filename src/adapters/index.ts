import type { DetectedVideo } from '@/types';
import type { Adapter } from './types';
import { youtubeAdapter } from './youtube';
import { vimeoAdapter } from './vimeo';

export type { Adapter } from './types';

const ADAPTERS: Adapter[] = [youtubeAdapter, vimeoAdapter];

/** Returns the adapter able to handle the video, or null (unsupported provider). */
export function selectAdapter(video: DetectedVideo): Adapter | null {
  return ADAPTERS.find((a) => a.canHandle(video)) ?? null;
}
