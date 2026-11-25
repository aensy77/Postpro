import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AboutModal,
  ConnectApiModal,
  PluginsModal,
  SettingsModal,
  SpoilerLinksModal,
} from './components/Modals';
import { SetupScreen } from './components/SetupScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Workspace } from './components/Workspace';
import { YoutubeTrailerModal } from './components/YoutubeTrailerModal';
import {
  DEFAULT_DOCK_STATE,
  DEFAULT_SPLIT_RATIOS,
  DEFAULT_TEMPLATES,
  MEDIA_SCENARIOS,
  THEME_PLUGINS,
} from './data/defaults';
import type {
  ApiPingStatus,
  ApiProviderConfig,
  BbTemplate,
  DockState,
  FloatingToolItem,
  FunctionalPlugin,
  IncrementalBackupRecord,
  MediaContext,
  OpenDocument,
  RecentMediaProject,
  ScreenMode,
  SplitRatios,
  SpoilerLinkRow,
  TemplateSite,
  ThemePlugin,
  ToastItem,
  UserConfig,
  YoutubeTrailerResult,
} from './types';
import {
  enrichWithFanartTvIfConfigured,
  executeApiProvider,
  fetchFanartTvArtwork,
  fetchOmdbArtwork,
  fetchTmdbArtwork,
} from './utils/apiClient';
import {
  applySiteStructureToBbCode,
  buildHostersSummaryAndIdentiLinks,
  compileTemplateText,
  DEFAULT_CUSTOM_LINK_TEMPLATE,
  renderBbCodeNodes,
  toCleanBbCode,
  validateAndParsePostTemplateFile,
} from './utils/bbcode';

export interface RenderedPostResult {
  site: TemplateSite;
  styleLabel: string;
  compiledTitle: string;
  compiledBodyWithMarkers: string;
  cleanBbCode: string;
  renderedNodes: ReactNode;
}
import { formatBytes } from './utils/filePicker';
import { normalizeYoutubeShortUrl } from './utils/youtubeTrailer';
import {
  clearAllIncrementalBackups,
  createIncrementalBackupSnapshot,
  deleteIncrementalBackupById,
  listIncrementalBackups,
  loadSavedBackupDirectoryHandle,
  pickLocalBackupDirectory,
  reconstructStateAtBackup,
  saveBackupDirectoryHandle,
} from './utils/incrementalBackup';
import {
  getInitialPersistedState,
  normalizePersistedState,
  type PersistedAppState,
  resetPersistedState,
  savePersistedState,
} from './utils/storage';

export interface HotkeyBinding {
  combo: string;
  description: string;
  enabled?: boolean;
  allowInModal?: boolean;
  handler: (event: KeyboardEvent) => void;
}

function matchesHotkeyCombo(event: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const targetKey = parts[parts.length - 1];
  const needsMod = parts.includes('mod') || parts.includes('ctrl');
  const needsShift = parts.includes('shift');
  const needsAlt = parts.includes('alt');

  const hasMod = event.ctrlKey || event.metaKey;
  if (hasMod !== needsMod) return false;
  if (event.shiftKey !== needsShift) return false;
  if (event.altKey !== needsAlt) return false;

  return event.key.toLowerCase() === targetKey;
}

export function useHotkeys(bindings: HotkeyBinding[], active = true) {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const hasDomModal = Boolean(
        document.querySelector('[aria-modal="true"]')
      );

      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (!binding.allowInModal && hasDomModal) continue;
        if (matchesHotkeyCombo(event, binding.combo)) {
          event.preventDefault();
          event.stopPropagation();
          binding.handler(event);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active]);
}

const DEFAULT_UNDO_LIMIT = 10;

function clampUndoLimit(limit?: number): number {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return DEFAULT_UNDO_LIMIT;
  return Math.max(1, Math.min(100, Math.round(limit)));
}

interface UndoHistoryEntry {
  openDocuments: OpenDocument[];
  activeDocId: string;
  label: string;
  timestamp: number;
}

interface AppUndoBundle {
  persisted: PersistedAppState;
  undoStack: UndoHistoryEntry[];
  lastUndoPushAt: number;
  lastUndoDocId: string | null;
}

function describeDocumentTransition(prev: PersistedAppState, next: PersistedAppState): string {
  if (next.openDocuments.length > prev.openDocuments.length) {
    return 'Nuevo documento';
  }
  if (next.openDocuments.length < prev.openDocuments.length) {
    return 'Cerrar documento';
  }
  const prevDoc = prev.openDocuments.find((d) => d.id === prev.activeDocId);
  const nextDoc = next.openDocuments.find((d) => d.id === next.activeDocId);
  if (prevDoc && nextDoc) {
    if (prevDoc.templateId !== nextDoc.templateId) return 'Cambio de plantilla/estilo';
    if (prevDoc.name !== nextDoc.name) return 'Renombrar / Ingesta';
    if (prevDoc.customBody !== nextDoc.customBody) return 'Edición BBCode';
    if (prevDoc.customTitle !== nextDoc.customTitle) return 'Edición de título';
    if (prevDoc.context !== nextDoc.context) {
      if (prevDoc.context.capturas_bbcode !== nextDoc.context.capturas_bbcode) {
        return 'Capturas de video';
      }
      if (
        prevDoc.context.enlaces_spoiler !== nextDoc.context.enlaces_spoiler ||
        prevDoc.context.enlaces_identi !== nextDoc.context.enlaces_identi
      ) {
        return 'Enlaces de descarga';
      }
      if (prevDoc.context.poster_url !== nextDoc.context.poster_url) {
        return 'Portada / Cover';
      }
      if (prevDoc.context.password !== nextDoc.context.password) {
        return 'Contraseña del post';
      }
      return 'Metadatos / Contexto';
    }
  }
  return 'Cambio en documento';
}

