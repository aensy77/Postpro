import {
  DEFAULT_API_PROVIDERS,
  DEFAULT_DOCK_STATE,
  DEFAULT_FUNCTIONAL_PLUGINS,
  DEFAULT_MINI_MENU,
  DEFAULT_OPEN_DOCUMENTS,
  DEFAULT_SPLIT_RATIOS,
  DEFAULT_TEMPLATES,
  DEFAULT_USER_CONFIG,
  DEFAULT_YOUTUBE_PRIORITIES,
  THEME_PLUGINS,
} from '../data/defaults';
import type {
  ApiProviderConfig,
  BbTemplate,
  DockState,
  FloatingToolItem,
  FunctionalPlugin,
  MediaContext,
  OpenDocument,
  RecentMediaProject,
  ScreenMode,
  SplitRatios,
  ThemePlugin,
  UserConfig,
} from '../types';

const STORAGE_KEY = 'postpro_studio_persisted_v2';

export interface PersistedAppState {
  version: number;
  lastSavedAt: number;
  screen: ScreenMode;
  onboardingCompleted: boolean;
  config: UserConfig;
  activeThemeId: string;
  customThemes: ThemePlugin[];
  functionalPlugins: FunctionalPlugin[];
  apiProviders: ApiProviderConfig[];
  activeApiProviderId: string;
  templates: BbTemplate[];
  openDocuments: OpenDocument[];
  activeDocId: string;
  recentProjects: RecentMediaProject[];
  miniMenuTools: FloatingToolItem[];
  dockState: DockState;
  splitRatios: SplitRatios;
  isWorkspaceLocked: boolean;
  savedCustomWorkspace?: {
    dockState: DockState;
    splitRatios: SplitRatios;
    savedAt?: number;
  } | null;
  activeWorkspacePreset?: 'essentials' | 'floating' | 'codefocus' | 'custom';
}

export function buildLightweightContextSnapshot(context: MediaContext): Partial<MediaContext> {
  const snapshot: Partial<MediaContext> = {};
  for (const [k, val] of Object.entries(context)) {
    if (typeof val !== 'string' || !val) continue;
    // Skip very large inline base64 raster images to keep localStorage fast and within quota
    if (val.includes('data:image/') && !val.startsWith('data:image/svg+xml') && val.length > 16000) {
      continue;
    }
    snapshot[k] = val;
  }
  return snapshot;
}

export function createDefaultPersistedState(): PersistedAppState {
  return {
    version: 3,
    lastSavedAt: Date.now(),
    screen: 'welcome',
    onboardingCompleted: false,
    config: { ...DEFAULT_USER_CONFIG },
    activeThemeId: THEME_PLUGINS[0].id,
    customThemes: [],
    functionalPlugins: DEFAULT_FUNCTIONAL_PLUGINS.map((p) => ({ ...p })),
    apiProviders: DEFAULT_API_PROVIDERS.map((a) => ({ ...a })),
    activeApiProviderId: DEFAULT_API_PROVIDERS[0].id,
    templates: DEFAULT_TEMPLATES.map((t) => ({ ...t })),
    openDocuments: DEFAULT_OPEN_DOCUMENTS.map((d) => ({ ...d, context: { ...d.context } })),
    activeDocId: DEFAULT_OPEN_DOCUMENTS[0].id,
    recentProjects: [],
    miniMenuTools: DEFAULT_MINI_MENU.map((m) => ({ ...m })),
    dockState: JSON.parse(JSON.stringify(DEFAULT_DOCK_STATE)),
    splitRatios: { ...DEFAULT_SPLIT_RATIOS },
    isWorkspaceLocked: true,
    savedCustomWorkspace: null,
    activeWorkspacePreset: 'essentials',
  };
}

