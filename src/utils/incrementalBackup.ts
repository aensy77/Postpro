import type {
  IncrementalBackupRecord,
  IncrementalDocumentDelta,
  IncrementalStatePatch,
  OpenDocument,
} from '../types';
import type { PersistedAppState } from './storage';

const IDB_NAME = 'postpro_incremental_backups_v1';
const IDB_VERSION = 1;
const STORE_SNAPSHOTS = 'snapshots';
const STORE_HANDLES = 'handles';
const LOCAL_FOLDER_HANDLE_KEY = 'backup_dir_handle';
const LS_FALLBACK_KEY = 'postpro_incremental_backups_fallback_v1';
const MAX_DELTAS_PER_CHAIN = 6;
const MAX_CHAINS_TO_KEEP = 6;

const SECTION_LABELS: Record<string, string> = {
  screen: 'Vista activa',
  onboardingCompleted: 'Estado inicial',
  config: 'Configuración y APIs',
  activeThemeId: 'Tema visual',
  customThemes: 'Temas personalizados',
  functionalPlugins: 'Plugins funcionales',
  apiProviders: 'Proveedores API',
  activeApiProviderId: 'API activa',
  templates: 'Plantillas BBCode',
  openDocuments: 'Documentos / Editor',
  activeDocId: 'Pestaña activa',
  recentProjects: 'Proyectos recientes',
  miniMenuTools: 'Mini menú flotante',
  dockState: 'Distribución de paneles',
  splitRatios: 'Proporciones del espacio',
  isWorkspaceLocked: 'Bloqueo de mesa',
  savedCustomWorkspace: 'Espacio personalizado',
};

const SCALAR_KEYS: Array<keyof PersistedAppState> = [
  'version',
  'screen',
  'onboardingCompleted',
  'config',
  'activeThemeId',
  'customThemes',
  'functionalPlugins',
  'apiProviders',
  'activeApiProviderId',
  'templates',
  'activeDocId',
  'recentProjects',
  'miniMenuTools',
  'dockState',
  'splitRatios',
  'isWorkspaceLocked',
  'savedCustomWorkspace',
];

function stripVolatileFields(state: PersistedAppState): Omit<PersistedAppState, 'lastSavedAt'> {
  const { lastSavedAt: _ignored, ...rest } = state;
  return rest;
}

export function computeStateHash(state: PersistedAppState): string {
  const normalized = JSON.stringify(stripVolatileFields(state));
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length;
  }
}

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
  });
}

function readFallbackList(): IncrementalBackupRecord[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IncrementalBackupRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFallbackList(items: IncrementalBackupRecord[]): void {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(items.slice(-20)));
  } catch {
    // Ignore storage quota errors in fallback
  }
}

export async function listIncrementalBackups(): Promise<IncrementalBackupRecord[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openBackupDb();
    return await new Promise<IncrementalBackupRecord[]>((resolve, reject) => {
      const tx = db!.transaction(STORE_SNAPSHOTS, 'readonly');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = Array.isArray(req.result) ? (req.result as IncrementalBackupRecord[]) : [];
        rows.sort((a, b) => b.createdAt - a.createdAt);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return readFallbackList().sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db?.close();
  }
}

async function replaceAllIncrementalBackups(records: IncrementalBackupRecord[]): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_SNAPSHOTS, 'readwrite');
      const store = tx.objectStore(STORE_SNAPSHOTS);
      store.clear();
      for (const rec of records) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeFallbackList(records);
  } finally {
    db?.close();
  }
}

export async function saveBackupDirectoryHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openBackupDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_HANDLES, 'readwrite');
      const store = tx.objectStore(STORE_HANDLES);
      if (handle) {
        store.put(handle, LOCAL_FOLDER_HANDLE_KEY);
      } else {
        store.delete(LOCAL_FOLDER_HANDLE_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Optional browser persistence
  } finally {
    db?.close();
  }
}

