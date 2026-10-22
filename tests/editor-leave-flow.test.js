// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './helpers/memory-storage.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { session } from '../src/lib/session.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { installMockPuter } from './helpers/mock-puter.js';
import { workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';

let view;
beforeAll(async () => { await workbookToXlsx(new Workbook()); });
beforeEach(async () => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
  installMockPuter();
  puter._signedIn = false;
  puter.auth = {
    isSignedIn: () => puter._signedIn,
    signIn: vi.fn(async () => { puter._signedIn = true; }),
    getUser: async () => (puter._signedIn ? { username: 'nariman', uuid: 'u-1' } : null),
  };
  await session.init();
});
afterEach(() => {
  closeMenu();
  closeAllModals();
  view?.destroy();
  view = null;
  session.state = 'unknown';
  session.user = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.puter;
  document.body.replaceChildren();
});

function setup(leaveDialog = null) {
  const doc = Doc.blank();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn(), leaveDialog });
  document.querySelector('#app').append(view.el);
  return { doc, grid: view.el.querySelector('[role="grid"]') };
}

const menuItem = (text) => [...document.querySelectorAll('.menu-item')].find((item) => item.textContent.includes(text));
const openMenubar = (label) => [...view.el.querySelectorAll('.menubar button')].find((b) => b.textContent.trim() === label).click();


describe('the command palette when the editor closes', () => {
  it('closes with the editor instead of driving a destroyed view', () => {
    const { grid } = setup();
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.querySelector('.palette-root')).not.toBeNull();
    view.destroy();
    view = null;
    expect(document.querySelector('.palette-root')).toBeNull();
  });
});
