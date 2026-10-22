/**
 * The app's files, kept in this browser.
 *
 * Every workbook is an ordinary file in an IndexedDB-backed store that behaves
 * like a small drive: folders, paths, sizes, timestamps and stable ids that
 * survive renames. No account, no server, no network.
 *
 * The store can be swapped for tests with `setStore()`; by default it opens the
 * `sheets-files` database (one object store of nodes, blobs included).
 */

export const DB_NAME = 'sheets-files';
const STORE = 'nodes';
const DB_VERSION = 1;

const notFound = (path) => Object.assign(new Error(`${path} does not exist`), { code: 'subject_does_not_exist' });
const exists = (path) => Object.assign(new Error(`${path} already exists`), { code: 'already_exists' });

/** Trim, drop empty and `.` segments, refuse to climb above the root. */
export function normalizePath(path) {
  const parts = [];
  for (const part of String(path ?? '').replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { parts.pop(); continue; }
    parts.push(part);
  }
  return parts.join('/');
}

const parentOf = (path) => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); };
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const now = () => Date.now();

function itemOf(node) {
  return {
    path: node.path,
    name: node.name,
    is_dir: !!node.dir,
    size: node.dir ? null : node.size ?? 0,
    modified: node.modified ?? 0,
    created: node.created ?? 0,
    uid: node.uid || null,
  };
}

/* ---------- IndexedDB ---------- */

let dbPromise = null;
let customStore = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser has no local storage database')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'path' });
        store.createIndex('parent', 'parent');
        store.createIndex('uid', 'uid', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the local file store'));
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = run(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The local file store refused the change'));
  }));
}

const reqResult = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function rawGet(path) {
  return openDB().then((db) => reqResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(path)));
}

function rawPut(node) {
  return openDB().then((db) => reqResult(db.transaction(STORE, 'readwrite').objectStore(STORE).put(node)));
}

function rawDelete(path) {
  return openDB().then((db) => reqResult(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(path)));
}

/* ---------- Test seam ---------- */

/**
 * Replace the drive with any object that has async get(path), put(node),
 * delete(path) and children(path) methods. Passing null restores IndexedDB.
 */
export function setStore(store) {
  customStore = store;
}

const drive = () => customStore || null;

const childrenOf = async (path) => {
  const d = drive();
  if (d) return d.children(path);
  const db = await openDB();
  const index = db.transaction(STORE, 'readonly').objectStore(STORE).index('parent');
  const rows = await reqResult(index.getAll(path));
  return rows;
};

const getNode = async (path) => {
  const d = drive();
  if (d) return d.get(path);
  return rawGet(path);
};

const putNode = async (node, options = {}) => {
  const d = drive();
  if (d) { await d.put(node, options); return; }
  await rawPut(node);
};

const removeNode = async (path) => {
  const d = drive();
  if (d) { await d.delete(path); return; }
  await rawDelete(path);
};

/* ---------- Folders and files ---------- */

async function ensureParents(path, create) {
  const parent = parentOf(path);
  if (!parent) return;
  const node = await getNode(parent);
  if (node?.dir) return;
  if (!create) throw notFound(parent);
  await mkdir(parent);
}

export async function mkdir(path) {
  const clean = normalizePath(path);
  if (!clean) return itemOf({ path: '', name: '', dir: true, modified: now(), created: now() });
  const existing = await getNode(clean);
  if (existing) {
    if (!existing.dir) throw exists(clean);
    return itemOf(existing);
  }
  await ensureParents(clean, true);
  const node = { path: clean, name: nameOf(clean), parent: parentOf(clean), dir: true, uid: crypto.randomUUID(), created: now(), modified: now() };
  await putNode(node);
  return itemOf(node);
}

export async function readdir(path) {
  const clean = normalizePath(path);
  const d = drive();
  if (d.readdir) return d.readdir(clean);
  const folder = clean ? await getNode(clean) : { dir: true };
  // A folder's own record is a convenience: its children are the truth (a store seeded with
  // files only, as tests do, still lists them).
  if (folder && !folder.dir) throw Object.assign(new Error(`${clean} is a file`), { code: 'not_a_directory' });
  const rows = await childrenOf(clean);
  if (!rows.length) throw notFound(clean);
  return rows.map(itemOf);
}

export async function read(path) {
  const clean = normalizePath(path);
  const d = drive();
  if (d.read) return d.read(clean);
  const node = await getNode(clean);
  if (!node) throw notFound(clean);
  if (node.dir) throw Object.assign(new Error(`${clean} is a folder`), { code: 'is_a_directory' });
  return node.blob ?? new Blob([]);
}

