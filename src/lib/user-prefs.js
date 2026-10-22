/**
 * Preferences that belong to the person, not to a sheet (AutoCorrect's lists, the custom dictionary):
 * kept in this browser, so each person on a shared browser has their own.
 *
 * Reading is synchronous, from this browser; syncPref resolves to the value in force.
 */
import { accountStorageKey } from './account-storage.js';
import { kvGet, kvSet } from './platform.js';

/** The store is these browser preferences; kv is the same storage the platform layer keeps. */
const canUseKv = () => true;

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const localKey = (name) => `${accountStorageKey(`sheets:pref-${name}`)}value`;
const kvKey = (name) => `sheets:pref:${name}`;

/** The stored value ({ at, value } on disk), or `fallback`. */
export function loadPref(name, fallback = null) {
  try {
    const raw = JSON.parse(storage()?.getItem(localKey(name)) || 'null');
    return raw && typeof raw === 'object' && 'value' in raw ? raw.value : fallback;
  } catch { return fallback; }
}

/** Keep `value` here. */
export function savePref(name, value) {
  const record = { at: Date.now(), value };
  try { storage()?.setItem(localKey(name), JSON.stringify(record)); } catch { /* storage unavailable */ }
  if (canUseKv()) kvSet(kvKey(name), JSON.stringify(record));
  return value;
}

/** Keep the newest of the browser's copy and the store's; resolves to the value in force. */
export async function syncPref(name, fallback = null) {
  if (!canUseKv()) return loadPref(name, fallback);
  let remote = null;
  try { const raw = await kvGet(kvKey(name)); remote = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { remote = null; }
  let local = null;
  try { local = JSON.parse(storage()?.getItem(localKey(name)) || 'null'); } catch { local = null; }
  if (remote && typeof remote === 'object' && 'value' in remote && (!local || (remote.at || 0) > (local.at || 0))) {
    try { storage()?.setItem(localKey(name), JSON.stringify(remote)); } catch { /* storage unavailable */ }
    return remote.value;
  }
  return local && 'value' in local ? local.value : fallback;
}
