import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { accountStorageKey } from '../src/lib/account-storage.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeAll(async () => { await workbookToXlsx(new Workbook()); });
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

const consentKey = (path) => `${accountStorageKey('sheets:external')}${path}`;
/** A file at `path`; placed again, it is another file with an id of its own. */
let placed = 0;
async function place(path) {
  const blob = await workbookToXlsx(new Workbook());
  mock.fs.set(path, { blob, size: blob.size, modified: 1, uid: `file-${++placed}` });
}
const opensTrusted = async (path) => (await Doc.fromPath(path)).wb.externalAllowed;

// The decision this browser kept by path answered for whatever file was at that path: a file
// allowed to load outside content, replaced outside the app by another at the same address,
// opened trusted, and the decision was even copied into the account's store under the new file's id.
it('does not trust a different file that took the place of an allowed one', async () => {
  const path = 'Desktop/Report.xlsx';
  await place(path);
  const doc = await Doc.fromPath(path);
  expect(doc.wb.externalAllowed).toBe(false);
  doc.allowExternal();
  expect(await opensTrusted(path)).toBe(true);
  await place(path);
  expect(await opensTrusted(path)).toBe(false);
});

it('honours the record this browser kept for the same file only', async () => {
  const path = 'Desktop/Report.xlsx';
  await place(path);
  (await Doc.fromPath(path)).allowExternal();
  expect(await opensTrusted(path)).toBe(true);
  await place(path);
  expect(await opensTrusted(path)).toBe(false);
});

it('keeps honouring a blocking record kept by path alone, but asks again before trusting on such a record', async () => {
  await place('Sheets/Mine.xlsx');
  localStorage.setItem(consentKey('Sheets/Mine.xlsx'), '0'); // from before file ids were kept
  expect(await opensTrusted('Sheets/Mine.xlsx')).toBe(false);
  await place('Desktop/Other.xlsx');
  localStorage.setItem(consentKey('Desktop/Other.xlsx'), '1');
  expect(await opensTrusted('Desktop/Other.xlsx')).toBe(false);
});

it('carries the file id along when the record follows a rename', async () => {
  await place('Desktop/Shared.xlsx');
  const doc = await Doc.fromPath('Desktop/Shared.xlsx');
  doc.allowExternal();
  expect(await doc.rename('Renamed')).toBeNull();
  expect(await opensTrusted('Desktop/Renamed.xlsx')).toBe(true);
});
