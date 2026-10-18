# Contributing

Thanks for your interest in tldw! This is a personal project, but issues and pull
requests are welcome.

## Getting started

```bash
npm install
npm run dev      # Vite dev server with hot-reload
```

Load the built extension from `dist/` via `chrome://extensions` → **Developer mode** →
**Load unpacked**, and click **↻ reload** after each rebuild (`npm run build:test` builds and
prints the path to load). Requires Node 20 (`.nvmrc`). The map of the code is in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md); how to validate in a real browser is in
[`docs/TESTING.md`](./docs/TESTING.md).

## Before you open a PR

Run the full check locally — CI runs the same:

```bash
npm run lint     # ESLint + Prettier (also checks the Markdown docs)
npm test         # Vitest
npm run build    # typecheck + production build
npm run test:e2e # detection e2e in headless Chromium (once: npm run e2e:install)
```

If your change alters behavior a user or contributor can see (supported sites, settings, errors,
what is stored or sent), update the matching doc in the same PR: `README.md`, `docs/PRIVACY.md`,
`docs/TROUBLESHOOTING.md` or `docs/ARCHITECTURE.md`. Do not edit `CHANGELOG.md`'s
`[Unreleased]` section: it is filled at release time ([`docs/RELEASING.md`](./docs/RELEASING.md)).

## Guidelines

- **Keep the `Transcript` contract stable.** Adapters and the audio fallback must
  produce the exact shape in `src/types/transcript.ts`. That contract is what keeps
  the output format identical across extraction paths.
- **Typed errors only.** Surface failures as `TldwError` with a code from
  `src/types/errors.ts`, mapped to a localized message in `src/i18n/` (all four locales —
  a test enforces key parity). No silent failures.
- **Never log secrets.** Use the loggers (`src/shared/logger.ts`); media URLs go through
  `loggableUrl`. Redaction is a safety net, not a license.
- **The summarizer renders Markdown, the model doesn't.** New templates go through
  `src/summarizer/template.ts` and take structured JSON as input.
- **Match the surrounding style.** Prettier + ESLint are authoritative; add a unit
  test for any new pure helper.

## Adding a provider adapter

An adapter extracts **captions**; videos with no adapter (native, Drive, hosted players) go
straight to the audio path, so a new site often only needs detection.

1. Implement the `Adapter` interface in `src/adapters/<provider>.ts`.
2. Register it in `src/adapters/index.ts`.
3. Add detection for its embed URL in `src/content/detect.ts` (the `EMBED_HOSTS` table covers
   hosted players that only need an id).
4. Cover the pure parsing with tests.

## Commit style

Short, imperative subject lines (e.g. `add Vimeo text_tracks adapter`; the history also uses
conventional prefixes such as `feat(…)` / `chore(release)`). Keep unrelated changes in
separate commits.
