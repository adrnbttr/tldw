import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyDiagnosticReport, downloadDiagnosticReport } from './diagnostic-actions';
import { clearLogs, getDiagnosticReport } from './messaging';

const stubChrome = (response: unknown, reject = false) => {
  const sendMessage = reject
    ? vi.fn().mockRejectedValue(new Error('no receiver'))
    : vi.fn().mockResolvedValue(response);
  const download = vi.fn().mockResolvedValue(1);
  vi.stubGlobal('chrome', { runtime: { sendMessage }, downloads: { download } });
  return { sendMessage, download };
};

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('messaging: diagnostics and logs', () => {
  it('returns the report on success', async () => {
    stubChrome({ ok: true, report: 'REPORT' });
    expect(await getDiagnosticReport()).toBe('REPORT');
  });

  it('throws when the worker refuses', async () => {
    stubChrome({ ok: false, code: 'UNKNOWN', message: 'forbidden' });
    await expect(getDiagnosticReport()).rejects.toThrow('forbidden');
    await expect(clearLogs()).rejects.toThrow('forbidden');
  });

  it('throws on a transport failure or empty response', async () => {
    stubChrome(undefined, true);
    await expect(getDiagnosticReport()).rejects.toThrow();
    stubChrome(undefined);
    await expect(clearLogs()).rejects.toThrow();
  });
});

describe('diagnostic actions', () => {
  it('copy rejects when the worker refuses (no empty clipboard write)', async () => {
    stubChrome({ ok: false, code: 'UNKNOWN', message: 'forbidden' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyDiagnosticReport()).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copy rejects when the clipboard rejects', async () => {
    stubChrome({ ok: true, report: 'R' });
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(copyDiagnosticReport()).rejects.toThrow('denied');
  });

  it('download rejects when downloads.download rejects', async () => {
    const { download } = stubChrome({ ok: true, report: 'R' });
    download.mockRejectedValue(new Error('blocked'));
    await expect(downloadDiagnosticReport()).rejects.toThrow('blocked');
  });

  it('download resolves on success', async () => {
    const { download } = stubChrome({ ok: true, report: 'R' });
    await downloadDiagnosticReport();
    expect(download).toHaveBeenCalledOnce();
  });
});
