import { IGNORED_DIRECTORY, LIBRARY_FILES, type FileLike } from '../library';

// Chromium's File System Access API: pick a folder once, walk only what we need (no
// node_modules, no "upload 50,000 files?" prompt), and keep the handle for the next visit.
type Permission = 'granted' | 'denied' | 'prompt';
type PermittedHandle = FileSystemDirectoryHandle & {
  queryPermission?(options: { mode: 'read' }): Promise<Permission>;
  requestPermission?(options: { mode: 'read' }): Promise<Permission>;
};
type Picker = (options?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;

export const canPickFolder = () => typeof (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker === 'function';
export const pickFolder = () => (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: 'openspell-library', mode: 'read' });

/** The library files under a folder, with paths relative to (and including) its name. */
export async function libraryFiles(root: FileSystemDirectoryHandle, maxDepth = 8): Promise<FileLike[]> {
  const found: FileLike[] = [];
  async function walk(dir: FileSystemDirectoryHandle, path: string, level: number) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') { if (level < maxDepth && !IGNORED_DIRECTORY.test(entry.name)) await walk(entry as FileSystemDirectoryHandle, `${path}/${entry.name}`, level + 1); }
      else if ((LIBRARY_FILES as readonly string[]).includes(entry.name)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        found.push({ name: entry.name, webkitRelativePath: `${path}/${entry.name}`, text: () => file.text() });
      }
    }
  }
  await walk(root, root.name, 0);
  return found;
}
/** Ask for read access again (needs a click on a later visit). */
export async function permitted(handle: FileSystemDirectoryHandle, ask: boolean) {
  const h = handle as PermittedHandle;
  if (!h.queryPermission) return true;
  if (await h.queryPermission({ mode: 'read' }) === 'granted') return true;
  return ask && !!h.requestPermission && await h.requestPermission({ mode: 'read' }) === 'granted';
}

// The handle survives reloads in IndexedDB. Storage can be unavailable; then it just isn't remembered.
const DB = 'openspell-studio', STORE = 'handles', KEY = 'library';
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
}
async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  return new Promise<T>((resolve, reject) => { const request = run(db.transaction(STORE, mode).objectStore(STORE)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }).finally(() => db.close());
}
export async function rememberFolder(handle: FileSystemDirectoryHandle) { try { await transact('readwrite', s => s.put(handle, KEY)); } catch { /* not remembered */ } }
export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | undefined> { try { return await transact('readonly', s => s.get(KEY)) ?? undefined; } catch { return undefined; } }
export async function forgetFolder() { try { await transact('readwrite', s => s.delete(KEY)); } catch { /* nothing stored */ } }