export function normalizePersistedState(
  parsed: Partial<PersistedAppState>,
  options?: { preserveScreen?: boolean }
): PersistedAppState {
  const fallback = createDefaultPersistedState();
  if (!parsed || typeof parsed !== 'object') return fallback;

  const mergedProviders = (() => {
    const saved = Array.isArray(parsed.apiProviders) && parsed.apiProviders.length > 0
      ? parsed.apiProviders
      : [];
    if (saved.length === 0) return fallback.apiProviders;
      const savedIds = new Set(saved.map((p) => p.id));
      const migratedSaved = saved.map((p) => {
        if (
          p.id === 'prov-tmdb' &&
          p.mappings?.banner_url?.includes('backdrop_path') &&
          !p.mappings?.background_url
        ) {
          const { banner_url, ...restMappings } = p.mappings;
          return {
            ...p,
            mappings: {
              ...restMappings,
              background_url: banner_url,
            },
          };
        }
        return p;
      });
      const extras = DEFAULT_API_PROVIDERS.filter((dp) => !savedIds.has(dp.id)).map((dp) => ({ ...dp }));
      return [...migratedSaved, ...extras];
    })();

    const mergedTemplates = (() => {
      const saved = Array.isArray(parsed.templates) && parsed.templates.length > 0
        ? parsed.templates
        : [];
      if (saved.length === 0) return fallback.templates;
      const savedIds = new Set(saved.map((t) => t.id));
      // Ensure the new Zinfinal and Identi site templates are always available alongside user templates
      const builtInsToInject = DEFAULT_TEMPLATES.filter((dt) => !savedIds.has(dt.id)).map((dt) => ({ ...dt }));
      const normalizedSaved = saved.map((t) => {
        const site =
          t.site || (t.id.includes('identi') ? 'identi' : t.id.includes('zinfinal') ? 'zinfinal' : 'custom');
        const nextName =
          t.id === 'tpl-zinfinal-main' && t.name === 'Zinfinal — Películas / Anime / Series'
            ? 'Zinfinal Aensy Style'
            : t.name;
        const nextBody =
          t.id === 'tpl-zinfinal-main' || t.id === 'tpl-zinfinal-music'
            ? t.bodyPattern.replace(
                /\[center\]\[spoiler\]\s*\{\{enlaces_spoiler\}\}\s*\[\/spoiler\]\[\/center\]/gi,
                '{{enlaces_spoiler}}'
              )
            : t.bodyPattern;
        return {
          ...t,
          name: nextName,
          site,
          bodyPattern: nextBody,
        };
      });
      return [...builtInsToInject, ...normalizedSaved];
    })();

    const defaultEmptyCtx: Partial<MediaContext> = {
      clearart_url: fallback.openDocuments[0].context.clearart_url,
      background_url: fallback.openDocuments[0].context.background_url,
      fuente: fallback.openDocuments[0].context.fuente,
      servidores: fallback.openDocuments[0].context.servidores,
      creditos: fallback.openDocuments[0].context.creditos,
      notas_uploader: fallback.openDocuments[0].context.notas_uploader,
      capitulos: fallback.openDocuments[0].context.capitulos,
      password: fallback.openDocuments[0].context.password,
      video_info_bloque: fallback.openDocuments[0].context.video_info_bloque,
      video_info_identi: fallback.openDocuments[0].context.video_info_identi,
      subtitulos_info: fallback.openDocuments[0].context.subtitulos_info,
      subtitulos_identi: fallback.openDocuments[0].context.subtitulos_identi,
      audio_info_bloque: fallback.openDocuments[0].context.audio_info_bloque,
      audio_info_identi: fallback.openDocuments[0].context.audio_info_identi,
      enlaces_identi: fallback.openDocuments[0].context.enlaces_identi,
      tmdb_id: '',
      imdb_id: '',
      tvdb_id: '',
      mbid_id: '',
      media_type: '',
    };

    const rawOpenDocs =
      Array.isArray(parsed.openDocuments) && parsed.openDocuments.length > 0
        ? parsed.openDocuments
        : fallback.openDocuments;

    const templateIdSet = new Set(mergedTemplates.map((t) => t.id));
    const openDocs: OpenDocument[] = rawOpenDocs.map((d) => ({
      ...d,
      templateId: templateIdSet.has(d.templateId) ? d.templateId : mergedTemplates[0].id,
      context: {
        ...defaultEmptyCtx,
        ...d.context,
      } as MediaContext,
    }));

    const validActiveDocId = openDocs.some((d) => d.id === parsed.activeDocId)
      ? (parsed.activeDocId as string)
      : openDocs[0].id;

    return {
      ...fallback,
      ...parsed,
      screen: options?.preserveScreen
        ? (parsed.screen || (parsed.onboardingCompleted ? 'workspace' : 'welcome'))
        : parsed.onboardingCompleted
        ? 'workspace'
        : parsed.screen || 'welcome',
      config: {
        ...fallback.config,
        ...(parsed.config || {}),
        fanartApiKey:
          typeof parsed.config?.fanartApiKey === 'string'
            ? parsed.config.fanartApiKey
            : fallback.config.fanartApiKey,
        fanartClientKey:
          typeof parsed.config?.fanartClientKey === 'string'
            ? parsed.config.fanartClientKey
            : fallback.config.fanartClientKey,
        youtubeApiKey:
          typeof parsed.config?.youtubeApiKey === 'string'
            ? parsed.config.youtubeApiKey
            : fallback.config.youtubeApiKey,
        youtubeTrailerPriorities:
          Array.isArray(parsed.config?.youtubeTrailerPriorities) &&
          parsed.config.youtubeTrailerPriorities.length > 0
            ? parsed.config.youtubeTrailerPriorities
            : DEFAULT_YOUTUBE_PRIORITIES.map((r) => ({ ...r })),
        connectedApiIds: Array.isArray(parsed.config?.connectedApiIds)
          ? parsed.config.connectedApiIds
          : fallback.config.connectedApiIds,
        savedPasswords: Array.isArray(parsed.config?.savedPasswords)
          ? parsed.config.savedPasswords
          : fallback.config.savedPasswords,
        autoEnrichOnDrop:
          typeof parsed.config?.autoEnrichOnDrop === 'boolean'
            ? parsed.config.autoEnrichOnDrop
            : fallback.config.autoEnrichOnDrop,
        watermarkUser:
          typeof parsed.config?.watermarkUser === 'string'
            ? parsed.config.watermarkUser
            : fallback.config.watermarkUser,
        watermarkPlace:
          typeof parsed.config?.watermarkPlace === 'string'
            ? parsed.config.watermarkPlace
            : fallback.config.watermarkPlace,
        watermarkPosition: parsed.config?.watermarkPosition || fallback.config.watermarkPosition,
        watermarkOpacity:
          typeof parsed.config?.watermarkOpacity === 'number'
            ? parsed.config.watermarkOpacity
            : fallback.config.watermarkOpacity,
        watermarkColor: parsed.config?.watermarkColor || fallback.config.watermarkColor,
        watermarkScale: parsed.config?.watermarkScale || fallback.config.watermarkScale,
        autoBackupEnabled:
          typeof parsed.config?.autoBackupEnabled === 'boolean'
            ? parsed.config.autoBackupEnabled
            : fallback.config.autoBackupEnabled,
        autoBackupIntervalMinutes:
          typeof parsed.config?.autoBackupIntervalMinutes === 'number' &&
          parsed.config.autoBackupIntervalMinutes >= 1
            ? parsed.config.autoBackupIntervalMinutes
            : fallback.config.autoBackupIntervalMinutes,
        autoBackupFolderName:
          typeof parsed.config?.autoBackupFolderName === 'string'
            ? parsed.config.autoBackupFolderName
            : fallback.config.autoBackupFolderName,
        autoBackupCloudUrl:
          typeof parsed.config?.autoBackupCloudUrl === 'string'
            ? parsed.config.autoBackupCloudUrl
            : fallback.config.autoBackupCloudUrl,
        customLinkTemplate:
          typeof parsed.config?.customLinkTemplate === 'string' && parsed.config.customLinkTemplate.trim()
            ? parsed.config.customLinkTemplate
            : fallback.config.customLinkTemplate,
        captureCount:
          typeof parsed.config?.captureCount === 'number' &&
          parsed.config.captureCount >= 1 &&
          parsed.config.captureCount <= 16
            ? Math.round(parsed.config.captureCount)
            : fallback.config.captureCount,
        captureCompressionPercent:
          typeof parsed.config?.captureCompressionPercent === 'number' &&
          parsed.config.captureCompressionPercent >= 5 &&
          parsed.config.captureCompressionPercent <= 75
            ? Math.round(parsed.config.captureCompressionPercent)
            : fallback.config.captureCompressionPercent,
        undoHistoryLimit:
          typeof parsed.config?.undoHistoryLimit === 'number' &&
          parsed.config.undoHistoryLimit >= 1 &&
          parsed.config.undoHistoryLimit <= 100
            ? Math.round(parsed.config.undoHistoryLimit)
            : fallback.config.undoHistoryLimit,
      },
      customThemes: Array.isArray(parsed.customThemes) ? parsed.customThemes : [],
      functionalPlugins:
        Array.isArray(parsed.functionalPlugins) && parsed.functionalPlugins.length > 0
          ? parsed.functionalPlugins
          : fallback.functionalPlugins,
      apiProviders: mergedProviders,
      templates: mergedTemplates,
      openDocuments: openDocs,
      activeDocId: validActiveDocId,
      recentProjects: Array.isArray(parsed.recentProjects)
        ? parsed.recentProjects.slice(0, 12)
        : [],
      miniMenuTools:
        Array.isArray(parsed.miniMenuTools) && parsed.miniMenuTools.length > 0
          ? parsed.miniMenuTools
          : fallback.miniMenuTools,
      dockState: (() => {
        const loadedDock: DockState = parsed.dockState?.slots
          ? parsed.dockState
          : fallback.dockState;
        const isLegacySchema = typeof parsed.version !== 'number' || parsed.version < 3;
        if (isLegacySchema) {
          const hasMediaInfo =
            Object.values(loadedDock.slots).some((s) => s.panels.includes('mediainfo')) ||
            loadedDock.floating.some((f) => f.id === 'mediainfo');
          if (!hasMediaInfo) {
            const rb = loadedDock.slots['right-bottom'] || { panels: [], active: null };
            return {
              ...loadedDock,
              slots: {
                ...loadedDock.slots,
                'right-bottom': {
                  panels: [...rb.panels, 'mediainfo'],
                  active: rb.active || 'mediainfo',
                },
              },
            };
          }
        }
        return loadedDock;
      })(),
      splitRatios: { ...fallback.splitRatios, ...(parsed.splitRatios || {}) },
      isWorkspaceLocked:
        typeof parsed.isWorkspaceLocked === 'boolean' ? parsed.isWorkspaceLocked : true,
      savedCustomWorkspace:
        parsed.savedCustomWorkspace && parsed.savedCustomWorkspace.dockState?.slots
          ? {
              dockState: parsed.savedCustomWorkspace.dockState,
              splitRatios: {
                ...fallback.splitRatios,
                ...(parsed.savedCustomWorkspace.splitRatios || {}),
              },
              savedAt:
                typeof parsed.savedCustomWorkspace.savedAt === 'number'
                  ? parsed.savedCustomWorkspace.savedAt
                  : undefined,
            }
          : null,
      activeWorkspacePreset:
        parsed.activeWorkspacePreset === 'floating' ||
        parsed.activeWorkspacePreset === 'codefocus' ||
        parsed.activeWorkspacePreset === 'essentials' ||
        (parsed.activeWorkspacePreset === 'custom' && parsed.savedCustomWorkspace?.dockState?.slots)
          ? parsed.activeWorkspacePreset
          : 'essentials',
    };
}

