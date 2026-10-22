/**
 * An in-memory drive for document tests.
 *
 * The app's files live in the local store (src/lib/local-fs.js); this installs
 * that store over an in-memory filesystem and also exposes a Puter-shaped
 * facade, so tests written against the old SDK keep seeding files, inspecting
 * them and patching the file calls the app makes.
 */
import { setStore } from '../../src/lib/local-fs.js';

export function installMockPuter({ onWrite } = {}) {
  const nodes = new Map();
  const calls = [];
  const kv = new Map();
  let uids = 0;
  const uid = () => `uid-${++uids}`;
  const clean = (p) => String(p ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  const parentOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
  const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const notFound = (p) => Object.assign(new Error(`${p} does not exist`), { code: 'subject_does_not_exist' });
  const exists = (p) => Object.assign(new Error(`${p} already exists`), { code: 'already_exists' });
  const children = (p) => [...nodes.values()].filter((n) => n.path !== p && n.parent === p);
  const byUid = (u) => [...nodes.values()].find((n) => n.uid === u) || null;
  const itemOf = (n) => ({ path: n.path, name: n.name, is_dir: !!n.dir, size: n.dir ? null : n.size ?? 0, modified: n.modified ?? 0, created: n.created ?? 0, uid: n.uid || null });

  const record = (path, value, dir = false) => {
    const p = clean(path);
    const prev = nodes.get(p);
    return {
      path: p, name: nameOf(p), parent: parentOf(p), dir,
      blob: dir ? undefined : value?.blob ?? prev?.blob ?? new Blob([]),
      size: dir ? undefined : value?.size ?? value?.blob?.size ?? prev?.size ?? 0,
      modified: value?.modified ?? prev?.modified ?? 0,
      created: value?.created ?? prev?.created ?? 0,
      uid: value?.uid ?? prev?.uid ?? uid(),
    };
  };

  const facade = {
    env: 'web',
    auth: { isSignedIn: () => true, getUser: async () => ({ username: 'local', uuid: 'sheets-local' }), signIn: async () => true, signOut() {} },
    kv: {
      get: async (k) => kv.get(k) ?? null,
      set: async (k, v) => { kv.set(k, v); return true; },
      del: async (k) => { kv.delete(k); return true; },
    },
    fs: {
      async mkdir(p) {
        const path = clean(p);
        const existing = nodes.get(path);
        if (existing) {
          if (!existing.dir) throw exists(path);
          return itemOf(existing);
        }
        const n = record(path, null, true);
        nodes.set(path, n);
        calls.push(['mkdir', path]);
        return itemOf(n);
      },
      async readdir(p) {
        const path = clean(p);
        calls.push(['readdir', path]);
        const out = children(path);
        if (!out.length) throw notFound(path);
        return out.map(itemOf);
      },
      async read(p) {
        calls.push(['read', clean(p)]);
        const n = nodes.get(clean(p));
        if (!n) throw notFound(p);
        return n.blob;
      },
      async write(path, blob, { overwrite = true, dedupeName = false } = {}) {
        let p = clean(path);
        if (!overwrite && nodes.has(p)) {
          if (!dedupeName) throw exists(p);
          const dot = nameOf(p).lastIndexOf('.');
          const stem = dot > 0 ? p.slice(0, p.length - nameOf(p).length + dot) : p;
          const ext = dot > 0 ? p.slice(stem.length) : '';
          let n = 1;
          while (nodes.has(p)) p = `${stem} (${n++})${ext}`;
        }
        if (onWrite) onWrite(p);
        calls.push(['write', p]);
        const n = record(p, { blob, size: blob?.size });
        n.modified = Date.now() / 1000;
        nodes.set(p, n);
        return itemOf(n);
      },
      async stat(p) {
        calls.push(['stat', p && typeof p === 'object' ? p.uid : clean(p)]);
        if (p && typeof p === 'object') {
          const n = byUid(p.uid);
          if (!n) throw notFound(p.uid);
          return itemOf(n);
        }
        const n = nodes.get(clean(p));
        if (!n) throw notFound(p);
        return itemOf(n);
      },
      async delete(p, options) {
        calls.push(['delete', clean(p), options]);
        const target = clean(p);
        for (const k of [...nodes.keys()]) if (k === target || k.startsWith(`${target}/`)) nodes.delete(k);
      },
      async rename(p, newName) {
        const from = clean(p);
        if (!nodes.has(from)) throw notFound(from);
        const to = parentOf(from) ? `${parentOf(from)}/${newName}` : String(newName);
        if (nodes.has(to)) throw exists(to);
        calls.push(['rename', from, newName]);
        for (const k of [...nodes.keys()]) {
          if (k !== from && !k.startsWith(`${from}/`)) continue;
          const next = `${to}${k.slice(from.length)}`;
          const moved = { ...nodes.get(k), path: next, name: nameOf(next), parent: parentOf(next), modified: Date.now() / 1000 };
          nodes.delete(k);
          nodes.set(next, moved);
        }
        return itemOf(nodes.get(to));
      },
    },
    ui: { showSaveFilePicker: async () => null },
    workers: { exec: async () => new Response('{}') },
  };
  globalThis.puter = facade;

  setStore({
    get: async (p) => {
      try {
        const item = await facade.fs.stat(p);
        const source = byUid(item.uid) || nodes.get(clean(item.path));
        return {
          path: clean(item.path), name: item.name, parent: parentOf(item.path), dir: !!item.is_dir,
          blob: source?.blob, size: item.size, modified: item.modified, created: item.created ?? 0, uid: item.uid,
        };
      } catch (e) {
        if (e?.code === 'subject_does_not_exist') return null;
        throw e;
      }
    },
    read: async (p) => await facade.fs.read(clean(p)),
    readdir: async (p) => await facade.fs.readdir(clean(p)),
    put: async (n, { overwrite = true } = {}) => {
      if (n.dir) {
        if (!nodes.has(n.path)) await facade.fs.mkdir(n.path);
      } else {
        await facade.fs.write(n.path, n.blob, { overwrite });
      }
      nodes.set(n.path, { ...n, parent: parentOf(n.path) });
    },
    delete: async (p) => { await facade.fs.delete(p); },
    children: async (p) => children(clean(p)),
    rename: async (p, newName) => await facade.fs.rename(p, newName),
    getByUid: async (u) => byUid(u),
    paths: async () => [...nodes.keys()],
  });

  const map = {
    get: (p) => nodes.get(clean(p)),
    set: (p, value) => {
      const path = clean(p);
      nodes.set(path, record(path, value, value == null));
      return map;
    },
    has: (p) => nodes.has(clean(p)),
    delete: (p) => nodes.delete(clean(p)),
    keys: () => [...nodes.keys()],
    entries: () => nodes.entries(),
    get size() { return nodes.size; },
  };
  return { fs: map, calls, kv };
}