export async function loadSavedBackupDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openBackupDb();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
      const tx = db!.transaction(STORE_HANDLES, 'readonly');
      const req = tx.objectStore(STORE_HANDLES).get(LOCAL_FOLDER_HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function pickLocalBackupDirectory(): Promise<{
  ok: boolean;
  handle?: FileSystemDirectoryHandle;
  folderName?: string;
  error?: string;
}> {
  const pickerFn = (
    window as Window & {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;

  if (!pickerFn) {
    return {
      ok: false,
      error:
        'Tu navegador no permite escritura directa en carpetas locales (usa Chrome/Edge o la bóveda local IndexedDB).',
    };
  }

  try {
    const handle = await pickerFn({ mode: 'readwrite' });
    await saveBackupDirectoryHandle(handle);
    return { ok: true, handle, folderName: handle.name };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') {
      return { ok: false, error: 'Selección de carpeta cancelada.' };
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'No se pudo acceder a la carpeta local desde este entorno.',
    };
  }
}

async function writeRecordToLocalFolder(
  handle: FileSystemDirectoryHandle,
  record: IncrementalBackupRecord
): Promise<{ ok: boolean; fileName?: string; error?: string }> {
  try {
    const permCapable = handle as FileSystemDirectoryHandle & {
      queryPermission?: (desc: { mode: 'readwrite' }) => Promise<PermissionState>;
      requestPermission?: (desc: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (permCapable.queryPermission) {
      let state = await permCapable.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted' && permCapable.requestPermission) {
        state = await permCapable.requestPermission({ mode: 'readwrite' });
      }
      if (state !== 'granted') {
        return { ok: false, error: 'Permiso de escritura denegado para la carpeta local.' };
      }
    }

    const d = new Date(record.createdAt);
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      '-',
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ].join('');

    const fileName =
      record.kind === 'full'
        ? `postpro-backup-full-${stamp}.json`
        : `postpro-backup-inc-${record.sequence}-${stamp}.json`;

    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();

    return { ok: true, fileName };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error escribiendo respaldo en carpeta local.',
    };
  }
}

async function pushRecordToCloudEndpoint(
  cloudUrl: string,
  record: IncrementalBackupRecord
): Promise<{ ok: boolean; error?: string }> {
  const cleanUrl = cloudUrl.trim();
  if (!cleanUrl) return { ok: false };
  try {
    const resp = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cleanUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PostPro-Backup-Kind': record.kind,
        },
        body: JSON.stringify(record),
      }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${data?.status || resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red enviando respaldo a la nube.',
    };
  }
}

function computeDocumentsDelta(
  prevDocs: OpenDocument[],
  nextDocs: OpenDocument[]
): IncrementalDocumentDelta | undefined {
  const prevById = new Map(prevDocs.map((d) => [d.id, JSON.stringify(d)]));
  const nextIds = new Set(nextDocs.map((d) => d.id));

  const upserted: OpenDocument[] = [];
  for (const doc of nextDocs) {
    const serialized = JSON.stringify(doc);
    if (prevById.get(doc.id) !== serialized) {
      upserted.push(JSON.parse(serialized) as OpenDocument);
    }
  }

  const removedIds = prevDocs.filter((d) => !nextIds.has(d.id)).map((d) => d.id);
  const prevOrder = prevDocs.map((d) => d.id);
  const order = nextDocs.map((d) => d.id);
  const orderChanged =
    prevOrder.length !== order.length || prevOrder.some((id, idx) => id !== order[idx]);

  if (upserted.length === 0 && removedIds.length === 0 && !orderChanged) {
    return undefined;
  }

  return { upserted, removedIds, order };
}

