# Contributing

Thanks for your interest in tldw! This is a personal project, but issues and pull
requests are welcome.

## Getting started

```bash
npm install
npm run dev      # Vite dev server with hot-reload
```

Load the built extension from `dist/` via `chrome://extensions` → **Load unpacked**.

## Before you open a PR

Run the full check locally — CI runs the same:

```bash
npm run lint     # ESLint + Prettier
npm test         # Vitest
npm run build    # typecheck + production build
```

## Guidelines

- **Keep the `Transcript` contract stable.** Adapters and the audio fallback must
  produce the exact shape in `src/types/transcript.ts`. That contract is what keeps
  the output format identical across extraction paths.
- **Typed errors only.** Surface failures as `TldwError` with a code from
  `src/types/errors.ts`, mapped to a user-facing message. No silent failures.
- **The summarizer renders Markdown, the model doesn't.** New templates go through
  `src/summarizer/template.ts` and take structured JSON as input.
- **Match the surrounding style.** Prettier + ESLint are authoritative; add a unit
  test for any new pure helper.

## Adding a provider adapter

1. Implement the `Adapter` interface in `src/adapters/<provider>.ts`.
2. Register it in `src/adapters/index.ts`.
3. Add detection for its embed URL in `src/content/detect.ts`.
4. Cover the pure parsing with tests.

## Commit style

Short, imperative subject lines (e.g. `add Vimeo text_tracks adapter`). Keep
unrelated changes in separate commits.
