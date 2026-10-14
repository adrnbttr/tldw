#!/usr/bin/env node
/**
 * Chiffre le coût (tailles + RAM pic) du traitement d'une vidéo d'1 h.
 *
 * Script jetable, Node 20+, ESM, sans dépendance. Il n'est pas importé par
 * l'extension : un .mjs ne peut pas importer du TS, la logique et les constantes
 * sont donc recopiées à la main depuis :
 * - planChunks()            → src/transcription/chunker.ts (l. 31-59)
 * - AUDIO_BYTES_PER_SECOND  → src/transcription/audio.ts (l. 20-22)
 */

// ─── Constantes recopiées ──────────────────────────────────────────────────────

// src/transcription/audio.ts : MP3 mono 16 kHz extrait à 64 kbps.
const AUDIO_BITRATE_KBPS = 64;
/** Bytes per second of the extracted mono MP3, for chunk planning. */
const AUDIO_BYTES_PER_SECOND = (AUDIO_BITRATE_KBPS * 1000) / 8; // 8 000 o/s

// Valeurs par défaut de planChunks (src/transcription/chunker.ts).
const MAX_BYTES = 24 * 1024 * 1024; // maxBytes — « under the 25 MB Whisper limit »
const OVERLAP_SECONDS = 5; // overlapSeconds (chemin Whisper ; OpenRouter passe 0)

// ─── planChunks, recopiée de src/transcription/chunker.ts ─────────────────────

/** Plans chunk time-ranges that each stay under the size limit, with overlap. */
function planChunks({
  durationSeconds,
  bytesPerSecond,
  maxBytes = MAX_BYTES,
  overlapSeconds = OVERLAP_SECONDS,
}) {
  if (durationSeconds <= 0 || bytesPerSecond <= 0) return [];

  const maxChunkSeconds = Math.max(overlapSeconds + 1, Math.floor(maxBytes / bytesPerSecond));

  // Single chunk fits.
  if (durationSeconds <= maxChunkSeconds) {
    return [{ index: 0, start: 0, end: durationSeconds }];
  }

  const plans = [];
  let start = 0;
  let index = 0;
  while (start < durationSeconds) {
    const end = Math.min(start + maxChunkSeconds, durationSeconds);
    plans.push({ index, start, end });
    if (end >= durationSeconds) break;
    start = end - overlapSeconds;
    index++;
  }
  return plans;
}

// ─── Chiffrage ─────────────────────────────────────────────────────────────────

const DURATION_SECONDS = 3600; // vidéo d'1 h
const SOURCE_SIZES_MO = [500, 1000]; // tailles de source vidéo à chiffrer (1 Mo = 10^6 o)

const nf = new Intl.NumberFormat('fr-FR');
const octets = (n) => `${nf.format(n)} o`;
const mo = (n) => `${nf.format(Math.round((n / 1e6) * 100) / 100)} Mo`;

const audioBytes = DURATION_SECONDS * AUDIO_BYTES_PER_SECOND;
const chunks = planChunks({
  durationSeconds: DURATION_SECONDS,
  bytesPerSecond: AUDIO_BYTES_PER_SECOND,
});

console.log(`durée=${DURATION_SECONDS} s`);
console.log(
  `audio total : ${octets(audioBytes)} (${mo(audioBytes)}) — MP3 mono 16 kHz à ${AUDIO_BITRATE_KBPS} kbps`,
);
console.log(`chunks=${chunks.length}`);
for (const chunk of chunks) {
  const seconds = chunk.end - chunk.start;
  const size = seconds * AUDIO_BYTES_PER_SECOND;
  console.log(
    `  chunk ${chunk.index} : ${nf.format(chunk.start)} s → ${nf.format(chunk.end)} s ` +
      `(${nf.format(seconds)} s) = ${octets(size)} (${mo(size)})`,
  );
}
console.log('taille base64 par requête (×4/3) :');
for (const chunk of chunks) {
  const size = (chunk.end - chunk.start) * AUDIO_BYTES_PER_SECOND;
  const base64 = Math.round((size * 4) / 3);
  console.log(`  chunk ${chunk.index} : ${octets(base64)} (${mo(base64)})`);
}

// RAM pic ≈ téléchargement de la vidéo en mémoire (×1) + concat des segments
// téléchargés (copie ×2 au total, cf. concat() dans src/offscreen/index.ts)
// + entrée écrite dans le MEMFS de ffmpeg.wasm (×~1, cf. writeFile() dans
// src/transcription/audio.ts) + sortie audio MP3 (A).
// Soit un majorant ≈ 3 × V + A.
const ramPeak = (videoMo) => videoMo * 1e6 * 3 + audioBytes;

console.log('');
console.log('RAM pic estimée (majorant ≈ 3 × vidéo + audio) :');
for (const videoMo of SOURCE_SIZES_MO) {
  const peak = ramPeak(videoMo);
  console.log(
    `  vidéo ${nf.format(videoMo)} Mo : ${mo(peak)} (≈ ${nf.format(Math.round((peak / 1e9) * 100) / 100)} Go)`,
  );
}

console.log('');
console.log('Hypothèses :');
console.log(
  ` - audio : MP3 mono 16 kHz à ${AUDIO_BITRATE_KBPS} kbps → ${nf.format(AUDIO_BYTES_PER_SECOND)} o/s ` +
    '(AUDIO_BYTES_PER_SECOND, src/transcription/audio.ts)',
);
console.log(
  ' - découpage : planChunks (src/transcription/chunker.ts), morceau ≤ 24 Mio, recouvrement 5 s ' +
    '(défaut du chemin Whisper ; le chemin OpenRouter passe overlapSeconds: 0 — même résultat ici)',
);
console.log(
  ' - base64 : taille transmise ≈ 4/3 × taille binaire ; la limite Whisper de 25 Mo porte sur le binaire',
);
console.log(
  ' - RAM pic = téléchargement vidéo en mémoire (×1) + concat des segments (copie ×2) ' +
    '+ entrée MEMFS ffmpeg.wasm (×~1) + sortie audio MP3 — majorant, phases non simultanées',
);
console.log(
  ' - non compté : ffmpeg-core.wasm (~32 Mo), heap JS/wasm, base64 des requêtes, réponse',
);
console.log(' - 1 Mo = 10^6 octets ; tailles de source façon affichage Drive (décimal)');
