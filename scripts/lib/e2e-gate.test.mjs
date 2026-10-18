import { describe, expect, it } from 'vitest';
import { planE2e } from './e2e-gate.mjs';

describe('planE2e', () => {
  it('runs the suite when Chromium is present', () => {
    expect(planE2e({ skip: false, chromiumInstalled: true })).toEqual({ action: 'run' });
  });

  it('fails with an actionable message when Chromium is missing', () => {
    const plan = planE2e({ skip: false, chromiumInstalled: false });
    expect(plan.action).toBe('fail');
    expect(plan.message).toContain('npm run e2e:install');
    expect(plan.message).toContain('--skip-e2e');
  });

  it('skips loudly with --skip-e2e, even when Chromium is missing', () => {
    for (const chromiumInstalled of [true, false]) {
      const plan = planE2e({ skip: true, chromiumInstalled });
      expect(plan.action).toBe('skip');
      expect(plan.message).toContain('IGNORÉS');
    }
  });
});