// Two saves of two new files can choose the same available name at the same moment: choosing a
// name for a de-duplicated write is one step, and the name stays claimed until the write lands.
let naming = Promise.resolve();
const claimed = new Set();

function claim(clean) {
  const next = naming.then(() => uniqueName(clean), () => uniqueName(clean));
  naming = next.then(() => {}, () => {});
  return next;
}

async function uniqueName(clean) {
  const dot = nameOf(clean).lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, clean.length - nameOf(clean).length + dot) : clean;
  const ext = dot > 0 ? clean.slice(stem.length) : '';
  let candidate = clean;
  let n = 1;
  while (claimed.has(candidate) || await getNode(candidate)) candidate = `${stem} (${n++})${ext}`;
  claimed.add(candidate);
  return candidate;
}

export async function write(path, blob, { overwrite = true, dedupeName = false, createMissingParents = true } = {}) {
  let clean = normalizePath(path);
  if (!clean) throw new Error('A file needs a name');
  if (createMissingParents) await ensureParents(clean, true);
  let existing = await getNode(clean);
  if (existing?.dir) throw Object.assign(new Error(`${clean} is a folder`), { code: 'is_a_directory' });
  if (dedupeName) {
    if (existing && !overwrite) {
      clean = await claim(clean);
      existing = null;
    } else if (!existing) {
      clean = await claim(clean);
    }
  } else if (existing && !overwrite) {
    throw exists(clean);
  }
  try {
    return await putFile(clean, blob, existing, overwrite);
  } finally {
    claimed.delete(clean);
  }
}

async function putFile(clean, blob, existing, overwrite) {
  const node = {
    path: clean,
    name: nameOf(clean),
    parent: parentOf(clean),
    dir: false,
    blob,
    size: blob?.size ?? 0,
    uid: existing?.uid || crypto.randomUUID(),
    created: existing?.created ?? now(),
    modified: now(),
  };
  await putNode(node, { overwrite });
  return itemOf(node);
}

export async function stat(pathOrUid) {
  if (pathOrUid && typeof pathOrUid === 'object') {
    const uid = pathOrUid.uid;
    const d = drive();
    let node = null;
    if (d) node = d.getByUid ? await d.getByUid(uid) : null;
    else {
      const db = await openDB();
      const index = db.transaction(STORE, 'readonly').objectStore(STORE).index('uid');
      node = (await reqResult(index.getAll(uid)))[0] || null;
    }
    if (!node) throw notFound(uid);
    return itemOf(node);
  }
  const clean = normalizePath(pathOrUid);
  const node = await getNode(clean);
  if (!node) throw notFound(clean);
  return itemOf(node);
}

export async function remove(path, { recursive = false } = {}) {
  const clean = normalizePath(path);
  const node = await getNode(clean);
  if (!node) throw notFound(clean);
  if (node.dir) {
    const kids = await childrenOf(clean);
    if (kids.length && !recursive) throw Object.assign(new Error(`${clean} is not empty`), { code: 'directory_not_empty' });
    for (const kid of kids) await remove(kid.path, { recursive: true });
  }
  await removeNode(clean);
}

export async function rename(path, newName) {
  const clean = normalizePath(path);
  const node = await getNode(clean);
  if (!node) throw notFound(clean);
  const name = String(newName ?? '').replaceAll('/', ' ').trim();
  if (!name) throw new Error('A file needs a name');
  const target = parentOf(clean) ? `${parentOf(clean)}/${name}` : name;
  if (target === clean) return itemOf(node);
  const d = drive();
  if (d?.rename) return d.rename(clean, name);
  if (await getNode(target)) throw exists(target);
  // A folder takes its whole subtree with it, keeping each child's id and timestamps.
  const subtree = [];
  const collect = async (from, to) => {
    const current = await getNode(from);
    if (!current) return;
    subtree.push({ node: current, path: to });
    if (current.dir) for (const kid of await childrenOf(from)) await collect(kid.path, `${to}/${kid.name}`);
  };
  await collect(clean, target);
  for (const { node: moved } of subtree) await removeNode(moved.path);
  for (const { node: moved, path: to } of subtree) {
    moved.path = to;
    moved.name = nameOf(to);
    moved.parent = parentOf(to);
    moved.modified = now();
    await putNode(moved);
  }
  return itemOf(subtree[0].node);
}

/** Every path in the store (folders first is not guaranteed). Used for ownership sweeps. */
export async function allPaths() {
  const d = drive();
  if (d) return d.paths();
  const db = await openDB();
  const rows = await reqResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  return rows.map((r) => r.path);
}