export function reconstructStateAtBackup(
  targetId: string,
  allRecords: IncrementalBackupRecord[]
): PersistedAppState | null {
  const target = allRecords.find((r) => r.id === targetId);
  if (!target) return null;

  const chainRecords = allRecords
    .filter((r) => r.chainId === target.chainId && r.sequence <= target.sequence)
    .sort((a, b) => a.sequence - b.sequence);

  const base = chainRecords.find((r) => r.kind === 'full' && r.fullSnapshotJson);
  if (!base || !base.fullSnapshotJson) return null;

  let reconstructed = JSON.parse(base.fullSnapshotJson) as PersistedAppState;

  for (const rec of chainRecords) {
    if (rec.kind === 'full') continue;
    const patch = rec.patch;
    if (!patch) continue;

    if (patch.scalars) {
      for (const [key, val] of Object.entries(patch.scalars)) {
        (reconstructed as unknown as Record<string, unknown>)[key] = JSON.parse(JSON.stringify(val));
      }
    }

    if (patch.documentsDelta) {
      const { upserted, removedIds, order } = patch.documentsDelta;
      const docMap = new Map<string, OpenDocument>(
        reconstructed.openDocuments.map((d) => [d.id, d])
      );
      for (const remId of removedIds) {
        docMap.delete(remId);
      }
      for (const doc of upserted) {
        docMap.set(doc.id, JSON.parse(JSON.stringify(doc)) as OpenDocument);
      }
      const nextDocs: OpenDocument[] = [];
      for (const id of order) {
        const found = docMap.get(id);
        if (found) {
          nextDocs.push(found);
          docMap.delete(id);
        }
      }
      for (const leftover of docMap.values()) {
        nextDocs.push(leftover);
      }
      if (nextDocs.length > 0) {
        reconstructed.openDocuments = nextDocs;
      }
    }
  }

  reconstructed = {
    ...reconstructed,
    lastSavedAt: Date.now(),
  };
  return reconstructed;
}

