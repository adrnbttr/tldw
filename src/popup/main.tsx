import { render } from 'preact';
import { createClientLogger } from '@/shared/logger-client';
import { App } from './App';

/** Popup logger — ships to the worker's buffer and echoes to its own DevTools console. */
const log = createClientLogger('popup', { echo: true });

/**
 * Last-ditch error nets: whatever escapes the component tree still lands in
 * the central buffer as an error entry (message + stack) — same net as the
 * worker's own (background/index.ts).
 */
window.addEventListener('error', (event) => {
  log.error('uncaught error', {
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const { reason } = event;
  log.error('unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const root = document.getElementById('app');
if (root) render(<App />, root);
