import type { BbTemplate, LinkedFileMeta } from '../types';

interface FilePickerAccept {
  description: string;
  accept: Record<string, string[]>;
}

interface ModernWindow extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: FilePickerAccept[];
  }) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
}

export async function pickSingleLocalFile(
  acceptAttr: string,
  pickerTypes?: FilePickerAccept[]
): Promise<{ file: File; meta: LinkedFileMeta } | null> {
  const win = window as unknown as ModernWindow;

  if (typeof win.showOpenFilePicker === 'function') {
    try {
      const [handle] = await win.showOpenFilePicker({
        multiple: false,
        types: pickerTypes,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return {
        file,
        meta: {
          name: file.name,
          sizeBytes: file.size,
          lastModified: file.lastModified,
          relativePath: file.name,
        },
      };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      // Fallback below if blocked inside cross-origin iframe
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptAttr;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      settled = true;
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        file,
        meta: {
          name: file.name,
          sizeBytes: file.size,
          lastModified: file.lastModified,
          relativePath: file.webkitRelativePath || file.name,
        },
      });
    });

    input.addEventListener('cancel', () => {
      settled = true;
      cleanup();
      resolve(null);
    });

    input.click();

    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled) {
            cleanup();
            resolve(null);
          }
        }, 400);
      },
      { once: true }
    );
  });
}

export async function pickMultipleMediaFiles(acceptAttr: string): Promise<File[]> {
  const win = window as unknown as ModernWindow;
  if (typeof win.showOpenFilePicker === 'function') {
    try {
      const handles = await win.showOpenFilePicker({ multiple: true });
      const files = await Promise.all(handles.map((h) => h.getFile()));
      return files;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return [];
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = acceptAttr;
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      settled = true;
      const list = Array.from(input.files || []);
      cleanup();
      resolve(list);
    });

    input.addEventListener('cancel', () => {
      settled = true;
      cleanup();
      resolve([]);
    });

    input.click();

    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled) {
            cleanup();
            resolve([]);
          }
        }, 400);
      },
      { once: true }
    );
  });
}

export interface DirectoryPickResult {
  folderName: string;
  files: File[];
  metas: LinkedFileMeta[];
  importedTemplates: BbTemplate[];
}

export async function pickLocalDirectory(options?: {
  parseTemplates?: boolean;
}): Promise<DirectoryPickResult | null> {
  const win = window as unknown as ModernWindow;
  const files: File[] = [];
  let folderName = '';

  if (typeof win.showDirectoryPicker === 'function') {
    try {
      const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
      folderName = dirHandle.name;
      for await (const [, entry] of (
        dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>
      )) {
        if (entry.kind === 'file') {
          const f = await (entry as FileSystemFileHandle).getFile();
          files.push(f);
        }
      }
      return await buildDirectoryResult(folderName, files, options?.parseTemplates);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      // Fallback to webkitdirectory below (e.g. inside sandboxed iframe)
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', async () => {
      settled = true;
      const list = Array.from(input.files || []);
      cleanup();
      if (list.length === 0) {
        resolve(null);
        return;
      }
      const firstRel = list[0].webkitRelativePath || list[0].name;
      const rootFolder = firstRel.includes('/') ? firstRel.split('/')[0] : 'Carpeta Seleccionada';
      resolve(await buildDirectoryResult(rootFolder, list, options?.parseTemplates));
    });

    input.addEventListener('cancel', () => {
      settled = true;
      cleanup();
      resolve(null);
    });

    input.click();

    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled) {
            cleanup();
            resolve(null);
          }
        }, 500);
      },
      { once: true }
    );
  });
}

async function buildDirectoryResult(
  folderName: string,
  files: File[],
  parseTemplates?: boolean
): Promise<DirectoryPickResult> {
  const metas: LinkedFileMeta[] = files.slice(0, 150).map((f) => ({
    name: f.name,
    sizeBytes: f.size,
    lastModified: f.lastModified,
    relativePath: f.webkitRelativePath || f.name,
  }));

  const importedTemplates: BbTemplate[] = [];
  if (parseTemplates) {
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of list) {
            if (item && typeof item.name === 'string' && typeof item.bodyPattern === 'string') {
              importedTemplates.push({
                id: item.id || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: item.name,
                titlePattern: item.titlePattern || '{{titulo}} ({{anio}})',
                bodyPattern: item.bodyPattern,
              });
            }
          }
        } catch {
          // Ignore invalid JSON files in directory
        }
      }
    }
  }

  return { folderName, files, metas, importedTemplates };
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(2)} ${units[idx]}`;
}
