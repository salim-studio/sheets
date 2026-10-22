import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { closeAllModals, openModal } from './ui/modal.js';
import { closeMenu } from './ui/menu.js';
import { session } from './lib/session.js';
import * as P from './lib/platform.js';
import { Doc } from './lib/doc.js';
import { sampleWorkbook } from './core/sample.js';
import { isSheetsFile } from './core/filetypes.js';
import { templateById } from './core/templates.js';
import { rememberRecent, forgetRecent } from './lib/recent.js';
import { homeView } from './views/home.js';
import { editorView } from './views/editor.js';
import { parseAppHash, editHash } from './lib/links.js';
import { appOptions, appOption, syncAppOptions } from './lib/app-options.js';
import { installAppOptions } from './lib/apply-options.js';

const appRoot = document.getElementById('app');
let current = null; // { kind: 'home' | 'editor' | 'gate', view }
let leaving = null; // the editor being flushed on the way to another screen, while `current` is already cleared

/* ---------- Routing ---------- */

/** The sheets list. Opening the app lands in a new sheet instead. */
export const HOME = '#/home';

function parseHash() {
  return parseAppHash(location.hash);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function unmount() {
  // Drop the reference first so a save finishing during flush does not rewrite the URL of the view being left.
  const prev = current;
  current = null;
  if (prev?.kind === 'editor') {
    leaving = prev.view;
    let flushed;
    try { flushed = await prev.view.flush(); } finally { leaving = null; }
    if (!flushed) {
      current = prev;
      const path = prev.view.doc.path;
      history.replaceState(null, '', path ? `#/edit/${encodeURIComponent(path)}` : '#/new');
      return false;
    }
  }
  prev?.view.destroy?.();
  closeMenu();
  closeAllModals();
  return true;
}

/**
 * Edits made without a file have nowhere to go when the editor closes:
 * 'stay', or 'leave' (the local draft keeps them, unless this browser could
 * not keep one: `kept` false says so, since leaving then loses them).
 */
export function leaveWithoutSessionDialog({ kept = true } = {}) {
  return new Promise((resolve) => {
    const content = el('div', {},
      el('p.modal-text', {}, kept
        ? 'This sheet is not saved as a file yet. Leave and your edits stay on this device, where you can recover them from Unsaved sheets on the home screen.'
        : 'This sheet is not saved anywhere yet, and this browser could not keep a copy of it either. Leave and lose it.'),
      el('div.row.row-end', { style: { flexWrap: 'wrap' } },
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Keep editing'),
        el('button.btn.btn-danger', { type: 'button', onclick: () => { resolve('leave'); modal.close(); } }, 'Leave without saving')));
    const modal = openModal({ title: 'Save before leaving?', content, onClose: () => resolve('stay') });
  });
}

/** The offline strip, when shown, stays above whichever screen is mounted. */
let offlineBanner = null;
function show(node) {
  appRoot.replaceChildren(...[offlineBanner, node].filter(Boolean));
}

function mount(kind, view) {
  current = { kind, view };
  document.body.dataset.view = kind; // styling that depends on the screen (where toasts sit)
  show(view.el);
}

function showLoading(label = 'Opening…') {
  // The spinner says nothing and nothing takes the focus here, so the wait is carried by a live
  // region: the line goes up empty with the screen and is written a moment later, which is what a
  // screen reader reads out. Without it "Opening…" and "Importing <name>…" passed in silence.
  const message = el('p.auth-sub', { role: 'status', style: { marginTop: '14px' } });
  show(el('div.auth-view', {},
    el('div.auth-card', {},
      el('span.spin', { html: icon('spinner', 28), style: { color: 'var(--ink-3)' } }),
      message)));
  message.textContent = label;
}

const nav = {
  goHome: () => go(HOME),
  openPath: (path, { reload = false } = {}) => {
    const hash = `#/edit/${encodeURIComponent(path)}`;
    if (reload) { history.replaceState(null, '', hash); route({ reload: true }); }
    else go(hash);
  },
  // By its id, so a file moved or renamed since it was remembered opens where it is now.
  openFile: (uid) => go(`#/file/${encodeURIComponent(uid)}`),
  newDoc: () => go('#/new'),
  sampleDoc: () => go('#/sample'),
  templateDoc: (id) => go(`#/template/${encodeURIComponent(id)}`),
  importFile: (file) => route({ file }),
  recoverDraft: (draftKey) => route({ draftKey }),
};

function openEditor(doc, initialRange = null) {
  const view = editorView({ doc, ...nav, initialRange, leaveDialog: () => leaveWithoutSessionDialog({ kept: doc.draftKept !== false }) });
  mount('editor', view);
  // The record keeps the file's own name; the list strips the extension itself, so "Q3.5" keeps its ".5".
  if (doc.path) rememberRecent(doc.file);
  // Once an unsaved document gets a file, the URL follows so a reload reopens it.
  doc.addEventListener('path', (e) => {
    if (e.detail?.oldPath) forgetRecent(e.detail.oldPath); // the old address no longer opens anything
    if (doc.path && current?.view === view) {
      history.replaceState(null, '', `#/edit/${encodeURIComponent(doc.path)}`);
      rememberRecent(doc.file);
    }
  });
  if (doc.path) history.replaceState(null, '', `#/edit/${encodeURIComponent(doc.path)}`);
}

let routing = false;
let pendingRoute = null;
async function route({ reload = false, file = null, draftKey = null } = {}) {
  if (routing) { pendingRoute = { hash: location.hash, reload, file, draftKey }; return; }
  routing = true;
  try {
    const { route: r, path, id, range } = parseHash();
    if (!file && !draftKey && !reload && current?.kind === 'editor' && r === 'edit' && P.samePath(current.view.doc.path, path)) {
      // The same document with a range in the address: jump there.
      if (range) { current.view.goTo(range); history.replaceState(null, '', `#/edit/${encodeURIComponent(path)}`); }
      return;
    }
    if (!await unmount()) {
      // The user chose to stay: a navigation that arrived while the question was open (Back pressed
      // again, say) was asked for before the answer, and must not put the question a second time. A
      // file dropped or a reload asked for meanwhile is a deliberate move on the app itself, and stands.
      if (pendingRoute && !pendingRoute.file && !pendingRoute.draftKey && !pendingRoute.reload) pendingRoute = null;
      return;
    }
    if (draftKey) {
      // A recovered draft has no file yet: the address must not keep naming the document that was open before.
      history.replaceState(null, '', '#/new');
      try { openEditor(Doc.fromDraft(draftKey)); }
      catch (e) { toast(e?.message || 'Could not recover the sheets', { icon: 'alert', duration: 5000 }); go(HOME); }
      return;
    }
    // Device imports share the route queue: a navigation during a slow read
    // must still flush and destroy the imported editor before replacing it.
    if (file) {
      showLoading(`Importing ${file.name}…`);
      try {
        const imported = await Doc.fromBrowserFile(file);
        history.replaceState(null, '', '#/new'); // the imported document has no file yet
        openEditor(imported);
      } catch (e) {
        console.error(e);
        toast(`Could not read ${file.name}`, { icon: 'alert', duration: 5000 });
        go(HOME);
      }
      return;
    }
    if (r === 'home') {
      mount('home', homeView(nav));
      document.title = 'Sheets';
      P.setWindowTitle('Sheets');
      return;
    }
    // A new workbook starts as the options say: its font, how many sheets, its view and calculation.
    if (r === 'new') { openEditor(Doc.blank({ excel: true, start: appOptions() })); return; }
    if (r === 'template') {
      const template = templateById(id);
      if (!template) { go(HOME); return; }
      if (template.id === 'blank') { openEditor(Doc.blank({ excel: true, start: appOptions() })); return; }
      const wb = template.build();
      const doc = new Doc({ wb, name: template.name });
      wb.dirty = true;
      doc._changed('cells');
      openEditor(doc);
      return;
    }
    if (r === 'sample') {
      const wb = sampleWorkbook();
      const doc = new Doc({ wb, name: 'Sample budget' });
      wb.dirty = true;
      doc._changed('cells');
      openEditor(doc);
      return;
    }
    if (r === 'file') {
      // A link may name a file by its id: it is looked up wherever it lives now.
      showLoading();
      let found;
      try { found = await P.statByUid(id); }
      catch (e) {
        // A refusal says the file is not this user's to open; anything else (offline, say) is no answer
        // about the file, and must not be told as one.
        const code = e?.code || e?.error?.code;
        if (code === 'access_denied' || code === 'forbidden') found = null;
        else {
          console.error(e);
          toast('Could not open the file', { icon: 'alert', duration: 5000 });
          go(HOME);
          return;
        }
      }
      if (!found?.path || found.is_dir || P.inTrash(found.path)) {
        toast('That sheet does not exist', { icon: 'alert', duration: 5000 });
        go(HOME);
        return;
      }
      // Through the route queue, so that a navigation made while the id was looked up wins.
      pendingRoute ??= { hash: editHash(found.path, range) };
      return;
    }
    showLoading();
    try {
      const doc = await Doc.fromPath(path);
      if (!doc.path) {
        // The file is gone, but edits kept on this device open as a new sheet.
        forgetRecent(path);
        history.replaceState(null, '', '#/new');
        toast('That file no longer exists. Unsaved changes kept on this device were opened as a new sheet', { icon: 'info', duration: 6000 });
      } else if (!P.samePath(doc.path, path)) forgetRecent(path); // the file was found where the drive keeps it now
      openEditor(doc, range);
    } catch (e) {
      console.error(e);
      toast(P.isNotFound(e) ? 'That file no longer exists' : 'Could not open the file', { icon: 'alert', duration: 5000 });
      if (P.isNotFound(e)) forgetRecent(path);
      go(HOME);
    }
  } finally {
    routing = false;
    if (pendingRoute) {
      const next = pendingRoute;
      pendingRoute = null;
      // Opening a document can rewrite the hash. Restore the latest requested
      // address before processing the navigation that arrived during the read.
      history.replaceState(null, '', next.hash || '#/new');
      await route({ reload: next.reload, file: next.file, draftKey: next.draftKey });
    }
  }
}

/* ---------- Boot ---------- */

/** The app opens straight into a new sheet. Files live on this device. */
async function start() {
  setupFileDrop();
  await boot();
}

let booted = false;
async function boot() {
  showLoading('Loading…');
  await session.init();
  // The person's options (File ▸ Options).
  installAppOptions();
  await Promise.race([syncAppOptions().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 800))]);
  // Opened with no address, the app lands on a new workbook, or on the start screen when the options ask for it.
  if (appOption('startScreen') && /^#?\/?$/.test(location.hash)) history.replaceState(null, '', HOME);
  booted = true;
  window.addEventListener('hashchange', route);
  // A file dropped on the loading screen opens now that there is somewhere to open it.
  const dropped = droppedFile;
  droppedFile = null;
  await route(dropped ? { file: dropped } : undefined);
  setupOfflineBanner();
}