export default function App() {
  const [appBundle, setAppBundle] = useState<AppUndoBundle>(() => ({
    persisted: getInitialPersistedState(),
    undoStack: [],
    lastUndoPushAt: 0,
    lastUndoDocId: null,
  }));
  const state = appBundle.persisted;
  const undoStack = appBundle.undoStack;
  const undoLimit = clampUndoLimit(state.config.undoHistoryLimit);

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const [settingsModal, setSettingsModal] = useState<{
    open: boolean;
    tab: 'paths' | 'imghost' | 'minimenu' | 'backups';
  }>({ open: false, tab: 'paths' });
  const [pluginsModal, setPluginsModal] = useState<{
    open: boolean;
    tab: 'installed' | 'import';
  }>({ open: false, tab: 'installed' });
  const [connectApiOpen, setConnectApiOpen] = useState(false);
  const [spoilerLinksOpen, setSpoilerLinksOpen] = useState(false);
  const [youtubeTrailerOpen, setYoutubeTrailerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [apiPingStatuses, setApiPingStatuses] = useState<Record<string, ApiPingStatus>>({});

  const [incrementalBackups, setIncrementalBackups] = useState<IncrementalBackupRecord[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [nextBackupAt, setNextBackupAt] = useState<number | null>(() =>
    state.config.autoBackupEnabled
      ? Date.now() + (state.config.autoBackupIntervalMinutes || 10) * 60_000
      : null
  );
  const [backupFolderHandleReady, setBackupFolderHandleReady] = useState(false);

  const latestStateRef = useRef(state);
  const latestBundleRef = useRef(appBundle);
  const backupFolderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const backupInFlightRef = useRef(false);
  const nextBackupAtRef = useRef<number | null>(nextBackupAt);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestBundleRef.current = appBundle;
  }, [appBundle]);

  useEffect(() => {
    nextBackupAtRef.current = nextBackupAt;
  }, [nextBackupAt]);

  const allThemes = useMemo(
    () => [...THEME_PLUGINS, ...state.customThemes],
    [state.customThemes]
  );

  const showToast = useCallback(
    (message: string, type: ToastItem['type'] = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3200);
    },
    []
  );

  // Load incremental backup history & optional local directory handle on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [rows, handle] = await Promise.all([
          listIncrementalBackups(),
          loadSavedBackupDirectoryHandle(),
        ]);
        if (!active) return;
        setIncrementalBackups(rows);
        if (rows[0]) setLastBackupAt(rows[0].createdAt);
        if (handle) {
          backupFolderHandleRef.current = handle;
          setBackupFolderHandleReady(true);
        }
      } finally {
        if (active) setBackupsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const runIncrementalBackupCycle = useCallback(
    async (opts: { trigger: 'auto-10m' | 'manual'; forceFull?: boolean }) => {
      if (backupInFlightRef.current) return;
      backupInFlightRef.current = true;
      setBackupRunning(true);
      try {
        const cur = latestStateRef.current;
        const intervalMs = Math.max(1, cur.config.autoBackupIntervalMinutes || 10) * 60_000;
        const result = await createIncrementalBackupSnapshot({
          state: cur,
          trigger: opts.trigger,
          forceFull: Boolean(opts.forceFull),
          skipIfUnchanged: !opts.forceFull,
          localFolderHandle: backupFolderHandleRef.current,
          cloudUrl: cur.config.autoBackupCloudUrl || '',
        });

        setIncrementalBackups(result.records);

        if (cur.config.autoBackupEnabled) {
          setNextBackupAt(Date.now() + intervalMs);
        }

        if (result.skipped) {
          if (opts.trigger === 'manual') {
            showToast(
              'Sin cambios desde la última copia. Usa "Punto Completo" para forzar un ancla.',
              'info'
            );
          }
          return;
        }

        if (result.record) {
          setLastBackupAt(result.record.createdAt);
          const kindLabel =
            result.record.kind === 'full'
              ? 'Copia base completa'
              : `Copia incremental #${result.record.sequence}`;
          const sizeLabel = formatBytes(result.record.deltaBytes);
          const syncNotes: string[] = [];
          if (result.record.syncedFolderFile) syncNotes.push(`Disco: ${result.record.syncedFolderFile}`);
          if (result.record.syncedCloudOk) syncNotes.push('Nube ✔');
          showToast(
            `💾 ${kindLabel} guardada (${sizeLabel})${
              syncNotes.length > 0 ? ` · ${syncNotes.join(' · ')}` : ''
            }`,
            'success'
          );
          if (result.folderSyncWarning) {
            showToast(`Carpeta local: ${result.folderSyncWarning}`, 'warning');
          }
          if (result.cloudSyncWarning) {
            showToast(`Sincronización nube: ${result.cloudSyncWarning}`, 'warning');
          }
        }
      } finally {
        backupInFlightRef.current = false;
        setBackupRunning(false);
      }
    },
    [showToast]
  );

  // Schedule 10-minute automatic incremental backup without resetting on keystrokes
  useEffect(() => {
    if (!state.config.autoBackupEnabled) {
      setNextBackupAt(null);
      return;
    }
    const intervalMs = Math.max(1, state.config.autoBackupIntervalMinutes || 10) * 60_000;
    setNextBackupAt(Date.now() + intervalMs);

    const timer = window.setInterval(() => {
      const targetAt = nextBackupAtRef.current;
      if (targetAt && Date.now() >= targetAt) {
        void runIncrementalBackupCycle({ trigger: 'auto-10m' });
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [
    state.config.autoBackupEnabled,
    state.config.autoBackupIntervalMinutes,
    runIncrementalBackupCycle,
  ]);

  // Apply active theme CSS variables, typography, and background
  useEffect(() => {
    const theme = allThemes.find((t) => t.id === state.activeThemeId) || THEME_PLUGINS[0];
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme.vars || {})) {
      root.style.setProperty(k, v);
    }
    if (theme.fontFamily) {
      root.style.setProperty('--font-custom', theme.fontFamily);
      root.style.fontFamily = theme.fontFamily;
    } else {
      root.style.removeProperty('--font-custom');
      root.style.fontFamily = '';
    }
    if (theme.customBackgroundUrl) {
      root.style.setProperty('--custom-bg-image', `url(${theme.customBackgroundUrl})`);
    } else {
      root.style.removeProperty('--custom-bg-image');
    }
  }, [state.activeThemeId, allThemes]);

  const compactedToastShownRef = useRef(false);

  // Debounced auto-save to localStorage + flush on page unload
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const res = savePersistedState(state);
      if (res.compacted && !compactedToastShownRef.current) {
        compactedToastShownRef.current = true;
        showToast(
          'Imágenes locales pesadas omitidas de caché local; súbelas al host para conservarlas entre recargas.',
          'warning'
        );
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state, showToast]);

  useEffect(() => {
    const flushState = () => {
      savePersistedState(latestStateRef.current);
    };
    window.addEventListener('beforeunload', flushState);
    window.addEventListener('pagehide', flushState);
    return () => {
      window.removeEventListener('beforeunload', flushState);
      window.removeEventListener('pagehide', flushState);
      flushState();
    };
  }, []);

  const updateState = useCallback(
    (
      updater: (prev: PersistedAppState) => PersistedAppState,
      options?: { recordUndo?: boolean; undoLabel?: string; coalesceTyping?: boolean }
    ) => {
      const now = Date.now();
      setAppBundle((prevBundle) => {
        const prev = prevBundle.persisted;
        const next = updater(prev);
        const nextPersisted = { ...next, lastSavedAt: now };
        const maxHistory = clampUndoLimit(nextPersisted.config.undoHistoryLimit);

        const docsChanged = next.openDocuments !== prev.openDocuments;
        if (options?.recordUndo === false || !docsChanged) {
          const trimmedStack =
            prevBundle.undoStack.length > maxHistory
              ? prevBundle.undoStack.slice(-maxHistory)
              : prevBundle.undoStack;
          return {
            ...prevBundle,
            persisted: nextPersisted,
            undoStack: trimmedStack,
          };
        }

        const prevActive = prev.openDocuments.find((d) => d.id === prev.activeDocId);
        const nextActive = next.openDocuments.find((d) => d.id === next.activeDocId);
        const isSameDoc =
          prev.openDocuments.length === next.openDocuments.length &&
          prev.activeDocId === next.activeDocId &&
          Boolean(prevActive && nextActive && prevActive.id === nextActive.id);
        const isStructuralChange =
          !isSameDoc ||
          prevActive?.templateId !== nextActive?.templateId ||
          prevActive?.name !== nextActive?.name;

        const shouldCoalesce =
          options?.coalesceTyping !== false &&
          !isStructuralChange &&
          prevBundle.lastUndoDocId === prev.activeDocId &&
          prevBundle.undoStack.length > 0 &&
          now - prevBundle.lastUndoPushAt < 750;

        if (shouldCoalesce) {
          return {
            ...prevBundle,
            persisted: nextPersisted,
            lastUndoPushAt: now,
          };
        }

        const entry: UndoHistoryEntry = {
          openDocuments: prev.openDocuments,
          activeDocId: prev.activeDocId,
          label: options?.undoLabel || describeDocumentTransition(prev, next),
          timestamp: now,
        };

        return {
          persisted: nextPersisted,
          undoStack: [...prevBundle.undoStack, entry].slice(-maxHistory),
          lastUndoPushAt: now,
          lastUndoDocId: prev.activeDocId,
        };
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    const bundle = latestBundleRef.current;
    if (bundle.undoStack.length === 0) {
      showToast('No hay cambios pendientes para deshacer (Ctrl+Z)', 'info');
      return;
    }

    const entry = bundle.undoStack[bundle.undoStack.length - 1];
    const remaining = bundle.undoStack.length - 1;
    const maxHistory = clampUndoLimit(bundle.persisted.config.undoHistoryLimit);

    setAppBundle((prevBundle) => {
      if (prevBundle.undoStack.length === 0) return prevBundle;
      const target = prevBundle.undoStack[prevBundle.undoStack.length - 1];
      const limit = clampUndoLimit(prevBundle.persisted.config.undoHistoryLimit);
      const nextStack = prevBundle.undoStack.slice(0, -1).slice(-limit);
      return {
        persisted: {
          ...prevBundle.persisted,
          openDocuments: target.openDocuments,
          activeDocId: target.activeDocId,
          lastSavedAt: Date.now(),
        },
        undoStack: nextStack,
        lastUndoPushAt: 0,
        lastUndoDocId: null,
      };
    });

    showToast(`↩ Deshecho: ${entry.label} (${remaining}/${maxHistory})`, 'info');
  }, [showToast]);

  const handleSaveWorkspace = useCallback(() => {
    const now = Date.now();
    const snapshot = { ...latestStateRef.current, lastSavedAt: now };
    const res = savePersistedState(snapshot);
    setAppBundle((prevBundle) => ({
      ...prevBundle,
      persisted: { ...prevBundle.persisted, lastSavedAt: now },
    }));
    if (res.compacted) {
      showToast(
        '💾 Guardado (Ctrl+S). Nota: imágenes locales pesadas omitidas de caché local.',
        'warning'
      );
    } else {
      showToast('💾 Documento y configuración guardados (Ctrl+S)', 'success');
    }
  }, [showToast]);

  const activeDoc = useMemo(
    () => state.openDocuments.find((d) => d.id === state.activeDocId) || state.openDocuments[0],
    [state.openDocuments, state.activeDocId]
  );

  const handleUpdateConfig = (patch: Partial<UserConfig>) => {
    updateState(
      (prev) => ({
        ...prev,
        config: { ...prev.config, ...patch },
      }),
      { recordUndo: false }
    );
  };

  const inferTemplateSite = useCallback(
    (tpl: Pick<BbTemplate, 'id' | 'name' | 'site' | 'bodyPattern'>): TemplateSite => {
      if (tpl.site === 'identi' || tpl.site === 'zinfinal' || tpl.site === 'custom') {
        return tpl.site;
      }
      const lowerName = `${tpl.id} ${tpl.name}`.toLowerCase();
      if (lowerName.includes('identi')) return 'identi';
      if (lowerName.includes('zinfinal') || lowerName.includes('aensy')) return 'zinfinal';
      if (
        tpl.bodyPattern.includes('#80ffea') ||
        tpl.bodyPattern.includes('{{enlaces_identi}}') ||
        tpl.bodyPattern.includes('[size=25]')
      ) {
        return 'identi';
      }
      if (
        tpl.bodyPattern.includes('[img size=350]') ||
        tpl.bodyPattern.includes('#3366ff') ||
        tpl.bodyPattern.includes('[size=22]')
      ) {
        return 'zinfinal';
      }
      return 'custom';
    },
    []
  );

  const activeTemplate = useMemo(
    () => state.templates.find((t) => t.id === activeDoc?.templateId) || state.templates[0],
    [state.templates, activeDoc?.templateId]
  );

  const activeSite = useMemo(
    () => (activeTemplate ? inferTemplateSite(activeTemplate) : 'zinfinal'),
    [activeTemplate, inferTemplateSite]
  );

  /**
   * Motor de renderizado central por sitio ('zinfinal' vs 'identi'):
   * - Zinfinal Aensy Style: logo centrado size=350 sobre poster y trailer, banner gráfico único, ClearArt y escala px (#3366ff).
   * - Identi: tamaños de fuente específicos ([size=4], [size=5], [size=25], [size=30]), separadores múltiples y bloques Identi (#80ffea).
   */
  const renderedPost = useMemo<RenderedPostResult>(() => {
    const rawTitle = activeDoc.customTitle ?? activeTemplate.titlePattern;
    const rawBody = activeDoc.customBody ?? activeTemplate.bodyPattern;
    const styledBody = applySiteStructureToBbCode(rawBody, activeSite, activeDoc.context);

    const compiledTitle = compileTemplateText(rawTitle, activeDoc.context);
    const compiledBodyWithMarkers = compileTemplateText(styledBody, activeDoc.context);
    const cleanBbCode = toCleanBbCode(compiledBodyWithMarkers);
    const renderedNodes = renderBbCodeNodes(compiledBodyWithMarkers, `bb-${activeSite}`, {
      site: activeSite,
      context: activeDoc.context,
    });

    const styleLabel =
      activeSite === 'zinfinal'
        ? activeTemplate.name.includes('Música')
          ? 'Zinfinal Música'
          : 'Zinfinal Aensy Style'
        : activeSite === 'identi'
        ? 'Identi'
        : activeTemplate.name || 'Personalizado';

    return {
      site: activeSite,
      styleLabel,
      compiledTitle,
      compiledBodyWithMarkers,
      cleanBbCode,
      renderedNodes,
    };
  }, [activeDoc, activeTemplate, activeSite]);

  const handleSwitchSiteStyle = (targetSite: 'zinfinal' | 'identi') => {
    const isMusic =
      activeDoc.context.media_type === 'music' ||
      activeTemplate.category === 'music' ||
      activeTemplate.id.includes('music');

    const preferredId =
      targetSite === 'identi'
        ? isMusic
          ? 'tpl-identi-music'
          : 'tpl-identi-main'
        : isMusic
        ? 'tpl-zinfinal-music'
        : 'tpl-zinfinal-main';

    const matched =
      state.templates.find((t) => t.id === preferredId) ||
      state.templates.find((t) => inferTemplateSite(t) === targetSite);

    if (!matched) return;
    handleUpdateActiveDoc((doc) => ({
      ...doc,
      templateId: matched.id,
      customTitle: null,
      customBody: null,
    }));
    showToast(
      `Estilo cambiado a ${targetSite === 'zinfinal' ? 'Zinfinal Aensy Style' : 'Identi'}`,
      'info'
    );
  };

  const handleImportTemplatesFromFolder = (imported: BbTemplate[]) => {
    updateState((prev) => {
      const existingIds = new Set(prev.templates.map((t) => t.id));
      const merged = [...prev.templates];
      for (const tpl of imported) {
        if (!existingIds.has(tpl.id)) {
          merged.unshift({ ...tpl, site: inferTemplateSite(tpl) });
        }
      }
      return { ...prev, templates: merged };
    });
  };

  const handleImportPostTemplate = useCallback(
    (fileContent: string) => {
      const res = validateAndParsePostTemplateFile(fileContent);
      if (!res.ok || !res.template) {
        showToast(`❌ Archivo .Post rechazado por seguridad: ${res.error}`, 'error');
        return;
      }

      const imported = res.template;
      updateState((prev) => {
        const existingIdx = prev.templates.findIndex((t) => t.id === imported.id);
        const nextTemplates =
          existingIdx >= 0
            ? prev.templates.map((t, idx) => (idx === existingIdx ? imported : t))
            : [imported, ...prev.templates];
        return {
          ...prev,
          templates: nextTemplates,
        };
      }, { recordUndo: true, undoLabel: `Importar plantilla "${imported.name}"` });

      updateState((prev) => {
        const nextDocs = prev.openDocuments.map((d) =>
          d.id === prev.activeDocId
            ? { ...d, templateId: imported.id, customTitle: null, customBody: null }
            : d
        );
        return { ...prev, openDocuments: nextDocs };
      }, { recordUndo: false });

      showToast(`✔ Plantilla "${imported.name}" (.Post) importada, verificada y aplicada con éxito.`, 'success');
    },
    [updateState, showToast]
  );


  const handleSelectScreen = (screen: ScreenMode) => {
    updateState((prev) => ({
      ...prev,
      screen,
      onboardingCompleted: screen === 'workspace' ? true : prev.onboardingCompleted,
    }));
  };

  const handleUpdateActiveDoc = (updater: (doc: OpenDocument) => OpenDocument) => {
    updateState((prev) => ({
      ...prev,
      openDocuments: prev.openDocuments.map((d) =>
        d.id === prev.activeDocId ? updater(d) : d
      ),
    }));
  };

  const handleCreateDocument = (preferredSite?: TemplateSite) => {
    const id = `doc-${Date.now()}`;
    updateState((prev) => {
      const currentTpl = prev.templates.find((t) => t.id === activeDoc?.templateId);
      const validPreferred =
        preferredSite === 'identi' || preferredSite === 'zinfinal' || preferredSite === 'custom'
          ? preferredSite
          : undefined;
      const targetSite =
        validPreferred || (currentTpl ? inferTemplateSite(currentTpl) : 'zinfinal');
      const siteDefaultTpl =
        prev.templates.find((t) => inferTemplateSite(t) === targetSite) ||
        prev.templates[0];
      const isIdenti = targetSite === 'identi';
      return {
        ...prev,
        openDocuments: [
          ...prev.openDocuments,
          {
            id,
            name: `${isIdenti ? 'Identi' : 'Zinfinal'}_Post_${prev.openDocuments.length + 1}.bbcode`,
            dotColor: isIdenti ? '#80ffea' : '#3366ff',
            templateId: siteDefaultTpl?.id || 'tpl-zinfinal-main',
            context: isIdenti ? { ...MEDIA_SCENARIOS.anime } : { ...MEDIA_SCENARIOS.movie },
            customTitle: null,
            customBody: null,
          },
        ],
        activeDocId: id,
      };
    });
  };

  const handleCloseDocument = (docId: string) => {
    updateState((prev) => {
      if (prev.openDocuments.length <= 1) return prev;
      const filtered = prev.openDocuments.filter((d) => d.id !== docId);
      const nextActive = prev.activeDocId === docId ? filtered[0].id : prev.activeDocId;
      return { ...prev, openDocuments: filtered, activeDocId: nextActive };
    });
  };

  const handleRecordRecentProject = (project: RecentMediaProject) => {
    updateState((prev) => {
      const existing = Array.isArray(prev.recentProjects) ? prev.recentProjects : [];
      const filtered = existing.filter(
        (item) =>
          !(
            item.mediainfoDetails.fileName === project.mediainfoDetails.fileName &&
            item.mediainfoDetails.fileSizeBytes === project.mediainfoDetails.fileSizeBytes
          )
      );
      return {
        ...prev,
        recentProjects: [project, ...filtered].slice(0, 12),
      };
    });
  };

  const handleOpenRecentProject = (
    project: RecentMediaProject,
    mode: 'new-tab' | 'current-tab' = 'new-tab'
  ) => {
    const baseScenario =
      project.templateId === 'tpl-zinfinal-music' ||
      project.templateId === 'tpl-identi-music' ||
      project.templateId === 'tpl-music'
        ? MEDIA_SCENARIOS.music
        : project.templateId === 'tpl-identi-main' || project.templateId === 'tpl-anime'
        ? MEDIA_SCENARIOS.anime
        : MEDIA_SCENARIOS.movie;

    const restoredContext: MediaContext = { ...baseScenario };
    for (const [k, v] of Object.entries(project.contextSnapshot)) {
      if (typeof v === 'string') {
        restoredContext[k] = v;
      }
    }

    if (mode === 'current-tab') {
      updateState((prev) => ({
        ...prev,
        openDocuments: prev.openDocuments.map((d) =>
          d.id === prev.activeDocId
            ? {
                ...d,
                name: project.docName,
                templateId: project.templateId || d.templateId,
                customTitle: null,
                customBody: null,
                context: restoredContext,
                mediainfoDetails: project.mediainfoDetails,
              }
            : d
        ),
      }));
      showToast(
        `Metadatos de "${project.mediainfoDetails.fileName}" restaurados sin re-analizar`,
        'success'
      );
      return;
    }

    const existingTab = state.openDocuments.find(
      (d) =>
        d.mediainfoDetails?.fileName === project.mediainfoDetails.fileName &&
        d.mediainfoDetails?.fileSizeBytes === project.mediainfoDetails.fileSizeBytes
    );

    if (existingTab) {
      updateState((prev) => ({
        ...prev,
        activeDocId: existingTab.id,
        openDocuments: prev.openDocuments.map((d) =>
          d.id === existingTab.id
            ? {
                ...d,
                mediainfoDetails: d.mediainfoDetails || project.mediainfoDetails,
              }
            : d
        ),
      }));
      showToast(`Cambiado a pestaña "${existingTab.name}"`, 'info');
      return;
    }

    const id = `doc-recent-${Date.now()}`;
    updateState((prev) => ({
      ...prev,
      openDocuments: [
        ...prev.openDocuments,
        {
          id,
          name: project.docName,
          dotColor: '#00f0ff',
          templateId: project.templateId || prev.templates[0]?.id || 'tpl-zinfinal-main',
          context: restoredContext,
          customTitle: null,
          customBody: null,
          mediainfoDetails: project.mediainfoDetails,
        },
      ],
      activeDocId: id,
    }));
    showToast(
      `Proyecto reciente "${project.mediainfoDetails.fileName}" abierto sin re-analizar`,
      'success'
    );
  };

  const handleRemoveRecentProject = (id: string) => {
    updateState((prev) => ({
      ...prev,
      recentProjects: (prev.recentProjects || []).filter((p) => p.id !== id),
    }));
  };

  const handleClearRecentProjects = () => {
    updateState((prev) => ({
      ...prev,
      recentProjects: [],
    }));
    showToast('Historial de proyectos recientes limpiado', 'info');
  };

  const handleCreateTemplate = (name: string, site: TemplateSite = 'custom') => {
    const id = `tpl-${Date.now()}`;
    const zinfinalBase = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-zinfinal-main');
    const identiBase = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-identi-main');

    const titlePattern =
      site === 'identi'
        ? identiBase?.titlePattern || '{{titulo}} {{fuente}} {{episodio}} ({{anio}}) {{resolucion}}'
        : zinfinalBase?.titlePattern || '{{titulo}} ({{anio}}) {{fuente}} {{resolucion}} {{audio_idiomas}}';

    const bodyPattern =
      site === 'identi'
        ? identiBase?.bodyPattern ||
          `[center][b][color=#244061][size=4]{{titulo}} {{fuente}} {{episodio}} ({{anio}}) {{resolucion}}[/size][/color][/b][/center]\n\n[img]{{logo_url}}[/img]\n\n[img]{{poster_url}}[/img]\n\n[youtube]{{trailer_url}}[/youtube]\n\n[img]{{banner_url}}[/img]\n\n[center][b][size=5][color=#80ffea]Sinopsis[/color][/size][/b][/center]\n\n[center]{{sinopsis}}[/center]\n\n[img]{{banner_url}}[/img]\n\n[center][b][size=25][color=#80ffea]Video[/color][/size][/b]\n\n{{video_info_identi}}\nCapitulos: {{capitulos}}\nPeso total: {{peso_archivo}}\nServidores: {{servidores}}\n\nFuente: {{fuente}}\n\nCreditos: {{creditos}}\n\n{{notas_uploader}}\n[/center]\n\n[center][b][size=25][color=#80ffea]Subtitulos[/color][/size][/b]\n\n{{subtitulos_identi}}\n[/center]\n\n[center][b][size=25][color=#80ffea]Audio[/color][/size][/b]\n\n{{audio_info_identi}}\n[/center]\n\n[img]{{banner_url}}[/img]\n\n[center][b][size=30][color=#80ffea]Capturas[/color][/size][/b][/center]\n\n[center]{{capturas_bbcode}}[/center]\n\n{{enlaces_identi}}\n\n[center][img]{{clearart_url}}[/img][/center]\n\n[center][size=5][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]\n\n[center]{{password}}[/center]\n\n[center][size=4][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`
        : site === 'zinfinal'
        ? zinfinalBase?.bodyPattern ||
          `[center][b][color=#244061][size=24]{{titulo}} ({{anio}}) {{fuente}} {{resolucion}} {{audio_idiomas}}[/size][/color][/b][/center]\n\n[center][img size=350]{{logo_url}}[/img][/center]\n\n[img]{{poster_url}}[/img]\n\n[youtube]{{trailer_url}}[/youtube]\n\n[center][size=22][i][b][color=#3366ff]Sinopsis[/color][/b][/i][/size]\n\n{{sinopsis}}\n[/center]\n\n[center][size=22][i][b][color=#3366ff]Vídeo[/color][/b][/i][/size]\n\n{{video_info_bloque}}\nPeso total: {{peso_archivo}}\nServidores: {{servidores}}\n\nFuente: {{fuente}}\n\nCréditos: {{creditos}}\n\n{{notas_uploader}}\n[/center]\n\n[center][size=22][i][b][color=#3366ff]Subtítulos[/color][/b][/i][/size]\n\n{{subtitulos_info}}\n[/center]\n\n[center][size=22][i][b][color=#3366ff]Audio[/color][/b][/i][/size]\n\n{{audio_info_bloque}}\n[/center]\n\n[img]{{banner_url}}[/img]\n\n[center][size=35][i][b][color=#3366ff]Capturas[/color][/b][/i][/size][/center]\n\n[center]{{capturas_bbcode}}[/center]\n\n[center][size=35][i][b][color=#3366ff]Descarga[/color][/b][/i][/size][/center]\n\n{{enlaces_spoiler}}\n\n[center][img]{{clearart_url}}[/img][/center]\n\n[center][size=22][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]\n\n[center]{{password}}[/center]\n\n[center][size=20][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`
        : `[center]\n[img size=350]{{logo_url}}[/img]\n[img]{{poster_url}}[/img]\n\n[b]{{titulo}}[/b]\n[quote]{{sinopsis}}[/quote]\n\n[img]{{banner_url}}[/img]\n\n{{enlaces_spoiler}}\n\n[img]{{clearart_url}}[/img]\n\n[b][color=#3366ff]PASSWORD[/color][/b]\n{{password}}\n[/center]`;

    const newTpl: BbTemplate = {
      id,
      name,
      site,
      titlePattern,
      bodyPattern,
    };
    updateState((prev) => ({
      ...prev,
      templates: [newTpl, ...prev.templates],
      openDocuments: prev.openDocuments.map((d) =>
        d.id === prev.activeDocId
          ? { ...d, templateId: id, customTitle: null, customBody: null }
          : d
      ),
    }));
    showToast(`Plantilla creada (${site.toUpperCase()}): ${name}`, 'success');
  };

  const handleRunActiveApi = async (queryOverride?: string) => {
    const prov =
      state.apiProviders.find((p) => p.id === state.activeApiProviderId) || state.apiProviders[0];
    if (!prov) return;

    const query = (queryOverride ?? activeDoc.context.titulo ?? '').trim();
    const hasTmdbId = Boolean(activeDoc.context.tmdb_id?.trim());
    const hasImdbId = Boolean(activeDoc.context.imdb_id?.trim());

    if (
      !query &&
      prov.id !== 'prov-fanart' &&
      !(prov.id === 'prov-tmdb' && (hasTmdbId || hasImdbId)) &&
      !(prov.id === 'prov-omdb' && hasImdbId)
    ) {
      showToast('Escribe un título o usa 🎯 Identificar para ingresar un ID.', 'warning');
      return;
    }

    const PROTECTED_TECH_KEYS = new Set([
      'capturas_bbcode',
      'espectrograma_bbcode',
      'mediainfo_completo',
    ]);
    const sanitizeApiContextUpdates = (
      raw: Record<string, string | undefined>
    ): Record<string, string> => {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim() && !PROTECTED_TECH_KEYS.has(k)) {
          clean[k] = v;
        }
      }
      return clean;
    };

    if (prov.id === 'prov-fanart') {
      const fanRes = await fetchFanartTvArtwork({
        mediaType: activeDoc.context.media_type,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        tvdbId: activeDoc.context.tvdb_id,
        mbidId: activeDoc.context.mbid_id,
        title: query || activeDoc.context.titulo,
        artist: activeDoc.context.artista,
        config: state.config,
      });

      if (!fanRes.ok || fanRes.gallery.length === 0) {
        showToast(
          `Fanart.tv: ${fanRes.error || 'No se encontraron artworks para este título/ID.'}`,
          'warning'
        );
        return;
      }

      handleUpdateActiveDoc((doc) => ({
        ...doc,
        fanartGallery: fanRes.gallery,
        context: {
          ...doc.context,
          ...sanitizeApiContextUpdates(fanRes.extracted),
          poster_url:
            fanRes.extracted.poster_url &&
            (!doc.context.poster_url || doc.context.poster_url.startsWith('data:image/svg+xml'))
              ? fanRes.extracted.poster_url
              : doc.context.poster_url,
        },
      }));

      showToast(
        `✔ Fanart.tv — ${fanRes.gallery.length} artwork(s) cargados (Logo, Banner, ClearArt)`,
        'success'
      );
      return;
    }

    if (prov.id === 'prov-tmdb' && !queryOverride?.trim() && (hasTmdbId || hasImdbId)) {
      const tmdbRes = await fetchTmdbArtwork({
        mediaType: activeDoc.context.media_type,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        title: query || activeDoc.context.titulo,
        year: activeDoc.context.anio,
        config: state.config,
      });
      if (!tmdbRes.ok) {
        showToast(`TMDB: ${tmdbRes.error || 'Sin resultados para ese ID.'}`, 'error');
        return;
      }
      const chained = await enrichWithFanartTvIfConfigured(tmdbRes.extracted, state.config, {
        title: tmdbRes.extracted.titulo || activeDoc.context.titulo || query,
        artist: activeDoc.context.artista,
        mediaType: tmdbRes.extracted.media_type || activeDoc.context.media_type,
      });
      const combinedGallery = [...tmdbRes.gallery, ...chained.gallery];
      const sanitized = sanitizeApiContextUpdates(chained.extracted);
      handleUpdateActiveDoc((doc) => ({
        ...doc,
        fanartGallery: combinedGallery.length > 0 ? combinedGallery : doc.fanartGallery,
        context: {
          ...doc.context,
          ...sanitized,
        },
      }));
      showToast(
        `✔ TMDB (ID) — ${Object.keys(sanitized).length} campos sincronizados${
          combinedGallery.length > 0 ? ` + ${combinedGallery.length} artes` : ''
        }`,
        'success'
      );
      return;
    }

    if (prov.id === 'prov-omdb' && !queryOverride?.trim() && hasImdbId) {
      const omdbRes = await fetchOmdbArtwork({
        imdbId: activeDoc.context.imdb_id,
        title: query || activeDoc.context.titulo,
        year: activeDoc.context.anio,
        config: state.config,
      });
      if (!omdbRes.ok) {
        showToast(`OMDb: ${omdbRes.error || 'Sin resultados para ese IMDb ID.'}`, 'error');
        return;
      }
      const chained = await enrichWithFanartTvIfConfigured(omdbRes.extracted, state.config, {
        title: omdbRes.extracted.titulo || activeDoc.context.titulo || query,
        artist: activeDoc.context.artista,
        mediaType: activeDoc.context.media_type,
      });
      const combinedGallery = [...omdbRes.gallery, ...chained.gallery];
      const sanitized = sanitizeApiContextUpdates(chained.extracted);
      handleUpdateActiveDoc((doc) => ({
        ...doc,
        fanartGallery: combinedGallery.length > 0 ? combinedGallery : doc.fanartGallery,
        context: {
          ...doc.context,
          ...sanitized,
        },
      }));
      showToast(
        `✔ OMDb/IMDb (ID) — ${Object.keys(sanitized).length} campos sincronizados${
          combinedGallery.length > 0 ? ` + ${combinedGallery.length} artes` : ''
        }`,
        'success'
      );
      return;
    }

    const cleanSynopsis =
      state.functionalPlugins.find((p) => p.id === 'ext-translator')?.enabled ?? true;

    const res = await executeApiProvider(
      prov,
      {
        query,
        title: activeDoc.context.titulo,
        artist: activeDoc.context.artista,
        year: activeDoc.context.anio,
      },
      state.config,
      cleanSynopsis
    );

    if (!res.ok) {
      showToast(`API (${prov.name}): ${res.error || `HTTP ${res.status}`}`, 'error');
      return;
    }

    const extractedKeys = Object.keys(res.extracted);
    if (extractedKeys.length === 0) {
      showToast(
        `API respondió HTTP ${res.status} (${res.latencyMs} ms), pero no se encontraron resultados para "${query}".`,
        'warning'
      );
      return;
    }

    const chained = await enrichWithFanartTvIfConfigured(res.extracted, state.config, {
      title: res.extracted.titulo || activeDoc.context.titulo || query,
      artist: res.extracted.artista || activeDoc.context.artista,
      mediaType: res.extracted.media_type || activeDoc.context.media_type,
    });

    const combinedGallery = [...(res.gallery || []), ...chained.gallery];
    const sanitized = sanitizeApiContextUpdates(chained.extracted);

    handleUpdateActiveDoc((doc) => ({
      ...doc,
      fanartGallery: combinedGallery.length > 0 ? combinedGallery : doc.fanartGallery,
      context: {
        ...doc.context,
        ...sanitized,
      },
    }));

    const finalCount = Object.keys(sanitized).length;
    showToast(
      `✔ ${prov.name} (${res.latencyMs} ms) — ${finalCount} campos actualizados${
        combinedGallery.length > 0 ? ` + ${combinedGallery.length} artes disponibles` : ''
      }`,
      'success'
    );
  };

  const handleSaveApiProvider = (
    provider: ApiProviderConfig,
    extracted?: Record<string, string>
  ) => {
    updateState((prev) => ({
      ...prev,
      apiProviders: [...prev.apiProviders, provider],
      activeApiProviderId: provider.id,
      config: {
        ...prev.config,
        connectedApiIds: Array.from(new Set([...(prev.config.connectedApiIds || []), provider.id])),
      },
      openDocuments:
        extracted && Object.keys(extracted).length > 0
          ? prev.openDocuments.map((d) =>
              d.id === prev.activeDocId
                ? { ...d, context: { ...d.context, ...extracted } }
                : d
            )
          : prev.openDocuments,
    }));
    showToast(`Proveedor "${provider.name}" conectado y guardado`, 'success');
  };

  const handleEmbedSpoilerLinks = (
    title: string,
    rows: SpoilerLinkRow[],
    customLinkTemplate?: string
  ) => {
    const activeLinkTemplate =
      (customLinkTemplate || state.config.customLinkTemplate || DEFAULT_CUSTOM_LINK_TEMPLATE).trim() ||
      DEFAULT_CUSTOM_LINK_TEMPLATE;
    const compiled = buildHostersSummaryAndIdentiLinks(rows, activeLinkTemplate);
    const linkAlreadyWrappedInSpoiler = /\[spoiler/i.test(activeLinkTemplate);

    updateState((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        customLinkTemplate: activeLinkTemplate,
      },
      openDocuments: prev.openDocuments.map((doc) => {
        if (doc.id !== prev.activeDocId) return doc;
        const tpl = prev.templates.find((t) => t.id === doc.templateId) || prev.templates[0];
        const site = inferTemplateSite(tpl);
        const currentBody = doc.customBody ?? tpl.bodyPattern;
        const spoilerBlock = linkAlreadyWrappedInSpoiler
          ? '{{enlaces_spoiler}}'
          : title.trim()
          ? `[spoiler=${title}]\n{{enlaces_spoiler}}\n[/spoiler]`
          : `[spoiler]\n{{enlaces_spoiler}}\n[/spoiler]`;

        let nextBody = currentBody;
        if (site === 'identi' || currentBody.includes('{{enlaces_identi}}')) {
          if (!currentBody.includes('{{enlaces_identi}}')) {
            if (currentBody.includes('[center][img]{{clearart_url}}[/img][/center]')) {
              nextBody = currentBody.replace(
                '[center][img]{{clearart_url}}[/img][/center]',
                `{{enlaces_identi}}\n\n[center][img]{{clearart_url}}[/img][/center]`
              );
            } else {
              nextBody = `${currentBody}\n\n{{enlaces_identi}}`;
            }
          }
        } else if (currentBody.includes('{{enlaces_spoiler}}')) {
          if (linkAlreadyWrappedInSpoiler) {
            nextBody = currentBody.replace(
              /\[center\]\s*\[spoiler(?:=[^\]]*)?\]\s*\{\{enlaces_spoiler\}\}\s*\[\/spoiler\]\s*\[\/center\]|\[spoiler(?:=[^\]]*)?\]\s*\{\{enlaces_spoiler\}\}\s*\[\/spoiler\]/gi,
              '{{enlaces_spoiler}}'
            );
          } else {
            nextBody = currentBody.replace(
              /\[spoiler(?:=[^\]]*)?\]\s*\{\{enlaces_spoiler\}\}\s*\[\/spoiler\]/gi,
              spoilerBlock
            );
          }
        } else if (currentBody.includes('[/jd]')) {
          nextBody = currentBody.replace('[/jd]', `[/jd]\n\n${spoilerBlock}`);
        } else if (currentBody.trim().endsWith('[/center]')) {
          nextBody = currentBody.replace(/\[\/center\]\s*$/, `\n${spoilerBlock}\n[/center]`);
        } else {
          nextBody = `${currentBody}\n\n${spoilerBlock}`;
        }

        return {
          ...doc,
          customBody: nextBody,
          context: {
            ...doc.context,
            enlaces_spoiler: compiled.enlacesSpoiler,
            enlaces_identi: compiled.enlacesIdenti,
            servidores: compiled.servidores,
            enlaces_descarga: compiled.enlacesDescarga,
          },
        };
      }),
    }));
    showToast(
      `Links actualizados (${compiled.servidores}) · ${rows.length} enlace(s) insertados`,
      'success'
    );
  };

  const handleSelectYoutubeTrailer = (url: string, result?: YoutubeTrailerResult) => {
    const cleanUrl = normalizeYoutubeShortUrl(url);
    updateState((prev) => ({
      ...prev,
      openDocuments: prev.openDocuments.map((doc) => {
        if (doc.id !== prev.activeDocId) return doc;
        const tpl = prev.templates.find((t) => t.id === doc.templateId) || prev.templates[0];
        const currentBody = doc.customBody ?? tpl.bodyPattern;
        let nextBody = doc.customBody;
        if (
          !currentBody.toLowerCase().includes('{{trailer_url}}') &&
          !currentBody.toLowerCase().includes('[youtube]')
        ) {
          nextBody = `${currentBody}\n\n[center][youtube]{{trailer_url}}[/youtube][/center]`;
        }
        return {
          ...doc,
          customBody: nextBody,
          context: {
            ...doc.context,
            trailer_url: cleanUrl,
          },
        };
      }),
    }));
    showToast(
      result
        ? `▶ Trailer insertado en {{trailer_url}} (#${result.priorityRank} ${result.matchedPriorityLabel}): ${cleanUrl}`
        : `▶ Trailer insertado en {{trailer_url}}: ${cleanUrl}`,
      'success'
    );
  };

  const handleSaveCustomWorkspace = () => {
    const savedAt = Date.now();
    const cur = latestStateRef.current;
    const customPayload = {
      dockState: JSON.parse(JSON.stringify(cur.dockState)) as DockState,
      splitRatios: { ...cur.splitRatios },
      savedAt,
    };
    const nextSnapshot = {
      ...cur,
      savedCustomWorkspace: customPayload,
      activeWorkspacePreset: 'custom' as const,
      lastSavedAt: savedAt,
    };
    savePersistedState(nextSnapshot);
    updateState(
      (p) => ({
        ...p,
        savedCustomWorkspace: {
          dockState: JSON.parse(JSON.stringify(p.dockState)),
          splitRatios: { ...p.splitRatios },
          savedAt,
        },
        activeWorkspacePreset: 'custom',
      }),
      { recordUndo: false }
    );
    showToast('💾 Espacio de trabajo actual guardado en tu perfil', 'success');
  };

  const handleClearCustomWorkspace = () => {
    updateState(
      (p) => ({
        ...p,
        savedCustomWorkspace: null,
        activeWorkspacePreset: p.activeWorkspacePreset === 'custom' ? 'essentials' : p.activeWorkspacePreset,
      }),
      { recordUndo: false }
    );
    showToast('Espacio de trabajo guardado eliminado', 'info');
  };

  const handleApplyWorkspacePreset = (
    preset: 'essentials' | 'floating' | 'codefocus' | 'custom'
  ) => {
    if (preset === 'custom') {
      if (!state.savedCustomWorkspace) {
        showToast('Aún no has guardado ningún espacio de trabajo personalizado', 'warning');
        return;
      }
      updateState(
        (prev) => ({
          ...prev,
          dockState: JSON.parse(JSON.stringify(prev.savedCustomWorkspace!.dockState)),
          splitRatios: { ...prev.savedCustomWorkspace!.splitRatios },
          activeWorkspacePreset: 'custom',
        }),
        { recordUndo: false }
      );
      showToast('⭐ Mi Espacio de trabajo guardado cargado', 'success');
      return;
    }

    let nextDock: DockState = JSON.parse(JSON.stringify(DEFAULT_DOCK_STATE));
    if (preset === 'floating') {
      nextDock = {
        slots: {
          'left-top': { panels: ['editor'], active: 'editor' },
          'left-bottom': { panels: ['compiled'], active: 'compiled' },
          'center-main': { panels: [], active: null },
          'right-top': { panels: ['webview'], active: 'webview' },
          'right-bottom': { panels: ['mediainfo', 'layers'], active: 'mediainfo' },
          'bottom-main': { panels: [], active: null },
        },
        floating: [
          {
            id: 'covers',
            x: Math.max(80, window.innerWidth - 480),
            y: 140,
            w: 430,
            h: 310,
          },
        ],
      };
    } else if (preset === 'codefocus') {
      nextDock = {
        slots: {
          'left-top': { panels: ['editor', 'compiled'], active: 'editor' },
          'left-bottom': { panels: [], active: null },
          'center-main': { panels: [], active: null },
          'right-top': { panels: ['webview'], active: 'webview' },
          'right-bottom': { panels: [], active: null },
          'bottom-main': { panels: ['covers', 'mediainfo', 'layers'], active: 'covers' },
        },
        floating: [],
      };
    }

    updateState(
      (prev) => ({
        ...prev,
        dockState: nextDock,
        splitRatios: { ...DEFAULT_SPLIT_RATIOS },
        activeWorkspacePreset: preset,
      }),
      { recordUndo: false }
    );
    showToast(`Espacio de trabajo aplicado: ${preset.toUpperCase()}`, 'info');
  };

  const handleExportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `postpro-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Configuración exportada a JSON', 'success');
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PersistedAppState;
      if (!parsed || !parsed.config || !Array.isArray(parsed.openDocuments)) {
        throw new Error('Archivo de respaldo incompatible.');
      }
      const normalized = normalizePersistedState(parsed, { preserveScreen: true });
      setAppBundle({
        persisted: { ...normalized, lastSavedAt: Date.now() },
        undoStack: [],
        lastUndoPushAt: 0,
        lastUndoDocId: null,
      });
      showToast('Configuración importada y restaurada', 'success');
    } catch (err) {
      showToast(
        `Error importando backup: ${err instanceof Error ? err.message : 'Archivo inválido'}`,
        'error'
      );
    }
  };

  const handleResetAll = () => {
    resetPersistedState();
    setAppBundle({
      persisted: getInitialPersistedState(),
      undoStack: [],
      lastUndoPushAt: 0,
      lastUndoDocId: null,
    });
    setSettingsModal({ open: false, tab: 'paths' });
    showToast('Configuración restablecida a valores iniciales', 'info');
  };

  const handleRestoreIncrementalBackup = async (backupId: string) => {
    const target = incrementalBackups.find((b) => b.id === backupId);
    const restored = reconstructStateAtBackup(backupId, incrementalBackups);
    if (!restored || !restored.config || !Array.isArray(restored.openDocuments)) {
      showToast('No se pudo reconstruir el punto de restauración seleccionado.', 'error');
      return;
    }
    const normalized = normalizePersistedState(restored, { preserveScreen: true });
    setAppBundle((prevBundle) => ({
      persisted: { ...normalized, lastSavedAt: Date.now() },
      undoStack: [
        ...prevBundle.undoStack,
        {
          openDocuments: prevBundle.persisted.openDocuments,
          activeDocId: prevBundle.persisted.activeDocId,
          label: 'Restaurar respaldo incremental',
          timestamp: Date.now(),
        },
      ].slice(-clampUndoLimit(normalized.config.undoHistoryLimit)),
      lastUndoPushAt: 0,
      lastUndoDocId: null,
    }));
    const timeLabel = target
      ? new Date(target.createdAt).toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    showToast(
      `↺ Estado restaurado al respaldo ${timeLabel} (${
        target?.kind === 'full' ? 'Base completa' : `Incremental #${target?.sequence ?? 1}`
      })`,
      'success'
    );
  };

  const handleDownloadIncrementalBackup = async (backupId: string) => {
    const target = incrementalBackups.find((b) => b.id === backupId);
    const reconstructed = reconstructStateAtBackup(backupId, incrementalBackups);
    if (!reconstructed) {
      showToast('No se pudo reconstruir el archivo de copia.', 'error');
      return;
    }
    const stamp = new Date(target?.createdAt || Date.now())
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const blob = new Blob([JSON.stringify(reconstructed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `postpro-restore-${stamp}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Copia completa reconstruida y descargada (.json)', 'success');
  };

  const handleDeleteIncrementalBackup = async (backupId: string) => {
    const next = await deleteIncrementalBackupById(backupId);
    setIncrementalBackups(next);
    setLastBackupAt(next[0]?.createdAt ?? null);
    showToast('Entrada de respaldo eliminada', 'info');
  };

  const handleClearIncrementalBackups = async () => {
    await clearAllIncrementalBackups();
    setIncrementalBackups([]);
    setLastBackupAt(null);
    showToast('Historial de copias incrementales vaciado', 'info');
  };

  const handleLinkLocalBackupFolder = async () => {
    const res = await pickLocalBackupDirectory();
    if (!res.ok || !res.handle) {
      if (res.error) showToast(res.error, 'warning');
      return;
    }
    backupFolderHandleRef.current = res.handle;
    setBackupFolderHandleReady(true);
    handleUpdateConfig({ autoBackupFolderName: res.folderName || 'Carpeta local' });
    showToast(`Carpeta local de respaldos vinculada: ${res.folderName}`, 'success');
  };

  const handleUnlinkLocalBackupFolder = async () => {
    backupFolderHandleRef.current = null;
    setBackupFolderHandleReady(false);
    await saveBackupDirectoryHandle(null);
    handleUpdateConfig({ autoBackupFolderName: null });
    showToast('Carpeta local de respaldos desvinculada', 'info');
  };

  const isAnyAppModalOpen =
    settingsModal.open ||
    connectApiOpen ||
    pluginsModal.open ||
    spoilerLinksOpen ||
    youtubeTrailerOpen ||
    aboutOpen;

  useHotkeys(
    [
      {
        combo: 'mod+n',
        description: 'Nuevo documento',
        enabled: state.screen === 'workspace' && !isAnyAppModalOpen,
        handler: () => {
          handleCreateDocument();
          showToast('📄 Nuevo documento creado (Ctrl+N)', 'success');
        },
      },
      {
        combo: 'mod+s',
        description: 'Guardar',
        enabled: state.screen !== 'welcome',
        allowInModal: true,
        handler: () => {
          handleSaveWorkspace();
        },
      },
      {
        combo: 'mod+k',
        description: 'Cambiar estilo de sitio',
        enabled: state.screen === 'workspace' && !isAnyAppModalOpen,
        handler: () => {
          handleSwitchSiteStyle(activeSite === 'zinfinal' ? 'identi' : 'zinfinal');
        },
      },
      {
        combo: 'mod+z',
        description: 'Deshacer cambio',
        enabled: state.screen === 'workspace' && !isAnyAppModalOpen,
        handler: () => {
          handleUndo();
        },
      },
    ],
    true
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-sans bg-void text-slate-100">
      {state.screen === 'welcome' && (
        <WelcomeScreen
          hasSavedConfig={state.onboardingCompleted}
          onStartSetup={() => handleSelectScreen('setup')}
          onSkipToWorkspace={() => handleSelectScreen('workspace')}
        />
      )}

      {state.screen === 'setup' && (
        <SetupScreen
          config={state.config}
          onUpdateConfig={handleUpdateConfig}
          onImportTemplatesFromFolder={handleImportTemplatesFromFolder}
          onBack={() => handleSelectScreen('welcome')}
          onFinish={() => {
            handleSelectScreen('workspace');
            showToast('Configuración guardada automáticamente en PostPro Studio', 'success');
          }}
          onToast={showToast}
        />
      )}

      {state.screen === 'workspace' && (
        <Workspace
          config={state.config}
          templates={state.templates}
          openDocuments={state.openDocuments}
          activeDocId={state.activeDocId}
          recentProjects={state.recentProjects || []}
          apiProviders={state.apiProviders}
          activeApiProviderId={state.activeApiProviderId}
          miniMenuTools={state.miniMenuTools}
          functionalPlugins={state.functionalPlugins}
          dockState={state.dockState}
          splitRatios={state.splitRatios}
          isWorkspaceLocked={state.isWorkspaceLocked}
          lastSavedAt={state.lastSavedAt}
          lastBackupAt={lastBackupAt}
          nextBackupAt={nextBackupAt}
          backupCount={incrementalBackups.length}
          backupRunning={backupRunning}
          hasCustomSavedWorkspace={Boolean(state.savedCustomWorkspace)}
          customWorkspaceSavedAt={state.savedCustomWorkspace?.savedAt ?? null}
          activeWorkspacePreset={state.activeWorkspacePreset || 'essentials'}
          undoCount={undoStack.length}
          undoLimit={undoLimit}
          lastUndoLabel={undoStack[undoStack.length - 1]?.label ?? null}
          renderedPost={renderedPost}
          onUndo={handleUndo}
          onSaveNow={handleSaveWorkspace}
          onSwitchSiteStyle={handleSwitchSiteStyle}
          onSelectScreen={handleSelectScreen}
          onSwitchDocument={(docId) => updateState((p) => ({ ...p, activeDocId: docId }))}
          onCreateDocument={handleCreateDocument}
          onCloseDocument={handleCloseDocument}
          onUpdateActiveDoc={handleUpdateActiveDoc}
          onRecordRecentProject={handleRecordRecentProject}
          onOpenRecentProject={handleOpenRecentProject}
          onRemoveRecentProject={handleRemoveRecentProject}
          onClearRecentProjects={handleClearRecentProjects}
          onCreateTemplate={handleCreateTemplate}
          onSelectApiProvider={(id) => updateState((p) => ({ ...p, activeApiProviderId: id }))}
          onRunActiveApi={handleRunActiveApi}
          onOpenConnectApi={() => setConnectApiOpen(true)}
          onOpenPlugins={(tab = 'installed') => setPluginsModal({ open: true, tab })}
          onOpenSettings={(tab = 'paths') => setSettingsModal({ open: true, tab })}
          onOpenSpoilerLinks={() => setSpoilerLinksOpen(true)}
          onOpenYoutubeSearch={() => setYoutubeTrailerOpen(true)}
          onOpenAbout={() => setAboutOpen(true)}
          onUpdateConfig={handleUpdateConfig}
          onToggleLock={() =>
            updateState((p) => ({ ...p, isWorkspaceLocked: !p.isWorkspaceLocked }))
          }
          onUpdateDockState={(next: DockState) => updateState((p) => ({ ...p, dockState: next }))}
          onUpdateSplitRatios={(next: SplitRatios) =>
            updateState((p) => ({ ...p, splitRatios: next }))
          }
          onSaveCustomWorkspace={handleSaveCustomWorkspace}
          onClearCustomWorkspace={handleClearCustomWorkspace}
          onApplyWorkspacePreset={handleApplyWorkspacePreset}
          onImportPostTemplate={handleImportPostTemplate}
          onToast={showToast}
        />
      )}

      <SettingsModal
        open={settingsModal.open}
        initialTab={settingsModal.tab}
        config={state.config}
        apiProviders={state.apiProviders}
        apiPingStatuses={apiPingStatuses}
        miniMenuTools={state.miniMenuTools}
        incrementalBackups={incrementalBackups}
        backupsLoading={backupsLoading}
        backupRunning={backupRunning}
        lastBackupAt={lastBackupAt}
        nextBackupAt={nextBackupAt}
        backupFolderHandleReady={backupFolderHandleReady}
        onClose={() => setSettingsModal((s) => ({ ...s, open: false }))}
        onUpdateConfig={handleUpdateConfig}
        onUpdatePingStatuses={setApiPingStatuses}
        onImportTemplatesFromFolder={handleImportTemplatesFromFolder}
        onUpdateMiniMenu={(items: FloatingToolItem[]) =>
          updateState((p) => ({ ...p, miniMenuTools: items }))
        }
        onTriggerIncrementalBackup={(forceFull) =>
          runIncrementalBackupCycle({ trigger: 'manual', forceFull })
        }
        onRestoreIncrementalBackup={handleRestoreIncrementalBackup}
        onDownloadIncrementalBackup={handleDownloadIncrementalBackup}
        onDeleteIncrementalBackup={handleDeleteIncrementalBackup}
        onClearIncrementalBackups={handleClearIncrementalBackups}
        onLinkLocalBackupFolder={handleLinkLocalBackupFolder}
        onUnlinkLocalBackupFolder={handleUnlinkLocalBackupFolder}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        onResetAll={handleResetAll}
        onToast={showToast}
      />

      <ConnectApiModal
        open={connectApiOpen}
        config={state.config}
        defaultQuery={activeDoc?.context?.titulo || 'Frieren'}
        onClose={() => setConnectApiOpen(false)}
        onUpdateConfig={handleUpdateConfig}
        onSaveProvider={handleSaveApiProvider}
        onToast={showToast}
      />

      <PluginsModal
        open={pluginsModal.open}
        initialTab={pluginsModal.tab}
        themes={allThemes}
        activeThemeId={state.activeThemeId}
        functionalPlugins={state.functionalPlugins}
        onClose={() => setPluginsModal((p) => ({ ...p, open: false }))}
        onToggleFunctionalPlugin={(id) =>
          updateState((p) => ({
            ...p,
            functionalPlugins: p.functionalPlugins.map((ext) =>
              ext.id === id ? { ...ext, enabled: !ext.enabled } : ext
            ),
          }))
        }
        onApplyTheme={(id) => {
          updateState((p) => ({ ...p, activeThemeId: id }));
          showToast('Tema aplicado y guardado', 'info');
        }}
        onInstallCustomTheme={(theme: ThemePlugin) => {
          updateState((p) => {
            const exists = p.customThemes.some((t) => t.id === theme.id);
            const nextThemes = exists
              ? p.customThemes.map((t) => (t.id === theme.id ? theme : t))
              : [...p.customThemes, theme];
            return { ...p, customThemes: nextThemes, activeThemeId: theme.id };
          });
          showToast(`Tema "${theme.name}" instalado y activado`, 'success');
        }}
        onInstallCustomExtension={(ext: FunctionalPlugin) => {
          updateState((p) => ({
            ...p,
            functionalPlugins: [...p.functionalPlugins, ext],
          }));
          showToast(`Extensión "${ext.name}" instalada`, 'success');
        }}
        onToast={showToast}
      />

      <SpoilerLinksModal
        open={spoilerLinksOpen}
        initialRawSpoiler={
          activeDoc?.context?.enlaces_spoiler || activeDoc?.context?.enlaces_identi || ''
        }
        initialCustomLinkTemplate={
          state.config.customLinkTemplate || DEFAULT_CUSTOM_LINK_TEMPLATE
        }
        activeSite={inferTemplateSite(
          state.templates.find((t) => t.id === activeDoc?.templateId) || state.templates[0]
        )}
        onClose={() => setSpoilerLinksOpen(false)}
        onEmbed={handleEmbedSpoilerLinks}
        onToast={showToast}
      />

      <YoutubeTrailerModal
        open={youtubeTrailerOpen}
        initialTitle={activeDoc?.context?.titulo || ''}
        initialYear={activeDoc?.context?.anio || ''}
        currentTrailerUrl={activeDoc?.context?.trailer_url || ''}
        tmdbId={activeDoc?.context?.tmdb_id || ''}
        mediaType={activeDoc?.context?.media_type || ''}
        config={state.config}
        onUpdateConfig={handleUpdateConfig}
        onSelectTrailer={handleSelectYoutubeTrailer}
        onClose={() => setYoutubeTrailerOpen(false)}
        onToast={showToast}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {/* TOASTS */}
      <div className="fixed bottom-8 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const borderCls =
            t.type === 'success'
              ? 'border-cyberGreen text-cyberGreen'
              : t.type === 'warning'
              ? 'border-amber-400 text-amber-300'
              : t.type === 'error'
              ? 'border-red-500 text-red-400'
              : 'border-cyberCyan text-cyberCyan';
          return (
            <div
              key={t.id}
              className={`anim-enter bg-panel/95 border ${borderCls} rounded-xl px-3.5 py-2 shadow-2xl font-mono text-[11px] backdrop-blur-md max-w-md`}
            >
              {t.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}
