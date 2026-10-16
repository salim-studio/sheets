import { expect, it } from 'vitest';
import { IMPORT_EXTENSIONS } from '../src/core/io.js';
import { resolveImportPath } from '../src/core/importrange.js';
import { ensureXlsx } from '../src/lib/puter.js';

it.each(IMPORT_EXTENSIONS)('keeps the supported %s extension for local names and explicit paths', (ext) => {
  for (const suffix of [ext, ext.toUpperCase()]) {
    const name = `Budget 2026${suffix}`;
    expect(resolveImportPath(` ${name} `, 'Sheets', ensureXlsx)).toBe(`Sheets/${name}`);
    expect(resolveImportPath(`Work/${name}`, 'Sheets', ensureXlsx)).toBe(`Work/${name}`);
    expect(resolveImportPath(`/nj/Work/${name}`, 'Sheets', ensureXlsx)).toBe(`/nj/Work/${name}`);
  }
});

// "Reports/Q1.2024" was taken to end in an extension and never got its .xlsx.
it('treats a suffix of digits alone as part of a path\'s name, not an extension', () => {
  expect(resolveImportPath('Reports/Q1.2024', 'Sheets', ensureXlsx)).toBe('Reports/Q1.2024.xlsx');
  expect(resolveImportPath('/nj/Reports/Sales.2026', 'Sheets', ensureXlsx)).toBe('/nj/Reports/Sales.2026.xlsx');
  expect(resolveImportPath('Reports/Q1.2024.xlsx', 'Sheets', ensureXlsx)).toBe('Reports/Q1.2024.xlsx');
  expect(resolveImportPath('Reports/Archive.7z', 'Sheets', ensureXlsx)).toBe('Reports/Archive.7z');
});

it('retains extension inference and cleanup for workbook titles', () => {
  expect(resolveImportPath('Budget', 'Sheets', ensureXlsx)).toBe('Sheets/Budget.xlsx');
  expect(resolveImportPath('Budget.v1', 'Sheets', ensureXlsx)).toBe('Sheets/Budget.v1.xlsx');
  expect(resolveImportPath('Budget\u0001', 'Sheets', ensureXlsx)).toBe('Sheets/Budget.xlsx');
  expect(resolveImportPath('Budget\u0001.xlsx', 'Sheets', ensureXlsx)).toBe('Sheets/Budget.xlsx');
  expect(resolveImportPath('Work/Budget', 'Sheets', ensureXlsx)).toBe('Work/Budget.xlsx');
  expect(resolveImportPath('Work/Budget.dat', 'Sheets', ensureXlsx)).toBe('Work/Budget.dat');
  expect(resolveImportPath('', 'Sheets', ensureXlsx)).toBeNull();
});
