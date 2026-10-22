import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import { memoryStorage } from './helpers/memory-storage.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true }); mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

/** A workbook that reaches out to the web, as .xlsx bytes. */
function reachingOut(formula = '=IMPORTDATA("https://example.com/a.csv")') {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, formula);
  return workbookToXlsx(wb);
}
const place = (path, blob) => mock.fs.set(path, { blob, size: blob.size, modified: 1 });
// Whether a file may load outside content is remembered in this browser, by path and by the
// file's id, so it follows the file through a rename. Everything is local: no account, no sync.
it('keeps a blocked import blocked once it is saved to the app folder', async () => {
  const bytes = await reachingOut();
  const imported = await Doc.fromBrowserFile(new File([await bytes.arrayBuffer()], 'evil.xlsx'));
  expect(imported.wb.externalAllowed).toBe(false);
  expect(await imported.save()).toBe(true);
  expect(imported.path).toBe('Sheets/evil.xlsx');
  const elsewhere = await Doc.fromPath('Sheets/evil.xlsx');
  expect(elsewhere.wb.externalAllowed).toBe(false);
  expect(elsewhere.wb.getValue(elsewhere.wb.activeSheetId, 0, 0)).toEqual({ error: '#BLOCKED!' });
  imported.allowExternal();
  expect((await Doc.fromPath('Sheets/evil.xlsx')).wb.externalAllowed).toBe(true);
  imported.destroy();
});

it('does not trust a file that reaches out just because it turned up in the app folder', async () => {
  place('Sheets/shared-in.xlsx', await reachingOut());
  const doc = await Doc.fromPath('Sheets/shared-in.xlsx');
  expect(doc.wb.externalAllowed).toBe(false);
  expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toEqual({ error: '#BLOCKED!' });
  // Once allowed, the decision holds for the file here.
  doc.allowExternal();
  expect((await Doc.fromPath('Sheets/shared-in.xlsx')).wb.externalAllowed).toBe(true);
  doc.destroy();
});

it('needs no decision for a file in the app folder that does not reach out', async () => {
  place('Sheets/plain.xlsx', await Doc.blank().toXlsxBlob());
  expect((await Doc.fromPath('Sheets/plain.xlsx')).wb.externalAllowed).toBe(true);
  // Every place a formula can live counts, not only cells.
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '1');
  wb.names.push({ name: 'Remote', ref: 'AI("summarise")' });
  place('Sheets/named.xlsx', await workbookToXlsx(wb));
  expect((await Doc.fromPath('Sheets/named.xlsx')).wb.externalAllowed).toBe(false);
  place('Sheets/picture.xlsx', await reachingOut('=IMAGE("https://example.com/p.png")'));
  expect((await Doc.fromPath('Sheets/picture.xlsx')).wb.externalAllowed).toBe(false);
});

it('keeps the decision with the file when it is renamed elsewhere', async () => {
  place('Sheets/Q.xlsx', await reachingOut());
  const doc = await Doc.fromPath('Sheets/Q.xlsx');
  expect(doc.wb.externalAllowed).toBe(false);
  doc.allowExternal();
  doc.destroy();
  await puter.fs.rename('Sheets/Q.xlsx', 'R.xlsx'); // the file keeps its identity
  expect((await Doc.fromPath('Sheets/R.xlsx')).wb.externalAllowed).toBe(true);
});

it('still distrusts files from elsewhere on the drive until allowed, then remembers it here', async () => {
  place('Desktop/shared.xlsx', await Doc.blank().toXlsxBlob());
  expect((await Doc.fromPath('Desktop/shared.xlsx')).wb.externalAllowed).toBe(false);
  const opened = await Doc.fromPath('Desktop/shared.xlsx');
  opened.allowExternal();
  opened.destroy();
  expect((await Doc.fromPath('Desktop/shared.xlsx')).wb.externalAllowed).toBe(true);
});
