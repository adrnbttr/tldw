import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorkerLink } from './worker-link';

function stubPort() {
  const disconnectListeners: Array<() => void> = [];
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
  };
  const connect = vi.fn(() => port);
  vi.stubGlobal('chrome', { runtime: { connect } });
  return { port, connect, dropFromWorker: () => disconnectListeners.forEach((fn) => fn()) };
}

afterEach(() => vi.unstubAllGlobals());

describe('openWorkerLink', () => {
  it('holds the job port open without posting anything, and closes it on purpose', () => {
    const { port, connect } = stubPort();
    const link = openWorkerLink(vi.fn());
    expect(connect).toHaveBeenCalledWith({ name: 'tldw-offscreen-job' });
    link.close();
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it('reports the loss when the worker side disconnects', () => {
    const { dropFromWorker } = stubPort();
    const onLost = vi.fn();
    openWorkerLink(onLost);
    dropFromWorker();
    expect(onLost).toHaveBeenCalledOnce();
  });

  it('does not report a loss after a deliberate close', () => {
    const { dropFromWorker } = stubPort();
    const onLost = vi.fn();
    openWorkerLink(onLost).close();
    dropFromWorker();
    expect(onLost).not.toHaveBeenCalled();
  });
});
