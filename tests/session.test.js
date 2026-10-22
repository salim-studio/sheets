// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let session;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  ({ session } = await import('../src/lib/session.js'));
  await session.init();
});
afterEach(() => vi.unstubAllGlobals());

const stored = () => JSON.parse(localStorage.getItem('sheets:settings:v1') || 'null');

describe('session settings', () => {
  it('preserves every preference when updates overlap', async () => {
    await Promise.all([session.setTheme('dark'), session.setLocale('de-DE')]);
    expect(session.settings).toMatchObject({ theme: 'dark', locale: 'de-DE' });
    expect(stored()).toMatchObject({ theme: 'dark', locale: 'de-DE' });
  });

  it('saves rapid theme changes and keeps the latest choice', async () => {
    await Promise.all([session.setTheme('dark'), session.setTheme('light')]);
    expect(session.settings.theme).toBe('light');
    expect(stored().theme).toBe('light');
  });

  it('starts with the theme kept from an earlier visit', async () => {
    localStorage.setItem('sheets:settings:v1', JSON.stringify({ theme: 'dark', locale: 'de-DE' }));
    vi.resetModules();
    ({ session } = await import('../src/lib/session.js'));
    await session.init();
    expect(session.settings).toMatchObject({ theme: 'dark', locale: 'de-DE' });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
