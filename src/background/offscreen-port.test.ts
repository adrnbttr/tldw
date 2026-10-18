import { describe, expect, it, vi } from 'vitest';
import { acceptOffscreenPort } from './offscreen-port';

const port = (name: string, sender: chrome.runtime.MessageSender) =>
  ({ name, sender, disconnect: vi.fn() }) as unknown as chrome.runtime.Port & {
    disconnect: ReturnType<typeof vi.fn>;
  };

describe('acceptOffscreenPort (SW onConnect handler)', () => {
  it("keeps our offscreen document's job port open", () => {
    const p = port('tldw-offscreen-job', { id: 'ext', url: 'chrome-extension://ext/off.html' });
    expect(acceptOffscreenPort(p, 'ext')).toBe(true);
    expect(p.disconnect).not.toHaveBeenCalled();
  });

  it('drops a port from another extension, a content script, or with another name', () => {
    const cases = [
      port('tldw-offscreen-job', { id: 'other' }),
      port('tldw-offscreen-job', { id: 'ext', tab: { id: 1 } as chrome.tabs.Tab }),
      port('something-else', { id: 'ext' }),
    ];
    for (const p of cases) {
      expect(acceptOffscreenPort(p, 'ext')).toBe(false);
      expect(p.disconnect).toHaveBeenCalledOnce();
    }
  });
});
