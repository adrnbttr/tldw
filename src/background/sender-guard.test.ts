import { describe, expect, it } from 'vitest';
import {
  isContentScriptSender,
  isExtensionPageSender,
  isServiceWorkerSender,
} from './sender-guard';

const OWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // chrome.runtime.id shape

describe('isExtensionPageSender', () => {
  const page = `chrome-extension://${OWN}/src/popup/index.html`;

  it('accepts a popup sender — our runtime id, an own-page url', () => {
    expect(isExtensionPageSender({ id: OWN, url: page }, OWN)).toBe(true);
  });

  it('accepts an extension page identified by origin only', () => {
    expect(isExtensionPageSender({ id: OWN, origin: `chrome-extension://${OWN}` }, OWN)).toBe(true);
  });

  it('accepts the popup opened as a tab — a tab is set but the url is ours', () => {
    expect(isExtensionPageSender({ id: OWN, url: page, tab: { id: 7 } }, OWN)).toBe(true);
  });

  it('refuses a sender with our id but no url nor origin', () => {
    expect(isExtensionPageSender({ id: OWN }, OWN)).toBe(false);
  });

  it('refuses a content script — a web page url even under our id', () => {
    expect(
      isExtensionPageSender(
        {
          id: OWN,
          url: 'https://youtube.com/watch?v=x',
          tab: { id: 1, url: 'https://youtube.com' },
        },
        OWN,
      ),
    ).toBe(false);
  });

  it('refuses a lookalike extension url', () => {
    expect(
      isExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}evil/page.html` }, OWN),
    ).toBe(false);
  });

  it('refuses another extension — a foreign sender.id', () => {
    expect(isExtensionPageSender({ id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', url: page }, OWN)).toBe(
      false,
    );
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

describe('isContentScriptSender', () => {
  it('accepts our content script in a tab', () => {
    expect(
      isContentScriptSender(
        { id: OWN, url: 'https://a.example/', tab: { id: 3 }, frameId: 2 },
        OWN,
      ),
    ).toBe(true);
  });

  it('refuses a sender without tab, a foreign id, and our own page opened in a tab', () => {
    expect(isContentScriptSender({ id: OWN, url: 'https://a.example/' }, OWN)).toBe(false);
    expect(isContentScriptSender({ id: 'other', tab: { id: 3 } }, OWN)).toBe(false);
    expect(
      isContentScriptSender(
        { id: OWN, url: `chrome-extension://${OWN}/src/popup/index.html`, tab: { id: 3 } },
        OWN,
      ),
    ).toBe(false);
  });
});

describe('isServiceWorkerSender', () => {
  const sw = `chrome-extension://${OWN}/service-worker-loader.js`;

  it('accepts the worker (its script URL, or no URL) and nothing else', () => {
    expect(isServiceWorkerSender({ id: OWN, url: sw }, OWN, sw)).toBe(true);
    expect(isServiceWorkerSender({ id: OWN }, OWN, sw)).toBe(true);
  });

  it('refuses the popup, a content script and another extension', () => {
    const popup = `chrome-extension://${OWN}/src/popup/index.html`;
    expect(isServiceWorkerSender({ id: OWN, url: popup }, OWN, sw)).toBe(false);
    expect(
      isServiceWorkerSender({ id: OWN, url: 'https://a.example/', tab: { id: 1 } }, OWN, sw),
    ).toBe(false);
    expect(isServiceWorkerSender({ id: OWN, tab: { id: 1 } }, OWN, sw)).toBe(false);
    expect(isServiceWorkerSender({ id: 'other', url: sw }, OWN, sw)).toBe(false);
    expect(isServiceWorkerSender({ id: OWN, url: sw }, OWN, undefined)).toBe(false);
  });
});
