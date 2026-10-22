import { afterEach, beforeEach, expect, it } from 'vitest';
import * as P from '../src/lib/platform.js';
import { Doc } from '../src/lib/doc.js';
import { draftKey, saveDraft, loadDraft } from '../src/lib/drafts.js';
import { listVersions, versionsFolder } from '../src/lib/versions.js';
import { recentFiles, rememberRecent } from '../src/lib/recent.js';
import { accountStorageKey } from '../src/lib/account-storage.js';
import { Workbook } from '../src/core/workbook.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

const text = (draft) => draft?.workbook.sheets[0].cells['0,0'].v;
const consentKey = (path) => `${accountStorageKey('sheets:external')}${path}`;

// Everything keyed by a file's address (its draft, the outside-content decision, its history folder, the
// recent list) must agree on one spelling: the address the app lists, which is the app-folder path.
it('keeps a saved document under the address the app lists, so reopening it from the list finds its records', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  expect(await doc.save()).toBe(true);
  expect(doc.path).toBe('Sheets/Untitled sheets.xlsx');
  expect(doc.name).toBe('Untitled sheets');
  const [listed] = await P.listFiles();
  expect(listed.path).toBe(doc.path);
  expect(P.inAppFolder(doc.path)).toBe(true);

  // The outside-content decision is kept under the listed address.
  doc.distrustExternal();
  expect((await Doc.fromPath(listed.path)).wb.externalAllowed).toBe(false);

  // The history is one folder whichever spelling of the address names the file, and a labelled
  // snapshot shows up when the file is opened from the list.
  expect(versionsFolder(doc.path)).toBe(versionsFolder('Sheets/Untitled sheets.xlsx'));
  expect(versionsFolder(doc.file)).toBe(versionsFolder({ path: 'Sheets/Untitled sheets.xlsx', uid: doc.uid }));
  await doc.saveVersion('mark');
  expect((await listVersions({ path: listed.path, uid: listed.uid })).map((v) => v.label)).toContain('mark');

  // A draft of unsaved edits is offered when the file is opened from the list.
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'unsaved');
  expect(doc.writeDraft()).toBe(true);
  doc.destroy();
  const reopened = await Doc.fromPath(listed.path);
  expect(text(reopened.recoverable)).toBe('unsaved');
  reopened.destroy();

  // A file in the app folder is not one "opened elsewhere".
  rememberRecent(listed.path, 'Untitled sheets');
  expect(recentFiles()).toEqual([]);
});

it('carries the records kept under a file\'s address into the open document', async () => {
  const bytes = await Doc.blank().toXlsxBlob();
  await puter.fs.write('Sheets/Budget.xlsx', bytes);
  mock.fs.get('Sheets/Budget.xlsx').modified = 1;
  const precious = new Workbook();
  precious.setInput(precious.activeSheetId, 0, 0, 'never saved');
  expect(saveDraft(draftKey('Sheets/Budget.xlsx'), precious, 'Budget', 'rev-1')).toBe(true);
  localStorage.setItem(consentKey('Sheets/Budget.xlsx'), '0');

  const doc = await Doc.fromPath('Sheets/Budget.xlsx');
  expect(doc.path).toBe('Sheets/Budget.xlsx');
  expect(doc.name).toBe('Budget');
  expect(doc.wb.externalAllowed).toBe(false);
  expect(text(doc.recoverable)).toBe('never saved');
  expect(text(loadDraft(draftKey('Sheets/Budget.xlsx')))).toBe('never saved');
  expect(localStorage.getItem(consentKey('Sheets/Budget.xlsx'))).toBe('0');
  doc.destroy();
});

it('renames and saves a copy of a document under its address', async () => {
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  await doc.save();
  expect(await doc.rename('Plan')).toBeNull();
  expect(doc.path).toBe('Sheets/Plan.xlsx');
  expect((await P.listFiles()).map((f) => f.path)).toEqual([doc.path]);
  expect(await doc.saveAs('Plan copy')).toBeNull();
  expect(doc.path).toBe('Sheets/Plan copy.xlsx');
  expect((await P.listFiles()).map((f) => f.path).sort()).toEqual(['Sheets/Plan copy.xlsx', 'Sheets/Plan.xlsx']);
  doc.destroy();
});

it('tells files in the app folder apart from files elsewhere', async () => {
  await puter.fs.write('Sheets/A.xlsx', new Blob(['a']));
  await P.listFiles();
  expect(P.samePath('Sheets/A.xlsx', 'Sheets/A.xlsx')).toBe(true);
  expect(P.samePath('Sheets/A.xlsx', 'Sheets/B.xlsx')).toBe(false);
  expect(P.samePath(null, 'Sheets/A.xlsx')).toBe(false);
  expect(P.samePath('/alice/Desktop/Sheets/A.xlsx', 'Sheets/A.xlsx')).toBe(false);
  expect(P.inAppFolder('Sheets/sub/A.xlsx')).toBe(false);
  expect(P.inAppFolder('/alice/Desktop/Sheets/A.xlsx')).toBe(false);
  expect(P.inAppFolder('Sheets/A.xlsx')).toBe(true);
});
