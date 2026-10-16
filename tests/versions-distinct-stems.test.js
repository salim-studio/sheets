import { afterEach, beforeEach, expect, it } from 'vitest';
import { versionsFolder, saveVersion, listVersions, removeVersions } from '../src/lib/versions.js';
import { installMockPuter } from './helpers/mock-puter.js';

beforeEach(() => { installMockPuter(); });
afterEach(() => { delete globalThis.puter; });

// File names may hold characters a folder name is stripped of, so "Q3: Forecast.xlsx"
// and "Q3 Forecast.xlsx" used to share one .versions folder: their histories mixed,
// Restore brought back the other file, and pruning or deleting one wiped both.
it('gives a file whose name the folder cannot carry as it is a folder of its own', () => {
  const clean = versionsFolder('Sheets/Q3 Forecast.xlsx');
  expect(clean).toBe('Sheets/.versions/Q3 Forecast');
  const colon = versionsFolder('Sheets/Q3: Forecast.xlsx');
  expect(colon).not.toBe(clean);
  expect(colon).toMatch(/^Sheets\/\.versions\/Q3 Forecast [a-z0-9]+$/);
  expect(colon).toBe(versionsFolder('Sheets/Q3: Forecast.xlsx'));
  expect(versionsFolder('Sheets/Budget?.xlsx')).not.toBe(versionsFolder('Sheets/Budget.xlsx'));
  expect(versionsFolder('Sheets/Budget .xlsx')).not.toBe(versionsFolder('Sheets/Budget.xlsx'));
  expect(versionsFolder('Sheets/Budget.xlsx')).toBe('Sheets/.versions/Budget');
  // A name that is nothing but such characters is not the same file as one called Untitled.
  expect(versionsFolder('Sheets/???.xlsx')).toMatch(/^Sheets\/\.versions\/Untitled [a-z0-9]+$/);
  expect(versionsFolder('Sheets/Untitled.xlsx')).toBe('Sheets/.versions/Untitled');
  expect(versionsFolder('Sheets/Q3: Forecast.csv')).not.toBe(versionsFolder('Sheets/Q3 Forecast.csv'));
});

it('keeps the histories of two such files apart on the drive', async () => {
  await saveVersion('Sheets/Q3 Forecast.xlsx', new Blob(['clean']), 'clean');
  await saveVersion('Sheets/Q3: Forecast.xlsx', new Blob(['colon']), 'colon');
  expect((await listVersions('Sheets/Q3 Forecast.xlsx')).map((v) => v.label)).toEqual(['clean']);
  expect((await listVersions('Sheets/Q3: Forecast.xlsx')).map((v) => v.label)).toEqual(['colon']);
  expect(await removeVersions('Sheets/Q3: Forecast.xlsx')).toBe(true);
  expect((await listVersions('Sheets/Q3 Forecast.xlsx')).map((v) => v.label)).toEqual(['clean']);
  expect(await listVersions('Sheets/Q3: Forecast.xlsx')).toEqual([]);
});
