// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeView } from '../src/views/home.js';
import * as P from '../src/lib/platform.js';
import { closeMenu } from '../src/ui/menu.js';
import { installMockPuter } from './helpers/mock-puter.js';

vi.mock('../src/lib/session.js', () => ({ session: { settings: {}, username: 'Test user', signedOut: false, addEventListener() {}, removeEventListener() {} } }));
vi.mock('../src/lib/recent.js', () => ({ refreshRecent: async () => [], recentFiles: () => [], forgetRecent() {} }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); document.body.replaceChildren(); });
afterEach(() => {
  closeMenu();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('home screen lifecycle', () => {
  it('ignores a file list that arrives after the user has left the home screen', async () => {
    let resolve;
    vi.spyOn(P, 'listFiles').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = homeView({});
    document.body.append(view.el);
    view.destroy?.();
    view.el.remove();
    resolve([{ path: 'Sheets/Late.xlsx', name: 'Late.xlsx' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.el.querySelector('.file-name')).toBeNull();
  });

  it('keeps the newest file list when a previous request finishes late', async () => {
    let resolve;
    vi.spyOn(P, 'listFiles')
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce([{ path: 'Sheets/New.xlsx', name: 'New.xlsx' }]);
    const view = homeView({});
    document.body.append(view.el);
    await view.reload();
    resolve([{ path: 'Sheets/Old.xlsx', name: 'Old.xlsx' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.el.querySelector('.file-name').textContent).toBe('New');
    view.destroy?.();
  });
});

describe('duplicating files from the home screen', () => {
  it.each(['xlsx', 'csv'])('does not overwrite a %s copy created after the list loaded', async (ext) => {
    const path = `Sheets/Budget.${ext}`;
    const racedPath = `Sheets/Budget copy.${ext}`;
    const copyPath = `Sheets/Budget copy (1).${ext}`;
    const otherFile = new Blob(['Keep this other workbook']);
    const { fs } = installMockPuter();
    fs.set(path, { blob: new Blob(['abc']), size: 3, modified: 1 });
    vi.spyOn(P, 'listFiles').mockResolvedValue([{ path, name: `Budget.${ext}`, size: 3, modified: 1 }]);
    vi.spyOn(P, 'readFile').mockImplementation(async () => {
      fs.set(racedPath, { blob: otherFile, size: otherFile.size });
      return new Uint8Array([1, 2, 3]);
    });
    const view = homeView({});
    document.body.append(view.el);
    await vi.advanceTimersByTimeAsync(0);
    view.el.querySelector('.file-menu-btn').click();
    [...document.querySelectorAll('.menu-item')].find((button) => button.textContent === 'Duplicate').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(fs.get(racedPath).blob).toBe(otherFile);
    expect(fs.get(copyPath)?.size).toBe(3);
  });
});
