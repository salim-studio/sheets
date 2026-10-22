import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc, UNTITLED } from '../src/lib/doc.js';
import { installMockPuter } from './helpers/mock-puter.js';

let mock;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

// The first save used to stat every existing "Untitled sheets…" file in
// turn to find a free name, and every write (each snapshot included)
// re-created the folder, although the write creates it itself.
it('finds a free name for a new document from one listing, not a look-up per candidate', async () => {
  for (const name of [`${UNTITLED}.xlsx`, `${UNTITLED} 2.xlsx`, `${UNTITLED} 3.xlsx`]) await puter.fs.write(`Sheets/${name}`, new Blob(['taken']));
  const doc = Doc.blank();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'x');
  const before = mock.calls.length;
  expect(await doc.save()).toBe(true);
  const during = mock.calls.slice(before);
  // No candidate name is looked up one by one; the only look-ups are of history folders — the one
  // under the chosen name, which a first save puts aside when a gone file left one behind, and the
  // one this file's own id names, which the snapshot after the save asks for.
  // Parent folders are checked, but no candidate name is looked up one by one.
  expect(during.filter(([op, p]) => op === 'stat' && /\.xlsx$/.test(p) && p !== `Sheets/${UNTITLED} 4.xlsx`)).toEqual([]);
  expect(during.filter(([op, p]) => op === 'readdir' && p === 'Sheets')).toHaveLength(1);
  expect(doc.path).toBe(`Sheets/${UNTITLED} 4.xlsx`);
  expect(doc.name).toBe(`${UNTITLED} 4`);
  expect(mock.fs.get(`Sheets/${UNTITLED}.xlsx`).blob.size).toBe(5);
  doc.destroy();
});