function pruneChains(records: IncrementalBackupRecord[]): IncrementalBackupRecord[] {
  const chainsByLastTs = new Map<string, number>();
  for (const r of records) {
    const prev = chainsByLastTs.get(r.chainId) || 0;
    if (r.createdAt > prev) chainsByLastTs.set(r.chainId, r.createdAt);
  }
  const keepChainIds = new Set(
    Array.from(chainsByLastTs.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHAINS_TO_KEEP)
      .map(([cid]) => cid)
  );
  return records
    .filter((r) => keepChainIds.has(r.chainId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function createIncrementalBackupSnapshot(params: {
  state: PersistedAppState;
  trigger: 'auto-10m' | 'manual';
  forceFull?: boolean;
  skipIfUnchanged?: boolean;
  localFolderHandle?: FileSystemDirectoryHandle | null;
  cloudUrl?: string;
}): Promise<{
  skipped: boolean;
  reason?: string;
  record?: IncrementalBackupRecord;
  records: IncrementalBackupRecord[];
  folderSyncWarning?: string;
  cloudSyncWarning?: string;
}> {
  const {
    state,
    trigger,
    forceFull = false,
    skipIfUnchanged = true,
    localFolderHandle = null,
    cloudUrl = '',
  } = params;

  const existing = await listIncrementalBackups();
  const latest = existing[0] || null;
  const currentHash = computeStateHash(state);
  const fullJson = JSON.stringify(stripVolatileFields(state));
  const fullBytes = byteLength(fullJson);

  if (skipIfUnchanged && latest && latest.stateHash === currentHash && !forceFull) {
    return {
      skipped: true,
      reason: 'Sin cambios desde la última copia incremental',
      records: existing,
    };
  }

  const now = Date.now();
  const latestChain = latest
    ? existing.filter((r) => r.chainId === latest.chainId).sort((a, b) => a.sequence - b.sequence)
    : [];
  const canAppendToLatestChain =
    !forceFull &&
    latest !== null &&
    latestChain.length > 0 &&
    latestChain[0].kind === 'full' &&
    latest.sequence < MAX_DELTAS_PER_CHAIN;

  let prevReconstructed: PersistedAppState | null = null;
  if (canAppendToLatestChain && latest) {
    prevReconstructed = reconstructStateAtBackup(latest.id, existing);
  }

  let newRecord: IncrementalBackupRecord;

  if (!canAppendToLatestChain || !prevReconstructed || !latest) {
    const chainId = `chain-${now}`;
    newRecord = {
      id: `bkp-${now}-full`,
      chainId,
      parentId: null,
      sequence: 0,
      kind: 'full',
      createdAt: now,
      trigger,
      storageMode: 'local-idb',
      stateHash: currentHash,
      changedSections: ['Estado completo'],
      summary: `Base completa (${state.openDocuments.length} doc${
        state.openDocuments.length === 1 ? '' : 's'
      }, ${state.templates.length} plantillas)`,
      deltaBytes: fullBytes,
      fullBytes,
      fullSnapshotJson: fullJson,
    };
  } else {
    const patch: IncrementalStatePatch = {};
    const changedSections: string[] = [];

    const scalars: Record<string, unknown> = {};
    for (const key of SCALAR_KEYS) {
      const prevVal = prevReconstructed[key];
      const nextVal = state[key];
      if (JSON.stringify(prevVal) !== JSON.stringify(nextVal)) {
        scalars[key] = JSON.parse(JSON.stringify(nextVal));
        changedSections.push(SECTION_LABELS[key] || String(key));
      }
    }
    if (Object.keys(scalars).length > 0) {
      patch.scalars = scalars;
    }

    const docsDelta = computeDocumentsDelta(prevReconstructed.openDocuments, state.openDocuments);
    if (docsDelta) {
      patch.documentsDelta = docsDelta;
      const modCount = docsDelta.upserted.length + docsDelta.removedIds.length;
      changedSections.unshift(
        modCount > 0 ? `Documentos (${modCount} mod.)` : 'Orden de pestañas'
      );
    }

    const seq = latest.sequence + 1;
    const patchJson = JSON.stringify(patch);
    const deltaBytes = byteLength(patchJson);
    const uniqueSections = Array.from(new Set(changedSections));
    const summaryText =
      uniqueSections.length > 0
        ? uniqueSections.slice(0, 3).join(' · ')
        : 'Punto de control incremental';

    newRecord = {
      id: `bkp-${now}-inc-${seq}`,
      chainId: latest.chainId,
      parentId: latest.id,
      sequence: seq,
      kind: 'delta',
      createdAt: now,
      trigger,
      storageMode: 'local-idb',
      stateHash: currentHash,
      changedSections: uniqueSections.length > 0 ? uniqueSections : ['Sin diferencias estructurales'],
      summary: summaryText,
      deltaBytes,
      fullBytes,
      patch,
    };
  }

  let folderSyncWarning: string | undefined;
  let cloudSyncWarning: string | undefined;

  if (localFolderHandle) {
    const folderRes = await writeRecordToLocalFolder(localFolderHandle, newRecord);
    if (folderRes.ok && folderRes.fileName) {
      newRecord.syncedFolderFile = folderRes.fileName;
      newRecord.storageMode = 'local-folder';
    } else if (folderRes.error) {
      folderSyncWarning = folderRes.error;
    }
  }

  if (cloudUrl.trim()) {
    const cloudRes = await pushRecordToCloudEndpoint(cloudUrl, newRecord);
    if (cloudRes.ok) {
      newRecord.syncedCloudOk = true;
      newRecord.storageMode = 'cloud-sync';
    } else if (cloudRes.error) {
      cloudSyncWarning = cloudRes.error;
    }
  }

  const updatedList = pruneChains([newRecord, ...existing]);
  await replaceAllIncrementalBackups(updatedList);

  return {
    skipped: false,
    record: newRecord,
    records: updatedList,
    folderSyncWarning,
    cloudSyncWarning,
  };
}

export async function deleteIncrementalBackupById(id: string): Promise<IncrementalBackupRecord[]> {
  const existing = await listIncrementalBackups();
  const target = existing.find((r) => r.id === id);
  if (!target) return existing;

  // Deleting a record also removes dependent descendants in the same chain so integrity is preserved
  const next = existing.filter(
    (r) => !(r.chainId === target.chainId && r.sequence >= target.sequence)
  );
  await replaceAllIncrementalBackups(next);
  return next;
}

export async function clearAllIncrementalBackups(): Promise<void> {
  await replaceAllIncrementalBackups([]);
}
