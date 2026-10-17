import { describe, expect, it } from 'vitest';
import { isExtensionPageSender } from './sender-guard';

const OWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // chrome.runtime.id shape

describe('isExtensionPageSender', () => {
  it('accepts a popup sender — our runtime id, no tab', () => {
    expect(isExtensionPageSender({ id: OWN }, OWN)).toBe(true);
  });

  it('accepts an extension page sender, extra fields included', () => {
    const offscreen = { id: OWN, url: `chrome-extension://${OWN}/offscreen.html` };
    expect(isExtensionPageSender(offscreen, OWN)).toBe(true);
  });

  it('accepts a sender whose tab is explicitly undefined', () => {
    expect(isExtensionPageSender({ id: OWN, tab: undefined }, OWN)).toBe(true);
  });

  it('refuses a content script — a tab is set even under our id', () => {
    expect(
      isExtensionPageSender({ id: OWN, tab: { id: 1, url: 'https://youtube.com' } }, OWN),
    ).toBe(false);
  });

  it('refuses another extension — a foreign sender.id', () => {
    expect(isExtensionPageSender({ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, OWN)).toBe(false);
  });

  it('refuses a web page — external traffic carries a tab and no id', () => {
    expect(isExtensionPageSender({ tab: { id: 3 } }, OWN)).toBe(false);
  });

  it('refuses a missing or foreign id outright', () => {
    expect(isExtensionPageSender({}, OWN)).toBe(false);
    expect(isExtensionPageSender({ id: 'not-ours' }, OWN)).toBe(false);
    expect(isExtensionPageSender(undefined, OWN)).toBe(false);
  });
});
