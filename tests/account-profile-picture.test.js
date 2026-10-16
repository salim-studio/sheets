// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as P from '../src/lib/puter.js';
import { session } from '../src/lib/session.js';
import { renderAccountButton } from '../src/ui/appmenu.js';

const picture = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const user = { username: 'demo', uuid: 'u-1' };
let auth, images;
beforeEach(() => {
  auth = { getProfilePicture: vi.fn().mockResolvedValue(picture), signOut: vi.fn() };
  vi.stubGlobal('puter', { auth });
  session.state = 'in';
  session.user = user;
  images = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((...args) => {
    const element = createElement(...args);
    if (args[0] === 'img') images.push(element);
    return element;
  });
});
afterEach(() => {
  session.state = 'unknown';
  session.user = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('profile picture cache', () => {
  it('shares pending and cached requests across views, then expires after five minutes', async () => {
    vi.useFakeTimers();
    let resolve;
    auth.getProfilePicture.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = P.getProfilePicture(user);
    expect(P.getProfilePicture({ ...user })).toBe(first);
    await Promise.resolve();
    resolve(picture);
    expect(await first).toBe(picture);
    expect(await P.getProfilePicture(user)).toBe(picture);
    expect(auth.getProfilePicture).toHaveBeenCalledExactlyOnceWith();
    vi.advanceTimersByTime(5 * 60_000);
    expect(await P.getProfilePicture(user)).toBe(picture);
    expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'failure'])('caches a %s briefly and retries after a minute', async (outcome) => {
    vi.useFakeTimers();
    if (outcome === 'missing') auth.getProfilePicture.mockResolvedValueOnce(null);
    else auth.getProfilePicture.mockRejectedValueOnce(new Error('offline'));
    expect(await P.getProfilePicture(user)).toBeNull();
    expect(await P.getProfilePicture(user)).toBeNull();
    expect(auth.getProfilePicture).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(await P.getProfilePicture(user)).toBe(picture);
    expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
  });

  it('separates accounts and SDK instances and clears the cache on sign-out', async () => {
    await P.getProfilePicture(user);
    await P.getProfilePicture({ username: 'other', uuid: 'u-2' });
    expect(auth.getProfilePicture).toHaveBeenCalledTimes(2);
    const replacement = { getProfilePicture: vi.fn().mockResolvedValue(null), signOut: vi.fn() };
    vi.stubGlobal('puter', { auth: replacement });
    expect(await P.getProfilePicture(user)).toBeNull();
    P.signOut();
    expect(await P.getProfilePicture(user)).toBeNull();
    expect(replacement.getProfilePicture).toHaveBeenCalledTimes(2);
    expect(replacement.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not ask without an identity and tolerates an absent or older SDK', async () => {
    expect(await P.getProfilePicture(null)).toBeNull();
    expect(auth.getProfilePicture).not.toHaveBeenCalled();
    vi.stubGlobal('puter', { auth: {} });
    expect(await P.getProfilePicture(user)).toBeNull();
    vi.stubGlobal('puter', null);
    expect(await P.getProfilePicture(user)).toBeNull();
  });
});

describe('account avatar', () => {
  it('never shows a name, initial or picture: the face stays a plain figure', async () => {
    const home = document.createElement('button');
    const editor = document.createElement('button');
    renderAccountButton(home);
    renderAccountButton(editor);
    renderAccountButton(home);
    expect(home.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(home.textContent).not.toContain('demo');
    expect(home.getAttribute('aria-label')).toBe('Account menu');
    expect(home.title).toBe('Account');
    expect(editor.querySelector('.user-avatar-anon')).not.toBeNull();
    await Promise.resolve();
    // No profile picture is ever requested for the face.
    expect(auth.getProfilePicture).not.toHaveBeenCalled();
    expect(home.querySelector('img')).toBeNull();
    // Re-renders keep the same anonymous face.
    renderAccountButton(home);
    expect(home.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(home.querySelector('img')).toBeNull();
  });

  it('does not fetch for guests or an unresolved identity', () => {
    const button = document.createElement('button');
    session.state = 'out';
    session.user = null;
    renderAccountButton(button);
    expect(button.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toContain('Not signed in');
    session.state = 'in';
    renderAccountButton(button);
    expect(button.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(button.textContent).not.toContain('P');
    expect(auth.getProfilePicture).not.toHaveBeenCalled();
  });

  it('keeps the anonymous face after signing out', async () => {
    const button = document.createElement('button');
    renderAccountButton(button);
    await Promise.resolve();
    session.state = 'out';
    session.user = null;
    renderAccountButton(button);
    expect(button.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(button.textContent).not.toContain('demo');
  });

  it('keeps the anonymous face after switching accounts', async () => {
    const button = document.createElement('button');
    renderAccountButton(button);
    await Promise.resolve();
    session.user = { username: 'other', uuid: 'u-2' };
    renderAccountButton(button);
    expect(button.querySelector('.user-avatar-anon')).not.toBeNull();
    expect(button.textContent).not.toContain('other');
    expect(button.querySelector('img')).toBeNull();
    expect(auth.getProfilePicture).not.toHaveBeenCalled();
  });
});
