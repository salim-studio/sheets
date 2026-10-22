/**
 * The app's platform layer: everything that touches the outside world lives
 * here, so the rest of the code never talks to a browser API directly and the
 * dev harness can swap in a mock.
 *
 *  storage   settings and small records in this browser
 *  files     sheets as real .xlsx files in a local IndexedDB drive
 *  pickers   the browser's Open/Save dialogs, feature-detected
 *  network   reading a public web address for a formula or a picture
 *  ai        a model the user configures, spoken to over an OpenAI-compatible API
 *
 * No account and no server are involved: files are stored on this device and
 * never leave it unless the user downloads them.
 */

import { trackExport } from './analytics.js';
import * as fs from './local-fs.js';
import { canAI, aiChat, aiChatStream, AI_SETTINGS_EVENT } from './ai.js';

export { canAI, aiChat, aiChatStream, AI_SETTINGS_EVENT };

export const FOLDER = 'Sheets';
export const SETTINGS_KEY = 'sheets:settings:v1';

/* ---------- Environment ---------- */

export const hasSDK = () => true;
export const env = () => 'web';
export const isApp = () => false;
export const isSignedIn = async () => true;

/** A stable local identity keeps per-device records in one namespace. */
export const LOCAL_USER = Object.freeze({ username: 'local', uuid: 'sheets-local' });
export const getUser = async () => LOCAL_USER;
export const getProfilePicture = async () => null;
export const signIn = async () => {};
export const signOut = async () => {};
export const onAuth = () => {};

/* ---------- Settings ---------- */

const DEFAULT_SETTINGS = { theme: 'system' };
const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function loadLocalSettings() {
  try {
    const obj = JSON.parse(storage()?.getItem(SETTINGS_KEY) || 'null');
    return { ...DEFAULT_SETTINGS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveLocalSettings(next) {
  try { storage()?.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...next })); } catch { /* storage unavailable */ }
}

export async function loadSettings() {
  return loadLocalSettings();
}

export async function saveSettings(patch, current = {}) {
  const next = { ...DEFAULT_SETTINGS, ...current, ...patch };
  saveLocalSettings(next);
  return next;
}

/* ---------- Small records in this browser ---------- */

const KV_PREFIX = 'sheets:kv:';