/** A file dropped before the app was up, held until there is somewhere to open it. */
let droppedFile = null;

/**
 * A file dropped anywhere on the window opens: over a dialog, over the
 * sign-in screen, or over the sheet, not only over the part of the page the
 * current screen happens to cover. Left to itself the browser would leave the
 * app to show the dropped file, taking unsaved work with it, so a drag
 * carrying files is always taken over here.
 */
function setupFileDrop() {
  const carriesFile = (e) => !!e.dataTransfer?.types?.includes('Files');
  const unhighlight = () => {
    document.body.classList.remove('dropping', 'dropping-local');
    current?.view.dragOver?.(null);
  };
  window.addEventListener('dragover', (e) => {
    if (!carriesFile(e)) return; // text dragged into a field stays the browser's to handle
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('dropping');
    // A part of the screen that takes the file for itself (the AI assistant) marks itself, in place of the window.
    document.body.classList.toggle('dropping-local', !!(booted && current?.view.dragOver?.(e.clientX, e.clientY)));
  });
  // While the file is over the app every element is a drop target, so only
  // leaving the window (no element entered) ends the drag.
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) unhighlight(); });
  window.addEventListener('dragend', unhighlight);
  window.addEventListener('drop', (e) => {
    if (!carriesFile(e)) return;
    e.preventDefault();
    unhighlight();
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) openDroppedFile(files[0], { files, x: e.clientX, y: e.clientY });
  });
}

/** The open sheets takes a dropped file first: an image belongs on the sheet. */
function openDroppedFile(file, where = {}) {
  if (!booted) { droppedFile = file; return; }
  // The drop is a deliberate move on the app itself and outranks whatever is over it.
  closeMenu();
  closeAllModals();
  if (current?.view.acceptDrop) { current.view.acceptDrop(file, where); return; }
  if (isSheetsFile(file.name)) route({ file });
  else toast(`Cannot open ${file.name}. Drop a sheets (.xlsx, .csv, .ods, …)`, { icon: 'info', duration: 3200 });
}

function setupOfflineBanner() {
  const update = () => {
    if (!navigator.onLine && !offlineBanner) {
      offlineBanner = el('div.offline-banner', { role: 'status', html: icon('wifiOff', 15, 2) }, ' Offline. Changes will save when you reconnect');
      appRoot.prepend(offlineBanner);
    } else if (navigator.onLine && offlineBanner) {
      offlineBanner.remove();
      offlineBanner = null;
      current?.view?.doc?.save?.({ auto: true }).catch(() => {});
    }
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

if (import.meta.env?.DEV) window.__ss = { session, get current() { return current; } };

start();
