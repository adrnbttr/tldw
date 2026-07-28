import type { Messages } from './types';

export const en: Messages = {
  list: {
    historyTooltip: 'History',
    settingsTooltip: 'Settings',
    emptyTitle: 'No video found on this page.',
    emptyHint: 'Start playback, then reopen this menu.',
    noTitle: 'Untitled video',
    videoLabel: 'Video',
    untreatable: 'not supported',
    summarize: 'Summarize',
    summarizeSelection: (count) => `Summarize selection (${count})`,
  },
  transcription: {
    fetchingMedia: 'Fetching the media stream…',
    extractingAudio: 'Extracting the audio track…',
    assembling: (index, total) => `Segments ${index}/${total}`,
    transcribing: (index, total, clock) => `${index}/${total} · ${clock}`,
  },
  processing: {
    back: '← Back',
    steps: {
      detect: 'Detection',
      captions: 'Looking for captions',
      audio_capture: 'Capturing the media stream',
      transcription: 'Audio transcription',
      summarize: 'Generating the summary',
    },
    failedTitle: 'Failed',
    backToList: 'Back to the list',
    cancel: 'Cancel',
  },
  result: {
    back: '← Back',
    heading: 'Summary',
    method: (source) => `Method: ${source}`,
    download: 'Download (.md)',
    copy: 'Copy',
    copied: 'Copied ✓',
  },
  settings: {
    back: '← Back',
    heading: 'Settings',
    openRouterKey: 'OpenRouter API key',
    transcriptionProvider: 'Audio transcription (for videos without captions)',
    providerOpenRouter: 'OpenRouter — Gemini (uses your OpenRouter key)',
    providerOpenAI: 'OpenAI — Whisper (needs a separate key)',
    transcriptionKey: 'OpenAI API key (Whisper)',
    transcriptionPlaceholder: 'optional',
    model: 'Summary model',
    outputLanguage: 'Summary language',
    uiLanguage: 'Interface language',
    detailLevel: 'Detail level',
    detailLevels: { concise: 'Concise', standard: 'Standard', detailed: 'Detailed' },
    template: 'Summary template',
    save: 'Save',
    saved: 'Saved ✓',
  },
  history: {
    back: '← Back',
    heading: 'History',
    empty: 'No summary saved yet.',
  },
  batch: {
    back: '← Back',
    heading: 'Batch processing',
    progress: (completed, total) => `${completed} / ${total} done`,
    current: (title) => `In progress: ${title}`,
    downloadAll: (count) => `Download all (${count}) as one .md file`,
  },
  sources: {
    youtube_captions: 'YouTube captions',
    vimeo_captions: 'Vimeo captions',
    audio_transcription: 'Audio transcription',
  },
  errors: {
    NO_VIDEO_DETECTED: 'No video found on this page. Start playback, then try again.',
    NO_CAPTIONS_AVAILABLE:
      'This video has no captions and audio transcription is not configured. Add a transcription key in the settings.',
    MISSING_OPENROUTER_KEY: 'OpenRouter key missing. Add it in the settings.',
    MISSING_TRANSCRIPTION_KEY:
      'Transcription key missing. Add it in the settings to enable the audio fallback.',
    QUOTA_EXCEEDED: 'API quota exceeded.',
    MEDIA_NOT_CAPTURABLE:
      'The video stream could not be retrieved. This host may not be supported.',
    MEDIA_NEEDS_PLAYBACK:
      'Play the video for a few seconds, then try again — the stream needs to load first.',
    MEDIA_PROTECTED:
      'The content is protected (encrypted). Audio transcription cannot be performed.',
    AUDIO_EXTRACTION_FAILED: 'Isolating the audio track failed.',
    TRANSCRIPTION_API_ERROR: 'The transcription service returned an error.',
    TIMEOUT: 'Processing exceeded the time limit. Try a shorter video.',
    UNSUPPORTED_PROVIDER: 'This host is not supported yet.',
    SUMMARY_API_ERROR: 'Generating the summary failed.',
    UNKNOWN: 'An unexpected error occurred.',
  },
};