export async function kvGet(key) {
  try {
    const raw = storage()?.getItem(KV_PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  try { storage()?.setItem(KV_PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

export async function kvDel(key) {
  try { storage()?.removeItem(KV_PREFIX + key); return true; } catch { return false; }
}

/* ---------- Files ---------- */

export function isNotFound(err) {
  const code = err?.code || err?.error?.code || '';
  const msg = String(err?.message || err?.error?.message || err || '').toLowerCase();
  return code === 'subject_does_not_exist' || code === 'ENOENT' || msg.includes('not found') || msg.includes('does not exist') || msg.includes('no such');
}

export function displayName(path) {
  return String(path || '').split('/').pop();
}

export function sanitizeName(name) {
  const clean = Array.from(String(name || '').replace(/[/\\]/g, ' ').replace(/[\p{Cc}\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]/gu, '').replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, '')).slice(0, 200).join('');
  if (!/[^\s\p{Cf}]/u.test(clean)) return '';
  return clean.replace(/[.\s\p{Cf}]+$/u, '');
}

export function ensureXlsx(name) {
  const clean = sanitizeName(name);
  return /\.xlsx$/i.test(clean) ? clean : `${clean}.xlsx`;
}

let folderReady = null;
function ensureFolder() {
  if (!folderReady) folderReady = fs.mkdir(FOLDER).catch(() => {});
  return folderReady;
}

export async function listFiles() {
  let items;
  try {
    items = await fs.readdir(FOLDER);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  return (items || [])
    .filter((it) => !it.is_dir && /\.(xlsx|xlsm|xls|csv|tsv|ods)$/i.test(it.name))
    .map((it) => ({ name: it.name, path: it.path || `${FOLDER}/${it.name}`, size: it.size ?? 0, modified: it.modified ?? 0, uid: it.uid || null }))
    .sort((a, b) => (b.modified || 0) - (a.modified || 0));
}

export async function listDir(path) {
  try {
    const items = await fs.readdir(path);
    return (items || []).map((it) => ({ name: it.name, path: it.path || `${path}/${it.name}`, size: it.size ?? 0, is_dir: !!it.is_dir, modified: it.modified ?? 0 }));
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

export async function readFile(path) {
  const blob = await fs.read(path);
  return blob.arrayBuffer();
}

export async function writeFile(path, blob, { dedupe = false, overwrite = !dedupe } = {}) {
  if (path.startsWith(`${FOLDER}/`)) await ensureFolder();
  return fs.write(path, blob, { overwrite, dedupeName: dedupe, createMissingParents: true });
}

export async function deleteFile(path, { recursive = false } = {}) {
  await fs.remove(path, { recursive });
}

export async function renameFile(path, newName) {
  return fs.rename(path, newName);
}

export async function statFile(path) {
  try {
    return await fs.stat(path);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function statByUid(uid) {
  try {
    return await fs.stat({ uid });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function fileExists(path) {
  return !!(await statFile(path));
}

/* ---------- One file, one address ---------- */

export function isAbsolutePath(path) {
  return typeof path === 'string' && /^[/~]/.test(path);
}

export const inTrash = () => false;

export function resolvedAbsolutePath() { return null; }

const parentOf = (path) => { const slash = path.lastIndexOf('/'); return slash > 0 ? path.slice(0, slash) : ''; };
const inFolderRelative = (path) => path.startsWith(`${FOLDER}/`) && !path.slice(FOLDER.length + 1).includes('/');

export function inAppFolder(path) {
  return typeof path === 'string' && inFolderRelative(path);
}

export function samePath(a, b) {
  return a === b || (!!a && !!b && inAppFolder(a) && inAppFolder(b) && displayName(a) === displayName(b));
}

export function legacyAppPath(path) {
  if (!inAppFolder(path)) return null;
  const relative = `${FOLDER}/${displayName(path)}`;
  return relative === path ? null : relative;
}

export function canonicalPath(path) {
  return path;
}

export async function resolveAppFolder() {
  return null;
}

export async function uniqueName(base) {
  const stem = base.replace(/\.xlsx$/i, '');
  const taken = new Set((await listDir(FOLDER)).map((it) => it.name));
  let name = `${stem}.xlsx`;
  let n = 2;
  while (taken.has(name)) name = `${stem} ${n++}.xlsx`;
  return name;
}

/* ---------- Pickers ---------- */

const SHEET_ACCEPT = ['.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.ods'];

export function canPickFiles() {
  return typeof document !== 'undefined';
}

export function canSaveFiles() {
  return typeof document !== 'undefined';
}

/**
 * Ask for a file and bring it into the local drive under `Sheets/`. The first
 * open of an outside workbook is a copy, like opening a file on a website:
 * afterwards it lives on this device, where saving edits it in place.
 */
export async function pickFile({ accept = SHEET_ACCEPT } = {}) {
  if (!canPickFiles()) return null;
  const file = await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; input.remove(); resolve(value); };
    input.addEventListener('change', () => done(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
  if (!file) return null;
  await ensureFolder();
  const name = ensureXlsx(sanitizeName(file.name) || 'Untitled');
  const item = await fs.write(`${FOLDER}/${name}`, file, { overwrite: false, dedupeName: true });
  return { path: item.path, name: item.name, item };
}

/** Keep a copy on the device: the browser's download, with the suggested name. */
export async function saveFileAs(blob, suggestedName) {
  downloadBlob(blob, suggestedName);
  return { path: null, name: suggestedName };
}

/* ---------- Network ---------- */

export const MAX_FETCH_BYTES = 20 * 1024 * 1024;
const tooLarge = (url) => Object.assign(new Error(`The response from ${url} is too large (over ${MAX_FETCH_BYTES / (1024 * 1024)} MB)`), { code: 'too-large' });
const notPublic = (url) => Object.assign(new Error(`Cannot fetch ${url}: only addresses on the public internet can be fetched, not this computer's or a private network's`), { code: 'not-public' });

export function isPublicHttpUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[')) return isPublicIPv6(host.slice(1, -1));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPublicIPv4(host.split('.').map(Number));
  return !/^localhost$|\.(?:localhost|local|internal|home\.arpa)$/.test(host);
}

function isPublicIPv4([a, b]) {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return a < 224;
}

function isPublicIPv6(ip) {
  if (ip === '::1' || ip === '::') return false;
  if (/^(?:fe[89ab]|f[cd]|ff)/.test(ip)) return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (!mapped) return true;
  const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return isPublicIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
}

async function fetchResponse(url) {
  if (!isPublicHttpUrl(url)) throw notPublic(url);
  const res = await fetch(url);
  if (!res || (typeof res.ok === 'boolean' && !res.ok)) throw new Error(`Could not fetch ${url}`);
  return res;
}

async function cappedBytes(res, url) {
  if (Number(res.headers?.get?.('content-length')) > MAX_FETCH_BYTES) throw tooLarge(url);
  if (typeof res.body?.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FETCH_BYTES) { Promise.resolve(reader.cancel?.()).catch(() => {}); throw tooLarge(url); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return out;
  }
  const bytes = typeof res.arrayBuffer === 'function' ? new Uint8Array(await res.arrayBuffer()) : new TextEncoder().encode(await res.text());
  if (bytes.byteLength > MAX_FETCH_BYTES) throw tooLarge(url);
  return bytes;
}

export async function fetchText(url) {
  return new TextDecoder().decode(await cappedBytes(await fetchResponse(url), url));
}

export async function fetchBytes(url) {
  return cappedBytes(await fetchResponse(url), url);
}

/* ---------- Window & files ---------- */

export function setWindowTitle(title) {
  try { if (typeof document !== 'undefined') document.title = title; } catch { /* no document */ }
}

export const onLaunchedWithItems = () => {};
export const onWindowClose = () => false;
export const exitApp = () => {};

export function isDirItem(item) {
  return !!(item?.is_dir || item?.isDirectory || item?.isDir || item?.fsentry_is_dir);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  trackExport(filename, 'browser');
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