export function getInitialPersistedState(): PersistedAppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultPersistedState();
    const parsed = JSON.parse(raw) as Partial<PersistedAppState>;
    return normalizePersistedState(parsed);
  } catch {
    return createDefaultPersistedState();
  }
}

export function savePersistedState(
  state: PersistedAppState
): { ok: boolean; savedAt: number; compacted?: boolean } {
  const savedAt = Date.now();
  const payload = { ...state, version: 3, lastSavedAt: savedAt };
  try {
    const serialized = JSON.stringify(payload);
    localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true, savedAt };
  } catch {
    // Fallback: strip oversized base64 images from openDocuments so config, keys & templates are never lost
    try {
      const compactDocs = payload.openDocuments.map((doc) => ({
        ...doc,
        context: {
          ...doc.context,
          ...Object.fromEntries(
            Object.entries(doc.context).map(([k, val]) => {
              if (
                typeof val === 'string' &&
                val.includes('data:image/') &&
                !val.startsWith('data:image/svg+xml') &&
                val.length > 16000
              ) {
                return [k, ''];
              }
              return [k, val];
            })
          ),
        } as MediaContext,
      }));
      const compactPayload: PersistedAppState = {
        ...payload,
        openDocuments: compactDocs,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactPayload));
      return { ok: true, savedAt, compacted: true };
    } catch {
      return { ok: false, savedAt };
    }
  }
}

export function resetPersistedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
