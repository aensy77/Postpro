import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ApiProviderConfig,
  BbTemplate,
  DockSlotKey,
  DockState,
  FanartArtworkItem,
  FloatingToolItem,
  FunctionalPlugin,
  MediaContext,
  MediaInfoDetails,
  OpenDocument,
  PanelId,
  RecentMediaProject,
  SavedPasswordEntry,
  ScreenMode,
  SplitRatios,
  TemplateSite,
  ToolKey,
  UserConfig,
  WatermarkSettings,
} from '../types';
import {
  automatePostEnrichment,
  executeApiProvider,
  fetchFanartBanners,
  fetchFanartClearArts,
  fetchFanartLogos,
  fetchFanartTvArtwork,
  fetchOmdbArtwork,
  fetchTmdbArtwork,
  getConnectedMetadataProviders,
  isApiProviderConnected,
  pickBestConnectedProvider,
  uploadImageToHost,
} from '../utils/apiClient';
import type { RenderedPostResult } from '../App';
import {
  detectPasswordHeadingInfo,
  ensurePasswordVariableBelowHeading,
  hasPasswordVariableInPost,
} from '../utils/bbcode';
import { type BbDiagnostic, validateBbCode } from '../utils/bbcodeValidator';
import { formatBytes, pickLocalDirectory, pickMultipleMediaFiles } from '../utils/filePicker';
import {
  type AnalyzedImageAsset,
  analyzeImageAsset,
  buildCapturesBbCode,
  compressionPercentToQuality,
  extractImagesFromContext,
  HOST_IMAGE_POLICIES,
  optimizeAndBuildCapturesBbCode,
  optimizeLocalImageDataUrl,
} from '../utils/imageAnalyzer';
import { analyzeDroppedFiles } from '../utils/mediaAnalyzer';
import { buildLightweightContextSnapshot } from '../utils/storage';
import { applyWatermarkToDataUrl } from '../utils/watermark';
import {
  IdentifyMediaModal,
  type IdentifyMediaPayload,
  MediaIngestModal,
  PasswordManagerModal,
  ShortcutsModal,
  TemplateExportModal,
  WatermarkPromptModal,
} from './Modals';
import { APP_INFO, PostProLogo } from './PostProLogo';

interface WorkspaceProps {
  config: UserConfig;
  templates: BbTemplate[];
  openDocuments: OpenDocument[];
  activeDocId: string;
  apiProviders: ApiProviderConfig[];
  activeApiProviderId: string;
  recentProjects: RecentMediaProject[];
  miniMenuTools: FloatingToolItem[];
  functionalPlugins: FunctionalPlugin[];
  dockState: DockState;
  splitRatios: SplitRatios;
  isWorkspaceLocked: boolean;
  lastSavedAt: number;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  backupCount: number;
  backupRunning: boolean;
  hasCustomSavedWorkspace: boolean;
  customWorkspaceSavedAt: number | null;
  activeWorkspacePreset: 'essentials' | 'floating' | 'codefocus' | 'custom';
  undoCount: number;
  undoLimit: number;
  lastUndoLabel: string | null;
  renderedPost: RenderedPostResult;
  onUndo: () => void;
  onSaveNow: () => void;
  onSwitchSiteStyle: (site: 'zinfinal' | 'identi') => void;
  onSelectScreen: (screen: ScreenMode) => void;
  onSwitchDocument: (docId: string) => void;
  onCreateDocument: () => void;
  onCloseDocument: (docId: string) => void;
  onUpdateActiveDoc: (updater: (doc: OpenDocument) => OpenDocument) => void;
  onRecordRecentProject: (project: RecentMediaProject) => void;
  onOpenRecentProject: (project: RecentMediaProject, mode?: 'new-tab' | 'current-tab') => void;
  onRemoveRecentProject: (id: string) => void;
  onClearRecentProjects: () => void;
  onCreateTemplate: (name: string, site?: TemplateSite) => void;
  onSelectApiProvider: (id: string) => void;
  onRunActiveApi: (queryOverride?: string) => Promise<void>;
  onOpenConnectApi: () => void;
  onOpenPlugins: (tab?: 'installed' | 'import') => void;
  onOpenSettings: (tab?: 'paths' | 'imghost' | 'minimenu' | 'backups') => void;
  onOpenSpoilerLinks: () => void;
  onOpenYoutubeSearch: () => void;
  onOpenAbout: () => void;
  onUpdateConfig: (patch: Partial<UserConfig>) => void;
  onToggleLock: () => void;
  onUpdateDockState: (next: DockState) => void;
  onUpdateSplitRatios: (next: SplitRatios) => void;
  onSaveCustomWorkspace: () => void;
  onClearCustomWorkspace: () => void;
  onApplyWorkspacePreset: (preset: 'essentials' | 'floating' | 'codefocus' | 'custom') => void;
  onImportPostTemplate?: (text: string) => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const ALL_PANEL_IDS: PanelId[] = [
  'editor',
  'compiled',
  'webview',
  'covers',
  'mediainfo',
  'layers',
];

const PANEL_META: Record<PanelId, { title: string; icon: string; defaultSlot: DockSlotKey }> = {
  editor: { title: 'Editor BBCode', icon: '📝', defaultSlot: 'left-top' },
  compiled: { title: 'BBCode Compilado', icon: '⚙️', defaultSlot: 'left-bottom' },
  webview: { title: 'Visor WebView2', icon: '🌐', defaultSlot: 'right-top' },
  covers: { title: 'Covers & Assets', icon: '🖼️', defaultSlot: 'right-bottom' },
  mediainfo: { title: 'MediaInfo Técnico', icon: '📊', defaultSlot: 'right-bottom' },
  layers: { title: 'Capas / Streams', icon: '📑', defaultSlot: 'right-bottom' },
};

const SLOT_NAMES: Record<DockSlotKey, string> = {
  'left-top': 'Zona Izquierda (Superior)',
  'left-bottom': 'Zona Izquierda (Inferior)',
  'center-main': 'Zona Central',
  'right-top': 'Zona Derecha (Superior)',
  'right-bottom': 'Zona Derecha (Inferior)',
  'bottom-main': 'Dock Inferior',
};

const TOOL_NAMES: Record<ToolKey, string> = {
  covers: 'Covers e Imágenes',
  text: 'Texto y Tipografía BBCode',
  align: 'Alineación y Bloques',
  media: 'Multimedia y Capturas',
  links: 'Spoiler Links y JDownloader',
  vars: 'Variables y APIs',
  templates: 'Gestor de Plantillas',
  ingest: 'Escanear medios',
  artgallery: 'Selección Visual de Arte',
};

const COVER_SLOTS: Array<{ key: keyof MediaContext; label: string }> = [
  { key: 'poster_url', label: 'Portada' },
  { key: 'logo_url', label: 'Logo HD' },
  { key: 'banner_url', label: 'Banner' },
  { key: 'clearart_url', label: 'ClearArt' },
  { key: 'background_url', label: 'Fondo 4K' },
  { key: 'thumb_url', label: 'Miniatura' },
  { key: 'separator_url', label: 'Separador' },
];

export const Workspace: React.FC<WorkspaceProps> = ({
  config,
  templates,
  openDocuments,
  activeDocId,
  apiProviders,
  activeApiProviderId,
  recentProjects,
  miniMenuTools,
  functionalPlugins,
  dockState,
  splitRatios,
  isWorkspaceLocked,
  lastSavedAt,
  lastBackupAt,
  nextBackupAt,
  backupCount,
  backupRunning,
  hasCustomSavedWorkspace,
  customWorkspaceSavedAt,
  activeWorkspacePreset,
  undoCount,
  undoLimit,
  lastUndoLabel,
  renderedPost,
  onUndo,
  onSaveNow,
  onSwitchSiteStyle,
  onSelectScreen,
  onSwitchDocument,
  onCreateDocument,
  onCloseDocument,
  onUpdateActiveDoc,
  onRecordRecentProject,
  onOpenRecentProject,
  onRemoveRecentProject,
  onClearRecentProjects,
  onCreateTemplate,
  onSelectApiProvider,
  onRunActiveApi,
  onOpenConnectApi,
  onOpenPlugins,
  onOpenSettings,
  onOpenSpoilerLinks,
  onOpenYoutubeSearch,
  onOpenAbout,
  onUpdateConfig,
  onToggleLock,
  onUpdateDockState,
  onUpdateSplitRatios,
  onSaveCustomWorkspace,
  onClearCustomWorkspace,
  onApplyWorkspacePreset,
  onImportPostTemplate,
  onToast,
}) => {
  const activeDoc = useMemo(
    () => openDocuments.find((d) => d.id === activeDocId) || openDocuments[0],
    [openDocuments, activeDocId]
  );
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeDoc.templateId) || templates[0],
    [templates, activeDoc.templateId]
  );

  const rawTitle = activeDoc.customTitle ?? activeTemplate.titlePattern;
  const rawBody = activeDoc.customBody ?? activeTemplate.bodyPattern;
  const { compiledTitle, compiledBodyWithMarkers, cleanBbCode } = renderedPost;

  const bbValidation = useMemo(() => validateBbCode(rawBody), [rawBody]);

  const [activeTool, setActiveTool] = useState<ToolKey>('covers');
  const [flyoutTool, setFlyoutTool] = useState<ToolKey | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ left: number; top: number }>({ left: 52, top: 80 });
  const [openTopMenu, setOpenTopMenu] = useState<{ key: string; left: number; top: number } | null>(null);

  const [fgColor, setFgColor] = useState('#00f0ff');
  const [bgColor, setBgColor] = useState('#ff0055');
  const [showMiniMenu, setShowMiniMenu] = useState(false);

  const [selectedCoverSlot, setSelectedCoverSlot] = useState<string>('poster_url');
  const [coverUrlDraft, setCoverUrlDraft] = useState(activeDoc.context.poster_url || '');
  const [uploadingCover, setUploadingCover] = useState(false);

  const [newTplName, setNewTplName] = useState('');
  const [newTplSite, setNewTplSite] = useState<TemplateSite>('zinfinal');
  const [templateSiteFilter, setTemplateSiteFilter] = useState<'all' | 'zinfinal' | 'identi'>('all');
  const [apiSearchQuery, setApiSearchQuery] = useState(activeDoc.context.titulo || '');
  const [runningApi, setRunningApi] = useState(false);
  const [fetchingFanart, setFetchingFanart] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [identifyModalOpen, setIdentifyModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [templateExportModalOpen, setTemplateExportModalOpen] = useState(false);
  const [artSidebarOpen, setArtSidebarOpen] = useState(false);
  const [artSourceFilter, setArtSourceFilter] = useState<'all' | 'tmdb' | 'omdb' | 'fanart'>('all');
  const [artSidebarFilter, setArtSidebarFilter] = useState<
    'all' | 'poster' | 'logo' | 'banner' | 'clearart' | 'background'
  >('all');

  const [editorFileDragOver, setEditorFileDragOver] = useState(false);
  const [bbHighlightEnabled, setBbHighlightEnabled] = useState(true);
  const [showBbDiagnostics, setShowBbDiagnostics] = useState(false);
  const [mediainfoDragOver, setMediainfoDragOver] = useState(false);
  const [mediainfoRawView, setMediainfoRawView] = useState(false);
  const [mediainfoShowRecents, setMediainfoShowRecents] = useState(false);
  const [recentMenuPos, setRecentMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [layersSubTab, setLayersSubTab] = useState<'quality' | 'streams'>('quality');
  const [analyzedImages, setAnalyzedImages] = useState<AnalyzedImageAsset[]>([]);
  const [analyzingImages, setAnalyzingImages] = useState(false);
  const [optimizingImageId, setOptimizingImageId] = useState<string | null>(null);
  const [uploadingAnalyzedCaptures, setUploadingAnalyzedCaptures] = useState(false);
  const [targetOptimizeWidth, setTargetOptimizeWidth] = useState<number>(0);
  const compressionPercent = config.captureCompressionPercent ?? 25;
  const [layersImageDragOver, setLayersImageDragOver] = useState(false);
  const [analyzingFile, setAnalyzingFile] = useState(false);
  const [ingestModalOpen, setIngestModalOpen] = useState(true);
  const [ingestStatusMsg, setIngestStatusMsg] = useState<string | null>(null);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [watermarkPrompt, setWatermarkPrompt] = useState<{
    open: boolean;
    previewDataUrl: string;
    imageCount: number;
    contextLabel: string;
    resolve: (
      decision:
        | { action: 'cancel' }
        | { action: 'clean' }
        | { action: 'watermark'; settings: WatermarkSettings }
    ) => void;
  } | null>(null);

  const [draggingPanel, setDraggingPanel] = useState<{
    id: PanelId;
    x: number;
    y: number;
    matchedZone: DockSlotKey | null;
    matchedGroupSlot: DockSlotKey | null;
  } | null>(null);

  const [tooltip, setTooltip] = useState<{
    title: string;
    desc: string;
    x: number;
    y: number;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEditorSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const rawBodyRef = useRef<string>(rawBody);
  rawBodyRef.current = rawBody;
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const columnsContainerRef = useRef<HTMLDivElement | null>(null);
  const leftColRef = useRef<HTMLDivElement | null>(null);
  const centerColRef = useRef<HTMLDivElement | null>(null);
  const rightColRef = useRef<HTMLDivElement | null>(null);
  const dockRootRef = useRef<HTMLDivElement | null>(null);
  const splitRatiosRef = useRef(splitRatios);
  const dockStateRef = useRef(dockState);

  useEffect(() => {
    splitRatiosRef.current = splitRatios;
  }, [splitRatios]);

  useEffect(() => {
    dockStateRef.current = dockState;
  }, [dockState]);

  useEffect(() => {
    setCoverUrlDraft(activeDoc.context[selectedCoverSlot] || '');
  }, [activeDocId, selectedCoverSlot, activeDoc.context]);

  useEffect(() => {
    setApiSearchQuery(activeDoc.context.titulo || '');
  }, [activeDocId, activeDoc.context.titulo]);

  useEffect(() => {
    document.body.classList.toggle('workspace-unlocked', !isWorkspaceLocked);
  }, [isWorkspaceLocked]);

  useEffect(() => {
    const onGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-top-menu-root]')) setOpenTopMenu(null);
      if (!target?.closest('[data-ps-toolbox-root]')) setFlyoutTool(null);
      if (!target?.closest('[data-recent-projects-root]')) setRecentMenuPos(null);
    };
    window.addEventListener('click', onGlobalClick);
    return () => window.removeEventListener('click', onGlobalClick);
  }, []);

  const shortcutActionsRef = useRef<{
    insertBbTag: (openTag: string, closeTag: string) => void;
    copyCompiledBbCode: () => Promise<void>;
    runApiSearch: () => Promise<void>;
    createNewPost: () => void;
    openIngest: () => void;
    toggleLock: () => void;
    selectTool: (tool: ToolKey) => void;
    isModalBlocking: boolean;
    cancelWatermarkPrompt: () => void;
  } | null>(null);

  useEffect(() => {
    const toolOrder: ToolKey[] = [
      'covers',
      'text',
      'align',
      'media',
      'links',
      'vars',
      'templates',
      'ingest',
      'artgallery',
    ];

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase() || '';
      const isTextField =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable);
      const isEditorFocused = target === textareaRef.current;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === 'Escape') {
        shortcutActionsRef.current?.cancelWatermarkPrompt();
        setShortcutsModalOpen(false);
        setOpenTopMenu(null);
        setFlyoutTool(null);
        setShowMiniMenu(false);
        setRecentMenuPos(null);
        return;
      }

      if ((mod && e.key === '/') || (!isTextField && !mod && !e.altKey && e.key === '?')) {
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
        return;
      }

      const actions = shortcutActionsRef.current;
      if (!actions) return;

      // Editor BBCode shortcuts when the BBCode textarea is active
      if (isEditorFocused && mod && !e.altKey) {
        if (!e.shiftKey && key === 'b') {
          e.preventDefault();
          actions.insertBbTag('[b]', '[/b]');
          return;
        }
        if (!e.shiftKey && key === 'i') {
          e.preventDefault();
          actions.insertBbTag('[i]', '[/i]');
          return;
        }
        if (!e.shiftKey && key === 'u') {
          e.preventDefault();
          actions.insertBbTag('[u]', '[/u]');
          return;
        }
        if (e.shiftKey && key === 'k') {
          e.preventDefault();
          actions.insertBbTag('[url=https://]', '[/url]');
          return;
        }
        if (!e.shiftKey && key === 'e') {
          e.preventDefault();
          actions.insertBbTag('[center]\n', '\n[/center]');
          return;
        }
        if (e.shiftKey && key === 'c') {
          e.preventDefault();
          actions.insertBbTag('[code]', '[/code]');
          return;
        }
        if (e.shiftKey && key === 'q') {
          e.preventDefault();
          actions.insertBbTag('[quote]', '[/quote]');
          return;
        }
        if (e.shiftKey && key === 's') {
          e.preventDefault();
          actions.insertBbTag('[spoiler=Ver Información]\n', '\n[/spoiler]');
          return;
        }
      }

      // Workspace-wide Alt shortcuts (cuando no hay un modal bloqueando)
      if (e.altKey && !mod && !actions.isModalBlocking) {
        if (key === 'c') {
          e.preventDefault();
          actions.copyCompiledBbCode();
          return;
        }
        if (key === 'o') {
          e.preventDefault();
          actions.openIngest();
          return;
        }
        if (key === 'n') {
          e.preventDefault();
          actions.createNewPost();
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          actions.runApiSearch();
          return;
        }
        if (key === 'l') {
          e.preventDefault();
          actions.toggleLock();
          return;
        }
        const num = Number(e.key);
        if (num >= 1 && num <= toolOrder.length) {
          e.preventDefault();
          actions.selectTool(toolOrder[num - 1]);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const syncEditorSelection = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    lastEditorSelectionRef.current = {
      start: ta.selectionStart ?? 0,
      end: ta.selectionEnd ?? 0,
    };
  };

  const applyBbColorToSelection = (
    newColor: string,
    options?: { restoreFocus?: boolean }
  ) => {
    const body = rawBodyRef.current ?? rawBody;
    const ta = textareaRef.current;
    const isTextareaFocused = Boolean(ta && document.activeElement === ta);

    let start = isTextareaFocused
      ? (ta?.selectionStart ?? body.length)
      : Math.max(0, Math.min(body.length, lastEditorSelectionRef.current.start));
    let end = isTextareaFocused
      ? (ta?.selectionEnd ?? body.length)
      : Math.max(start, Math.min(body.length, lastEditorSelectionRef.current.end));

    // Buscar todas las parejas [color=...]...[/color] respetando anidamiento
    interface ColorSpan {
      tagStart: number;
      openEnd: number;
      closeStart: number;
      tagEnd: number;
    }
    const spans: ColorSpan[] = [];
    const stack: Array<{ tagStart: number; openEnd: number }> = [];
    const colorTokRx = /\[color\s*=\s*[^\]]+\]|\[\/color\]/gi;
    let tok: RegExpExecArray | null;
    while ((tok = colorTokRx.exec(body)) !== null) {
      if (tok[0].toLowerCase().startsWith('[/color')) {
        const opened = stack.pop();
        if (opened) {
          spans.push({
            tagStart: opened.tagStart,
            openEnd: opened.openEnd,
            closeStart: tok.index,
            tagEnd: tok.index + tok[0].length,
          });
        }
      } else {
        stack.push({ tagStart: tok.index, openEnd: tok.index + tok[0].length });
      }
    }

    const enclosingSpan = spans
      .filter((s) => s.tagStart <= start && end <= s.tagEnd)
      .sort((a, b) => a.tagEnd - a.tagStart - (b.tagEnd - b.tagStart))[0];

    const newOpenTag = `[color=${newColor}]`;
    const newCloseTag = '[/color]';
    const selected = body.slice(start, end);
    const selectionHasColorTag = /\[\/?color(?:\s*=[^\]]+)?\]/i.test(selected);

    let nextText = body;
    let nextSelStart = start;
    let nextSelEnd = end;

    // Verificar si la selección cubre todo el contenido interno del ColorSpan envolvente
    const isFullEnclosingContent = Boolean(
      enclosingSpan &&
        (start === end ||
          (start === enclosingSpan.tagStart && end === enclosingSpan.tagEnd) ||
          (body
            .slice(enclosingSpan.openEnd, start)
            .replace(/\[\/?(?:b|i|u|s|size=[^\]]+|size|center|left|right)\]/gi, '')
            .trim() === '' &&
            body
              .slice(end, enclosingSpan.closeStart)
              .replace(/\[\/?(?:b|i|u|s|size=[^\]]+|size|center|left|right)\]/gi, '')
              .trim() === ''))
    );

    if (enclosingSpan && isFullEnclosingContent) {
      // Reemplazar directamente la etiqueta [color=...] existente sin añadir otra
      const rawInner = body.slice(enclosingSpan.openEnd, enclosingSpan.closeStart);
      const cleanedInner = rawInner.replace(/\[\/?color(?:\s*=[^\]]+)?\]/gi, '');
      const replacedBlock = `${newOpenTag}${cleanedInner}${newCloseTag}`;
      nextText = `${body.slice(0, enclosingSpan.tagStart)}${replacedBlock}${body.slice(
        enclosingSpan.tagEnd
      )}`;
      if (start === end) {
        const innerCaret = enclosingSpan.tagStart + newOpenTag.length + cleanedInner.length;
        nextSelStart = innerCaret;
        nextSelEnd = innerCaret;
      } else {
        nextSelStart = enclosingSpan.tagStart;
        nextSelEnd = enclosingSpan.tagStart + replacedBlock.length;
      }
    } else if (selectionHasColorTag) {
      // La selección incluye una o más etiquetas [color=...] -> limpiarlas y aplicar el nuevo color
      const cleanedSelected = selected.replace(/\[\/?color(?:\s*=[^\]]+)?\]/gi, '');
      const replacedBlock = `${newOpenTag}${cleanedSelected}${newCloseTag}`;
      nextText = `${body.slice(0, start)}${replacedBlock}${body.slice(end)}`;
      nextSelStart = start;
      nextSelEnd = start + replacedBlock.length;
    } else {
      // Selección sin color previo (o subtexto nuevo): envolver y mantener seleccionado para poder cambiarlo al vuelo
      const wrappedBlock = `${newOpenTag}${selected}${newCloseTag}`;
      nextText = `${body.slice(0, start)}${wrappedBlock}${body.slice(end)}`;
      if (selected.length === 0) {
        nextSelStart = start + newOpenTag.length;
        nextSelEnd = nextSelStart;
      } else {
        nextSelStart = start;
        nextSelEnd = start + wrappedBlock.length;
      }
    }

    rawBodyRef.current = nextText;
    lastEditorSelectionRef.current = { start: nextSelStart, end: nextSelEnd };
    onUpdateActiveDoc((doc) => ({ ...doc, customBody: nextText }));

    if (options?.restoreFocus !== false) {
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextSelStart, nextSelEnd);
        }
      });
    }
  };

  const insertBbTag = (openTag: string, closeTag: string) => {
    const colorMatch = openTag.match(/^\[color\s*=\s*([^\]]+)\]$/i);
    if (colorMatch && closeTag.toLowerCase() === '[/color]') {
      applyBbColorToSelection(colorMatch[1].trim(), { restoreFocus: true });
      return;
    }

    const ta = textareaRef.current;
    if (!ta) {
      const next = `${rawBody}${openTag}${closeTag}`;
      rawBodyRef.current = next;
      onUpdateActiveDoc((doc) => ({
        ...doc,
        customBody: next,
      }));
      return;
    }
    const start = ta.selectionStart ?? rawBody.length;
    const end = ta.selectionEnd ?? rawBody.length;
    const selected = rawBody.slice(start, end);
    const nextText = `${rawBody.slice(0, start)}${openTag}${selected}${closeTag}${rawBody.slice(end)}`;
    const caret = start + openTag.length + selected.length;
    rawBodyRef.current = nextText;
    lastEditorSelectionRef.current = { start: caret, end: caret };
    onUpdateActiveDoc((doc) => ({ ...doc, customBody: nextText }));
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(caret, caret);
      }
    });
  };

  const jumpToBbDiagnostic = (diag: BbDiagnostic) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(diag.start, diag.end);
    lastEditorSelectionRef.current = { start: diag.start, end: diag.end };
    if (editorScrollRef.current) {
      const targetTop = Math.max(0, (diag.line - 1) * 20 - 48);
      editorScrollRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  };

  const copyTextToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tempTa = document.createElement('textarea');
      tempTa.value = text;
      document.body.appendChild(tempTa);
      tempTa.select();
      document.execCommand('copy');
      document.body.removeChild(tempTa);
    }
  };

  const copyCompiledBbCode = async () => {
    await copyTextToClipboard(cleanBbCode);
    onToast('📋 BBCode compilado copiado (sin título ni separadores)', 'success');
  };

  const copyCompiledTitle = async () => {
    const titleText = compiledTitle.trim();
    if (!titleText) {
      onToast('No hay título compilado para copiar.', 'warning');
      return;
    }
    await copyTextToClipboard(titleText);
    onToast('🏷️ Título del post copiado al portapapeles', 'success');
  };

  const handleFilesIngest = async (files: File[]) => {
    if (!files || files.length === 0) return;
    setAnalyzingFile(true);
    setIngestStatusMsg('Leyendo metadatos incrustados y generando capturas...');
    try {
      const batchEnabled = functionalPlugins.find((p) => p.id === 'ext-batch-scanner')?.enabled ?? true;
      const filesToAnalyze = batchEnabled ? files : [files[0]];
      const result = await analyzeDroppedFiles(filesToAnalyze, {
        captureCount: config.captureCount ?? 6,
        captureCompressionPercent: compressionPercent,
      });

      const updates = { ...result.updates };

      // 1. Subida automática de carátulas / capturas solo si hay Host configurado y autoUploadCovers activo
      const hasImgHost = Boolean(
        config.imgHostKey.trim() ||
          (config.imgHostProvider === 'chevereto' && config.imgHostEndpoint.trim())
      );

      if (config.autoUploadCovers && hasImgHost) {
        const hasCoverUpload = Boolean(
          updates.poster_url?.startsWith('data:image/') &&
            !updates.poster_url.startsWith('data:image/svg+xml')
        );
        const videoShots =
          result.kind === 'video'
            ? result.capturedDataUrls.filter(
                (c) => c.startsWith('data:image/') && !c.startsWith('data:image/svg+xml')
              )
            : [];
        const audioSpec =
          result.kind === 'audio'
            ? result.capturedDataUrls.filter(
                (c) =>
                  c.startsWith('data:image/') &&
                  !c.startsWith('data:image/svg+xml') &&
                  c !== updates.poster_url
              )
            : [];

        const totalToUpload =
          (hasCoverUpload ? 1 : 0) + videoShots.length + audioSpec.length;

        if (totalToUpload > 0) {
          const previewImg =
            (hasCoverUpload ? updates.poster_url : undefined) ||
            videoShots[0] ||
            audioSpec[0] ||
            '';
          const contextLabel =
            result.kind === 'video'
              ? 'Portada y capturas del video'
              : result.kind === 'audio'
              ? 'Portada y espectrograma del audio'
              : 'Imagen local seleccionada';

          const decision = await askWatermarkBeforeUpload(
            previewImg,
            totalToUpload,
            contextLabel
          );

          if (decision.action !== 'cancel') {
            const prepareImage = async (rawDataUrl: string) =>
              decision.action === 'watermark'
                ? await applyWatermarkToDataUrl(rawDataUrl, decision.settings)
                : rawDataUrl;

            if (hasCoverUpload && updates.poster_url) {
              setIngestStatusMsg(`Subiendo portada a ${config.imgHostProvider.toUpperCase()}...`);
              const preparedCover = await prepareImage(updates.poster_url);
              updates.poster_url = preparedCover;
              const up = await uploadImageToHost({
                provider: config.imgHostProvider,
                apiKey: config.imgHostKey,
                endpoint: config.imgHostEndpoint,
                expiration: config.imgHostExpire,
                imageBase64: preparedCover,
                filename: `${updates.titulo || 'cover'}.png`,
              });
              if (up.ok && up.url) {
                updates.poster_url = up.url;
              }
            }

            if (videoShots.length > 0) {
              setIngestStatusMsg(
                `Subiendo ${videoShots.length} captura(s) a ${config.imgHostProvider.toUpperCase()}...`
              );
              const uploadedTags: string[] = [];
              const localFallbackTags: string[] = [];
              for (let i = 0; i < videoShots.length; i++) {
                const preparedShot = await prepareImage(videoShots[i]);
                localFallbackTags.push(`[img]${preparedShot}[/img]`);
                const up = await uploadImageToHost({
                  provider: config.imgHostProvider,
                  apiKey: config.imgHostKey,
                  endpoint: config.imgHostEndpoint,
                  expiration: config.imgHostExpire,
                  imageBase64: preparedShot,
                  filename: `${updates.titulo || 'capture'}_${i + 1}.jpg`,
                });
                if (up.ok && up.url) {
                  if (config.imgHostFormat === 'thumb' && up.thumbUrl) {
                    uploadedTags.push(`[url=${up.url}][img]${up.thumbUrl}[/img][/url]`);
                  } else {
                    uploadedTags.push(`[img]${up.url}[/img]`);
                  }
                }
              }
              // Las capturas extraídas del archivo pertenecen exclusivamente a {{capturas_bbcode}}
              if (uploadedTags.length > 0) {
                updates.capturas_bbcode = uploadedTags.join(' ');
              } else if (decision.action === 'watermark' && localFallbackTags.length > 0) {
                updates.capturas_bbcode = buildCapturesBbCode(
                  localFallbackTags.map((t) => t.replace(/^\[img\]|\[\/img\]$/gi, ''))
                );
              }
            }

            if (audioSpec.length > 0) {
              setIngestStatusMsg(
                `Subiendo espectrograma a ${config.imgHostProvider.toUpperCase()}...`
              );
              const preparedSpec = await prepareImage(audioSpec[0]);
              const up = await uploadImageToHost({
                provider: config.imgHostProvider,
                apiKey: config.imgHostKey,
                endpoint: config.imgHostEndpoint,
                expiration: config.imgHostExpire,
                imageBase64: preparedSpec,
                filename: `${updates.titulo || 'spectrum'}.png`,
              });
              // El espectrograma pertenece exclusivamente a {{espectrograma_bbcode}}
              if (up.ok && up.url) {
                const tag =
                  config.imgHostFormat === 'thumb' && up.thumbUrl
                    ? `[url=${up.url}][img]${up.thumbUrl}[/img][/url]`
                    : `[img]${up.url}[/img]`;
                updates.espectrograma_bbcode = tag;
              } else if (decision.action === 'watermark') {
                updates.espectrograma_bbcode = `[img]${preparedSpec}[/img]`;
              }
            }
          }
        }
      }

      // 2. Automatización en cascada: 1) TMDB (prioridad) -> 2) OMDb/IMDb (secundario) -> 3) Fanart.tv (Banners, ClearArts y Logo si falta)
      const activeSite = activeTemplate?.site || (activeDoc.templateId.includes('identi') ? 'identi' : 'zinfinal');
      let nextTemplateId = result.suggestedTemplateId || activeDoc.templateId;
      if (activeSite === 'identi' && result.kind === 'audio') {
        nextTemplateId = 'tpl-identi-music';
      } else if (activeSite === 'identi' && result.kind === 'video') {
        nextTemplateId = 'tpl-identi-main';
      }

      const fallbackProvider = config.autoEnrichOnDrop
        ? pickBestConnectedProvider(
            apiProviders,
            config,
            result.kind,
            nextTemplateId,
            activeApiProviderId
          )
        : null;

      let apiAutomationNote = 'Solo metadatos incrustados y capturas (sin APIs conectadas)';
      let nextFanartGallery: FanartArtworkItem[] | undefined =
        result.kind === 'image' || result.kind === 'text' ? activeDoc.fanartGallery : [];

      const hasAnyAutomationProvider = Boolean(
        config.tmdbApiKey.trim() ||
          config.omdbApiKey.trim() ||
          config.fanartApiKey.trim() ||
          config.fanartClientKey.trim() ||
          fallbackProvider
      );

      if (
        config.autoEnrichOnDrop &&
        hasAnyAutomationProvider &&
        updates.titulo &&
        result.kind !== 'image' &&
        result.kind !== 'text'
      ) {
        const cleanSynopsis =
          functionalPlugins.find((p) => p.id === 'ext-translator')?.enabled ?? true;
        const preserveEmbeddedAudioCover =
          result.kind === 'audio' &&
          Boolean(updates.poster_url && updates.poster_url.startsWith('data:image/') && !updates.poster_url.startsWith('data:image/svg+xml'));

        const autoRes = await automatePostEnrichment({
          title: updates.titulo,
          year: updates.anio,
          artist: updates.artista,
          mediaType: result.kind === 'audio' ? 'music' : updates.media_type,
          kind: result.kind,
          fallbackProvider,
          config,
          cleanHtmlSynopsis: cleanSynopsis,
          onStatus: (msg) => setIngestStatusMsg(msg),
        });

        nextFanartGallery = autoRes.gallery;

        const allowedApiKeys = new Set([
          'poster_url',
          'banner_url',
          'logo_url',
          'clearart_url',
          'background_url',
          'trailer_url',
          'sinopsis',
          'generos',
          'tmdb_rating',
          'imdb_rating',
          'anio',
          'titulo',
          'artista',
          'album',
          'duracion',
          'episodio',
          'tracklist',
          'tmdb_id',
          'imdb_id',
          'tvdb_id',
          'mbid_id',
          'anilist_id',
          'tvmaze_id',
          'media_type',
        ]);

        for (const [k, v] of Object.entries(autoRes.extracted)) {
          if (typeof v === 'string' && v.trim() && allowedApiKeys.has(k)) {
            if (k === 'poster_url' && preserveEmbeddedAudioCover) continue;
            updates[k] = v;
          }
        }
        apiAutomationNote = autoRes.note;
        if (updates.titulo) {
          setApiSearchQuery(updates.titulo);
        }
      }

      const nextDocName = files[0].name.replace(/\.[^.]+$/, '') + '.bbcode';
      const mergedContext: MediaContext = { ...activeDoc.context };
      for (const [key, val] of Object.entries(updates)) {
        if (typeof val === 'string') {
          mergedContext[key] = val;
        }
      }

      onUpdateActiveDoc((doc) => ({
        ...doc,
        name: nextDocName,
        templateId: nextTemplateId || doc.templateId,
        customTitle: result.suggestedTemplateId ? null : doc.customTitle,
        customBody: result.suggestedTemplateId ? null : doc.customBody,
        fanartGallery: nextFanartGallery,
        context: mergedContext,
        mediainfoDetails: result.mediainfoDetails,
      }));

      if (result.kind !== 'unknown') {
        onRecordRecentProject({
          id: `recent-${Date.now()}`,
          docName: nextDocName,
          templateId: nextTemplateId,
          mediainfoDetails: result.mediainfoDetails,
          contextSnapshot: buildLightweightContextSnapshot(mergedContext),
          analyzedAt: result.mediainfoDetails.analyzedAt,
        });
      }

      setMediainfoShowRecents(false);
      if (result.kind === 'video' || result.kind === 'audio') {
        focusPanel('mediainfo');
      }
      setIngestModalOpen(false);
      onToast(`${result.summary} · ${apiAutomationNote}`, 'success');
    } catch (err) {
      onToast(
        `Error al analizar archivo: ${err instanceof Error ? err.message : 'Formato no compatible'}`,
        'error'
      );
    } finally {
      setAnalyzingFile(false);
      setIngestStatusMsg(null);
    }
  };

  const formatRecentTechSummary = (mi: MediaInfoDetails): string => {
    const v = mi.videoTracks[0];
    const a = mi.audioTracks[0];
    if (v) {
      return [
        v.resolutionLabel || (v.width && v.height ? `${v.width}×${v.height}` : ''),
        v.codec,
        v.fps,
        mi.overallBitrate,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (a) {
      return [a.codec, a.bitrate || mi.overallBitrate, a.sampleRate, mi.duration]
        .filter(Boolean)
        .join(' · ');
    }
    return [mi.container, mi.fileSize, mi.overallBitrate].filter(Boolean).join(' · ');
  };

  const openRecentProjectInWorkspace = (
    project: RecentMediaProject,
    mode: 'new-tab' | 'current-tab' = 'new-tab'
  ) => {
    onOpenRecentProject(project, mode);
    setMediainfoShowRecents(false);
    setMediainfoRawView(false);
    setRecentMenuPos(null);
    setIngestModalOpen(false);
    focusPanel('mediainfo');
  };

  const handleBrowseMediaFiles = async () => {
    const files = await pickMultipleMediaFiles(
      'video/*,audio/*,image/*,.mkv,.flac,.mp3,.mp4,.m4a,.nfo,.txt,.cue,.srt'
    );
    if (files.length > 0) {
      await handleFilesIngest(files);
    }
  };

  const handleBrowseAndAnalyzeFolder = async () => {
    const dir = await pickLocalDirectory();
    if (!dir) return;
    const mediaMetas = dir.metas.filter((m) =>
      /\.(mkv|mp4|webm|mov|avi|m4v|flac|mp3|wav|ogg|m4a|nfo|cue|jpg|png|webp)$/i.test(m.name)
    );
    onUpdateConfig({
      mediaFolderLinked: dir.folderName,
      mediaFilesIndex: mediaMetas,
    });
    const mediaFiles = dir.files.filter((f) =>
      /\.(mkv|mp4|webm|mov|avi|m4v|flac|mp3|wav|ogg|m4a|nfo|cue|jpg|png|webp)$/i.test(f.name)
    );
    if (mediaFiles.length > 0) {
      await handleFilesIngest(mediaFiles);
    } else {
      onToast(`No se encontraron archivos multimedia en "${dir.folderName}"`, 'warning');
    }
  };

  const askWatermarkBeforeUpload = (
    previewDataUrl: string,
    imageCount: number,
    contextLabel: string
  ): Promise<
    | { action: 'cancel' }
    | { action: 'clean' }
    | { action: 'watermark'; settings: WatermarkSettings }
  > => {
    return new Promise((resolve) => {
      setWatermarkPrompt({
        open: true,
        previewDataUrl,
        imageCount,
        contextLabel,
        resolve,
      });
    });
  };

  const handleUploadLocalCover = async (slotKey: string, dataUrlOrFile: string | File) => {
    let base64Str = '';
    let filename = `${slotKey}.png`;

    if (typeof dataUrlOrFile === 'string') {
      base64Str = dataUrlOrFile;
    } else {
      filename = dataUrlOrFile.name;
      base64Str = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.readAsDataURL(dataUrlOrFile);
      });
    }

    if (!base64Str.startsWith('data:image/')) {
      onToast('Este slot ya usa una URL externa o SVG no rasterizado.', 'info');
      return;
    }

    if (base64Str.startsWith('data:image/svg+xml')) {
      onToast('Sube o arrastra primero una imagen PNG/JPG/WEBP para alojarla en el host.', 'warning');
      return;
    }

    if (!config.imgHostKey.trim() && !(config.imgHostProvider === 'chevereto' && config.imgHostEndpoint.trim())) {
      onToast('Configura tu API Key del Host de Imágenes en ⚙ Configuración para subir a la nube.', 'warning');
      return;
    }

    const decision = await askWatermarkBeforeUpload(
      base64Str,
      1,
      `Imagen del slot {{${slotKey}}}`
    );

    if (decision.action === 'cancel') {
      onToast('Subida al host cancelada.', 'info');
      return;
    }

    let uploadBase64 = base64Str;
    if (decision.action === 'watermark') {
      uploadBase64 = await applyWatermarkToDataUrl(base64Str, decision.settings);
      onUpdateActiveDoc((doc) => ({
        ...doc,
        context: { ...doc.context, [slotKey]: uploadBase64 },
      }));
      setCoverUrlDraft(uploadBase64);
    }

    setUploadingCover(true);
    const res = await uploadImageToHost({
      provider: config.imgHostProvider,
      apiKey: config.imgHostKey,
      endpoint: config.imgHostEndpoint,
      expiration: config.imgHostExpire,
      imageBase64: uploadBase64,
      filename,
    });
    setUploadingCover(false);

    if (res.ok && res.url) {
      const finalUrl =
        config.imgHostFormat === 'thumb' && res.thumbUrl ? res.thumbUrl : res.url;
      onUpdateActiveDoc((doc) => ({
        ...doc,
        context: { ...doc.context, [slotKey]: finalUrl },
      }));
      setCoverUrlDraft(finalUrl);
      onToast(`Imagen subida (${res.latencyMs} ms): ${finalUrl}`, 'success');
    } else {
      onToast(`Error al subir imagen: ${res.error || 'Verifica tu API Key'}`, 'error');
    }
  };

  useEffect(() => {
    let active = true;
    const extracted = extractImagesFromContext(activeDoc.context);
    if (extracted.length === 0) {
      setAnalyzedImages([]);
      setAnalyzingImages(false);
      return;
    }

    setAnalyzingImages(true);
    Promise.all(
      extracted.map((img) => analyzeImageAsset(img, config.imgHostProvider, compressionPercent))
    )
      .then((res) => {
        if (!active) return;
        setAnalyzedImages(res);
      })
      .finally(() => {
        if (active) setAnalyzingImages(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeDoc.id,
    activeDoc.context.capturas_bbcode,
    activeDoc.context.espectrograma_bbcode,
    activeDoc.context.poster_url,
    activeDoc.context.banner_url,
    activeDoc.context.logo_url,
    activeDoc.context.clearart_url,
    activeDoc.context.background_url,
    activeDoc.context.thumb_url,
    activeDoc.context.separator_url,
    config.imgHostProvider,
    compressionPercent,
  ]);

  const replaceImageSlotInContext = (
    ctx: MediaContext,
    slotKey: keyof MediaContext,
    slotIndex: number,
    nextSrc: string
  ): MediaContext => {
    if (slotKey === 'capturas_bbcode' || slotKey === 'espectrograma_bbcode') {
      const raw = ctx[slotKey] || '';
      let currentIdx = 0;
      const updated = raw.replace(
        /\[img(\s+(?:size|width)=\d{2,4})?\]([\s\S]*?)\[\/img\]/gi,
        (full, attr: string | undefined) => {
          const match = currentIdx === slotIndex;
          currentIdx += 1;
          return match ? `[img${attr || ''}]${nextSrc}[/img]` : full;
        }
      );
      return { ...ctx, [slotKey]: updated };
    }
    return { ...ctx, [slotKey]: nextSrc };
  };

  const effectiveOptimizeQuality = compressionPercentToQuality(compressionPercent);

  const handleOptimizeSingleAsset = async (asset: AnalyzedImageAsset) => {
    if (!asset.isLocalDataUrl || asset.isSvg) {
      onToast(
        'Solo se pueden optimizar en el navegador capturas o covers locales (PNG/JPG/WEBP).',
        'warning'
      );
      return;
    }

    setOptimizingImageId(asset.id);
    try {
      const maxWidth =
        targetOptimizeWidth === 0
          ? 0
          : asset.slotKey === 'thumb_url' || asset.slotKey === 'logo_url'
          ? Math.min(720, targetOptimizeWidth)
          : targetOptimizeWidth;
      const mimeType: 'image/jpeg' | 'image/webp' =
        asset.slotKey === 'logo_url' ? 'image/webp' : 'image/jpeg';

      const opt = await optimizeLocalImageDataUrl(asset.src, {
        maxWidth,
        mimeType,
        quality: effectiveOptimizeQuality,
      });

      onUpdateActiveDoc((doc) => ({
        ...doc,
        context: replaceImageSlotInContext(doc.context, asset.slotKey, asset.slotIndex, opt.dataUrl),
      }));

      const deltaPct =
        opt.oldBytes > 0
          ? Math.round(((opt.oldBytes - opt.newBytes) / opt.oldBytes) * 100)
          : 0;
      const deltaLabel = deltaPct >= 0 ? `-${deltaPct}%` : `+${Math.abs(deltaPct)}%`;
      onToast(
        `${asset.label} optimizada y reemplazada (${compressionPercent}% compresión): ${opt.width}×${opt.height} · ${formatBytes(
          opt.oldBytes
        )} → ${formatBytes(opt.newBytes)} (${deltaLabel})`,
        'success'
      );
    } catch (err) {
      onToast(
        `No se pudo optimizar ${asset.label}: ${err instanceof Error ? err.message : 'Error'}`,
        'error'
      );
    } finally {
      setOptimizingImageId(null);
    }
  };

  const handleOptimizeAndReplaceCaptures = async (targets?: AnalyzedImageAsset[]) => {
    const localCaptures = analyzedImages.filter(
      (a) => a.isLocalDataUrl && !a.isSvg && a.slotKey === 'capturas_bbcode'
    );
    const localAll = analyzedImages.filter((a) => a.isLocalDataUrl && !a.isSvg);
    const candidates =
      targets && targets.length > 0
        ? targets.filter((a) => a.isLocalDataUrl && !a.isSvg)
        : localCaptures.length > 0
        ? localCaptures
        : localAll;

    if (candidates.length === 0) {
      onToast('No hay capturas o imágenes locales (PNG/JPG/WEBP) para optimizar y reemplazar.', 'info');
      return;
    }

    setOptimizingImageId('all');
    try {
      let totalOld = 0;
      let totalNew = 0;
      let nextCtx: MediaContext = { ...activeDoc.context };

      const allTargetsAreCaptures = candidates.every((a) => a.slotKey === 'capturas_bbcode');
      const allCaptureAssets = analyzedImages.filter((a) => a.slotKey === 'capturas_bbcode');

      if (allTargetsAreCaptures && allCaptureAssets.length > 0) {
        const batch = await optimizeAndBuildCapturesBbCode(
          allCaptureAssets.map((a) => a.src),
          {
            maxWidth: targetOptimizeWidth,
            compressionPercent,
            mimeType: 'image/jpeg',
          }
        );
        totalOld = batch.totalOldBytes;
        totalNew = batch.totalNewBytes;
        nextCtx = { ...nextCtx, capturas_bbcode: batch.bbcode };
      } else {
        for (const asset of candidates) {
          const maxWidth =
            targetOptimizeWidth === 0
              ? 0
              : asset.slotKey === 'thumb_url' || asset.slotKey === 'logo_url'
              ? Math.min(720, targetOptimizeWidth)
              : targetOptimizeWidth;
          const mimeType: 'image/jpeg' | 'image/webp' =
            asset.slotKey === 'logo_url' ? 'image/webp' : 'image/jpeg';

          const opt = await optimizeLocalImageDataUrl(asset.src, {
            maxWidth,
            mimeType,
            quality: effectiveOptimizeQuality,
          });
          totalOld += opt.oldBytes;
          totalNew += opt.newBytes;
          nextCtx = replaceImageSlotInContext(nextCtx, asset.slotKey, asset.slotIndex, opt.dataUrl);
        }
      }

      onUpdateActiveDoc((doc) => ({ ...doc, context: nextCtx }));
      const deltaPct =
        totalOld > 0 ? Math.round(((totalOld - totalNew) / totalOld) * 100) : 0;
      const deltaLabel = deltaPct >= 0 ? `-${deltaPct}%` : `+${Math.abs(deltaPct)}%`;
      onToast(
        `⚡ ${candidates.length} captura(s) optimizada(s) y reemplazada(s) (${compressionPercent}% compresión): ${formatBytes(
          totalOld
        )} → ${formatBytes(totalNew)} (${deltaLabel})`,
        'success'
      );
    } catch (err) {
      onToast(
        `Error optimizando y reemplazando capturas: ${err instanceof Error ? err.message : 'Error'}`,
        'error'
      );
    } finally {
      setOptimizingImageId(null);
    }
  };

  const handleAddCapturesToAnalyzer = async (files: File[]) => {
    const imageFiles = files.filter(
      (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|avif)$/i.test(f.name)
    );
    if (imageFiles.length === 0) {
      onToast('Selecciona archivos de imagen (PNG, JPG o WEBP).', 'warning');
      return;
    }

    const newTags: string[] = [];
    for (const f of imageFiles.slice(0, 12)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(f);
      });
      if (dataUrl) newTags.push(`[img]${dataUrl}[/img]`);
    }

    if (newTags.length > 0) {
      onUpdateActiveDoc((doc) => {
        const existing = (doc.context.capturas_bbcode || '').trim();
        const combined = existing ? `${existing} ${newTags.join(' ')}` : newTags.join(' ');
        return {
          ...doc,
          context: { ...doc.context, capturas_bbcode: combined },
        };
      });
      onToast(
        `${newTags.length} captura(s) añadida(s) al analizador de calidad.`,
        'success'
      );
    }
  };

  const handleUploadAnalyzedCaptures = async (targets: AnalyzedImageAsset[]) => {
    const localTargets = targets.filter((t) => t.isLocalDataUrl && !t.isSvg);
    if (localTargets.length === 0) {
      onToast('No hay capturas locales pendientes de subir al host.', 'info');
      return;
    }

    const hasImgHost = Boolean(
      config.imgHostKey.trim() ||
        (config.imgHostProvider === 'chevereto' && config.imgHostEndpoint.trim())
    );
    if (!hasImgHost) {
      onToast(
        `Configura tu API Key de ${config.imgHostProvider.toUpperCase()} antes de subir capturas.`,
        'warning'
      );
      onOpenSettings('imghost');
      return;
    }

    const decision = await askWatermarkBeforeUpload(
      localTargets[0].src,
      localTargets.length,
      localTargets.length === 1
        ? localTargets[0].label
        : `${localTargets.length} capturas / assets analizados`
    );

    if (decision.action === 'cancel') {
      onToast('Subida al host cancelada.', 'info');
      return;
    }

    setUploadingAnalyzedCaptures(true);
    let nextCtx: MediaContext = { ...activeDoc.context };
    let okCount = 0;

    try {
      for (let i = 0; i < localTargets.length; i++) {
        const asset = localTargets[i];
        const prepared =
          decision.action === 'watermark'
            ? await applyWatermarkToDataUrl(asset.src, decision.settings)
            : asset.src;

        const up = await uploadImageToHost({
          provider: config.imgHostProvider,
          apiKey: config.imgHostKey,
          endpoint: config.imgHostEndpoint,
          expiration: config.imgHostExpire,
          imageBase64: prepared,
          filename: `${activeDoc.context.titulo || 'capture'}_${asset.slotIndex + 1}.jpg`,
        });

        if (up.ok && up.url) {
          const finalUrl =
            config.imgHostFormat === 'thumb' && up.thumbUrl ? up.thumbUrl : up.url;
          nextCtx = replaceImageSlotInContext(nextCtx, asset.slotKey, asset.slotIndex, finalUrl);
          okCount += 1;
        }
      }

      if (okCount > 0) {
        onUpdateActiveDoc((doc) => ({ ...doc, context: nextCtx }));
        onToast(
          `☁ ${okCount}/${localTargets.length} imagen(es) subida(s) a ${config.imgHostProvider.toUpperCase()}`,
          'success'
        );
      } else {
        onToast('No se pudo subir ninguna imagen. Verifica tu API Key del host.', 'error');
      }
    } finally {
      setUploadingAnalyzedCaptures(false);
    }
  };

  const handleLocalCoverFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.readAsDataURL(file);
    });
    onUpdateActiveDoc((doc) => ({
      ...doc,
      context: { ...doc.context, [selectedCoverSlot]: dataUrl },
    }));
    setCoverUrlDraft(dataUrl);
    onToast(`Cover "${file.name}" cargado en {{${selectedCoverSlot}}}`, 'success');

    const hasImgHost = Boolean(
      config.imgHostKey.trim() ||
        (config.imgHostProvider === 'chevereto' && config.imgHostEndpoint.trim())
    );
    if (config.autoUploadCovers && hasImgHost) {
      await handleUploadLocalCover(selectedCoverSlot, dataUrl);
    }
  };

  const handleRunApiSearch = async () => {
    setRunningApi(true);
    await onRunActiveApi(apiSearchQuery);
    setRunningApi(false);
  };

  const handleFetchFanartForDoc = async () => {
    if (!config.fanartApiKey.trim() && !config.fanartClientKey.trim()) {
      onToast('Configura tu Fanart.tv API Key en ⚙ Configuración para buscar Logos, Banners y ClearArt.', 'warning');
      onOpenSettings('paths');
      return;
    }

    setFetchingFanart(true);
    try {
      const res = await fetchFanartTvArtwork({
        mediaType: activeDoc.context.media_type,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        tvdbId: activeDoc.context.tvdb_id,
        mbidId: activeDoc.context.mbid_id,
        title: activeDoc.context.titulo,
        artist: activeDoc.context.artista,
        config,
      });

      if (!res.ok || res.gallery.length === 0) {
        onToast(
          `Fanart.tv: ${res.error || 'No se encontraron artworks para este título.'}`,
          'warning'
        );
        return;
      }

      onUpdateActiveDoc((doc) => {
        const otherSources = (doc.fanartGallery || []).filter(
          (item) => (item.source || 'fanart') !== 'fanart'
        );
        const hasRealLogo =
          Boolean(doc.context.logo_url) &&
          !doc.context.logo_url.startsWith('data:image/svg+xml');
        return {
          ...doc,
          fanartGallery: [...otherSources, ...res.gallery],
          context: {
            ...doc.context,
            banner_url: res.extracted.banner_url || doc.context.banner_url,
            clearart_url: res.extracted.clearart_url || doc.context.clearart_url,
            logo_url:
              !hasRealLogo && res.extracted.logo_url
                ? res.extracted.logo_url
                : doc.context.logo_url,
            background_url:
              (!doc.context.background_url || doc.context.background_url.startsWith('data:image/svg+xml')) &&
              res.extracted.background_url
                ? res.extracted.background_url
                : doc.context.background_url,
            poster_url:
              res.extracted.poster_url &&
              (!doc.context.poster_url || doc.context.poster_url.startsWith('data:image/svg+xml'))
                ? res.extracted.poster_url
                : doc.context.poster_url,
          },
        };
      });
      onToast(
        `🎨 Fanart.tv: ${res.gallery.length} artwork(s) cargados en la galería`,
        'success'
      );
    } finally {
      setFetchingFanart(false);
    }
  };

  const SYNCABLE_METADATA_KEYS = new Set([
    'poster_url',
    'banner_url',
    'logo_url',
    'clearart_url',
    'background_url',
    'trailer_url',
    'sinopsis',
    'generos',
    'tmdb_rating',
    'imdb_rating',
    'anio',
    'titulo',
    'artista',
    'album',
    'duracion',
    'episodio',
    'tracklist',
    'tmdb_id',
    'imdb_id',
    'tvdb_id',
    'mbid_id',
    'anilist_id',
    'tvmaze_id',
    'media_type',
  ]);

  const handleRefreshMetadata = async (override?: Partial<IdentifyMediaPayload>) => {
    const cleanSynopsis =
      functionalPlugins.find((p) => p.id === 'ext-translator')?.enabled ?? true;
    const ctx = activeDoc.context;
    const mediaType =
      override && override.mediaType !== undefined ? override.mediaType : ctx.media_type;
    const tmdbId = override && override.tmdbId !== undefined ? override.tmdbId : ctx.tmdb_id;
    const imdbId = override && override.imdbId !== undefined ? override.imdbId : ctx.imdb_id;
    const tvdbId = override && override.tvdbId !== undefined ? override.tvdbId : ctx.tvdb_id;
    const mbidId = override && override.mbidId !== undefined ? override.mbidId : ctx.mbid_id;
    const anilistId =
      override && override.anilistId !== undefined ? override.anilistId : ctx.anilist_id;
    const tvmazeId =
      override && override.tvmazeId !== undefined ? override.tvmazeId : ctx.tvmaze_id;
    const title = (
      override && override.title !== undefined ? override.title : ctx.titulo || ''
    ).trim();
    const year = (
      override && override.year !== undefined ? override.year : ctx.anio || ''
    ).trim();
    const artist = (
      override && override.artist !== undefined ? override.artist : ctx.artista || ''
    ).trim();

    const kind: 'video' | 'audio' = mediaType === 'music' ? 'audio' : 'video';
    const fallbackProvider = pickBestConnectedProvider(
      apiProviders,
      config,
      kind,
      activeDoc.templateId,
      activeApiProviderId
    );

    const hasProviders = Boolean(
      config.tmdbApiKey.trim() ||
        config.omdbApiKey.trim() ||
        config.fanartApiKey.trim() ||
        config.fanartClientKey.trim() ||
        fallbackProvider ||
        anilistId?.trim() ||
        tvmazeId?.trim()
    );

    if (!hasProviders) {
      onToast(
        'Configura TMDB, OMDb, Fanart.tv u otro proveedor en ⚙ Configuración para refrescar metadatos.',
        'warning'
      );
      onOpenSettings('paths');
      return;
    }

    if (
      !title &&
      !tmdbId?.trim() &&
      !imdbId?.trim() &&
      !tvdbId?.trim() &&
      !mbidId?.trim() &&
      !anilistId?.trim() &&
      !tvmazeId?.trim()
    ) {
      onToast(
        'Ingresa un título o usa 🎯 Identificar para especificar un ID antes de refrescar.',
        'warning'
      );
      setIdentifyModalOpen(true);
      return;
    }

    setRefreshingMetadata(true);
    setFetchingFanart(true);
    try {
      const autoRes = await automatePostEnrichment({
        title,
        year,
        artist,
        mediaType,
        kind,
        tmdbId,
        imdbId,
        tvdbId,
        mbidId,
        anilistId,
        tvmazeId,
        fallbackProvider,
        config,
        cleanHtmlSynopsis: cleanSynopsis,
        forceRefresh: true,
      });

      const syncedUpdates: Record<string, string> = {};
      for (const [k, v] of Object.entries(autoRes.extracted)) {
        if (typeof v === 'string' && v.trim() && SYNCABLE_METADATA_KEYS.has(k)) {
          syncedUpdates[k] = v;
        }
      }

      if (Object.keys(syncedUpdates).length === 0 && autoRes.gallery.length === 0) {
        onToast(
          '🔄 Refresh: No se encontraron nuevos metadatos ni artes con los datos/IDs actuales. Prueba 🎯 Identificar.',
          'warning'
        );
        return;
      }

      onUpdateActiveDoc((doc) => ({
        ...doc,
        fanartGallery: autoRes.gallery.length > 0 ? autoRes.gallery : doc.fanartGallery,
        context: {
          ...doc.context,
          ...(override
            ? {
                media_type: override.mediaType ?? doc.context.media_type,
                tmdb_id: override.tmdbId ?? doc.context.tmdb_id,
                imdb_id: override.imdbId ?? doc.context.imdb_id,
                tvdb_id: override.tvdbId ?? doc.context.tvdb_id,
                mbid_id: override.mbidId ?? doc.context.mbid_id,
                anilist_id: override.anilistId ?? doc.context.anilist_id,
                tvmaze_id: override.tvmazeId ?? doc.context.tvmaze_id,
              }
            : {}),
          ...syncedUpdates,
          // Garantizar que capturas, espectrograma y mediainfo técnico nunca sean alterados por el refresh
          capturas_bbcode: doc.context.capturas_bbcode,
          espectrograma_bbcode: doc.context.espectrograma_bbcode,
          mediainfo_completo: doc.context.mediainfo_completo,
        },
      }));

      if (syncedUpdates.titulo) {
        setApiSearchQuery(syncedUpdates.titulo);
      }
      onToast(
        `🔄 Metadatos sincronizados (${Object.keys(syncedUpdates).length} campos): ${autoRes.note}`,
        'success'
      );
    } finally {
      setRefreshingMetadata(false);
      setFetchingFanart(false);
    }
  };

  const handleSaveIdentifyIds = (payload: IdentifyMediaPayload) => {
    onUpdateActiveDoc((doc) => ({
      ...doc,
      context: {
        ...doc.context,
        media_type: payload.mediaType,
        tmdb_id: payload.tmdbId,
        imdb_id: payload.imdbId,
        tvdb_id: payload.tvdbId,
        mbid_id: payload.mbidId,
        anilist_id: payload.anilistId,
        tvmaze_id: payload.tvmazeId,
        ...(payload.title.trim() ? { titulo: payload.title.trim() } : {}),
        ...(payload.year.trim() ? { anio: payload.year.trim() } : {}),
        ...(payload.artist.trim() ? { artista: payload.artist.trim() } : {}),
      },
    }));
    if (payload.title.trim()) {
      setApiSearchQuery(payload.title.trim());
    }
    setIdentifyModalOpen(false);
    onToast('🎯 IDs de proveedor guardados en el post.', 'success');
  };

  const handleIdentifyAndSync = async (payload: IdentifyMediaPayload) => {
    onUpdateActiveDoc((doc) => ({
      ...doc,
      context: {
        ...doc.context,
        media_type: payload.mediaType,
        tmdb_id: payload.tmdbId,
        imdb_id: payload.imdbId,
        tvdb_id: payload.tvdbId,
        mbid_id: payload.mbidId,
        anilist_id: payload.anilistId,
        tvmaze_id: payload.tvmazeId,
        ...(payload.title.trim() ? { titulo: payload.title.trim() } : {}),
        ...(payload.year.trim() ? { anio: payload.year.trim() } : {}),
        ...(payload.artist.trim() ? { artista: payload.artist.trim() } : {}),
      },
    }));
    if (payload.title.trim()) {
      setApiSearchQuery(payload.title.trim());
    }
    setIdentifyModalOpen(false);
    await handleRefreshMetadata(payload);
  };

  const savedPasswordsList = config.savedPasswords || [];

  const handleUpdateSavedPasswords = (nextList: SavedPasswordEntry[]) => {
    onUpdateConfig({ savedPasswords: nextList });
  };

  const handleApplyPasswordToPost = (
    passwordText: string,
    options?: { ensureVariable?: boolean; matchHeadingUppercase?: boolean }
  ) => {
    const info = detectPasswordHeadingInfo(rawBody);
    const finalPassword =
      options?.matchHeadingUppercase && info.headingIsUppercase
        ? passwordText.toUpperCase()
        : passwordText;

    onUpdateActiveDoc((doc) => {
      const tpl = templates.find((t) => t.id === doc.templateId) || activeTemplate;
      const bodyToUse = doc.customBody ?? tpl.bodyPattern;
      const shouldEnsure =
        options?.ensureVariable !== false && !hasPasswordVariableInPost(bodyToUse);
      return {
        ...doc,
        ...(shouldEnsure
          ? {
              customBody: ensurePasswordVariableBelowHeading(
                bodyToUse,
                tpl.site || 'zinfinal'
              ),
            }
          : {}),
        context: {
          ...doc.context,
          password: finalPassword,
        },
      };
    });

    onToast(`🔑 Contraseña "${finalPassword}" insertada en el post`, 'success');
  };

  const handleEnsurePasswordVarInPost = () => {
    onUpdateActiveDoc((doc) => {
      const tpl = templates.find((t) => t.id === doc.templateId) || activeTemplate;
      const bodyToUse = doc.customBody ?? tpl.bodyPattern;
      return {
        ...doc,
        customBody: ensurePasswordVariableBelowHeading(bodyToUse, tpl.site || 'zinfinal'),
      };
    });
    onToast('🔑 Variable {{password}} asegurada debajo de Password / Contraseña', 'success');
  };

  const handleFetchTmdbVisualArt = async () => {
    if (!config.tmdbApiKey.trim()) {
      onToast('Configura tu TMDB API Key en ⚙ Configuración para explorar portadas, fondos y logos de TMDB.', 'warning');
      onOpenSettings('paths');
      return;
    }

    setFetchingFanart(true);
    try {
      const res = await fetchTmdbArtwork({
        mediaType: activeDoc.context.media_type,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        title: activeDoc.context.titulo,
        year: activeDoc.context.anio,
        config,
      });

      if (!res.ok || (res.gallery.length === 0 && !res.extracted.sinopsis && !res.extracted.titulo)) {
        onToast(`TMDB: ${res.error || 'No se encontraron artes ni metadatos en TMDB.'}`, 'warning');
        return;
      }

      onUpdateActiveDoc((doc) => {
        const otherSources = (doc.fanartGallery || []).filter(
          (item) => (item.source || 'fanart') !== 'tmdb'
        );
        return {
          ...doc,
          fanartGallery: [...res.gallery, ...otherSources],
          context: {
            ...doc.context,
            tmdb_id: res.extracted.tmdb_id || doc.context.tmdb_id,
            imdb_id: res.extracted.imdb_id || doc.context.imdb_id,
            tvdb_id: res.extracted.tvdb_id || doc.context.tvdb_id,
            media_type: res.extracted.media_type || doc.context.media_type,
            titulo: res.extracted.titulo || doc.context.titulo,
            anio: res.extracted.anio || doc.context.anio,
            sinopsis: res.extracted.sinopsis || doc.context.sinopsis,
            generos: res.extracted.generos || doc.context.generos,
            tmdb_rating: res.extracted.tmdb_rating || doc.context.tmdb_rating,
            trailer_url: res.extracted.trailer_url || doc.context.trailer_url,
            poster_url:
              (!doc.context.poster_url || doc.context.poster_url.startsWith('data:image/svg+xml')) &&
              res.extracted.poster_url
                ? res.extracted.poster_url
                : doc.context.poster_url,
            logo_url:
              (!doc.context.logo_url || doc.context.logo_url.startsWith('data:image/svg+xml')) &&
              res.extracted.logo_url
                ? res.extracted.logo_url
                : doc.context.logo_url,
            background_url:
              (!doc.context.background_url || doc.context.background_url.startsWith('data:image/svg+xml')) &&
              res.extracted.background_url
                ? res.extracted.background_url
                : doc.context.background_url,
          },
        };
      });
      onToast(`🎬 TMDB: ${res.gallery.length} arte(s) y metadatos sincronizados`, 'success');
    } finally {
      setFetchingFanart(false);
    }
  };

  const handleFetchOmdbVisualArt = async () => {
    if (!config.omdbApiKey.trim()) {
      onToast('Configura tu OMDb API Key en ⚙ Configuración para buscar portadas de OMDb / IMDb.', 'warning');
      onOpenSettings('paths');
      return;
    }

    setFetchingFanart(true);
    try {
      const res = await fetchOmdbArtwork({
        imdbId: activeDoc.context.imdb_id,
        title: activeDoc.context.titulo,
        year: activeDoc.context.anio,
        config,
      });

      if (!res.ok || (res.gallery.length === 0 && !res.extracted.sinopsis && !res.extracted.imdb_id)) {
        onToast(`OMDb/IMDb: ${res.error || 'No se encontraron portadas ni metadatos en OMDb.'}`, 'warning');
        return;
      }

      onUpdateActiveDoc((doc) => {
        const otherSources = (doc.fanartGallery || []).filter(
          (item) => (item.source || 'fanart') !== 'omdb'
        );
        return {
          ...doc,
          fanartGallery: [...res.gallery, ...otherSources],
          context: {
            ...doc.context,
            imdb_id: res.extracted.imdb_id || doc.context.imdb_id,
            imdb_rating: res.extracted.imdb_rating || doc.context.imdb_rating,
            titulo: res.extracted.titulo || doc.context.titulo,
            anio: res.extracted.anio || doc.context.anio,
            sinopsis: res.extracted.sinopsis || doc.context.sinopsis,
            generos: res.extracted.generos || doc.context.generos,
            poster_url:
              (!doc.context.poster_url || doc.context.poster_url.startsWith('data:image/svg+xml')) &&
              res.extracted.poster_url
                ? res.extracted.poster_url
                : doc.context.poster_url,
          },
        };
      });
      onToast(`🎞️ OMDb/IMDb: ${res.gallery.length} portada(s) y metadatos sincronizados`, 'success');
    } finally {
      setFetchingFanart(false);
    }
  };

  const handleFetchAllVisualArt = async () => {
    const cleanSynopsis =
      functionalPlugins.find((p) => p.id === 'ext-translator')?.enabled ?? true;
    const kind: 'video' | 'audio' =
      activeDoc.context.media_type === 'music' ? 'audio' : 'video';
    const fallbackProvider = pickBestConnectedProvider(
      apiProviders,
      config,
      kind,
      activeDoc.templateId,
      activeApiProviderId
    );
    const hasTmdb = Boolean(config.tmdbApiKey.trim());
    const hasOmdb = Boolean(config.omdbApiKey.trim());
    const hasFanart = Boolean(config.fanartApiKey.trim() || config.fanartClientKey.trim());
    if (!hasTmdb && !hasOmdb && !hasFanart && !fallbackProvider) {
      onToast('Configura al menos una API Key (TMDB, OMDb o Fanart.tv) en ⚙ Configuración.', 'warning');
      onOpenSettings('paths');
      return;
    }
    setFetchingFanart(true);
    try {
      const autoRes = await automatePostEnrichment({
        title: activeDoc.context.titulo || '',
        year: activeDoc.context.anio,
        artist: activeDoc.context.artista,
        mediaType: activeDoc.context.media_type,
        kind,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        tvdbId: activeDoc.context.tvdb_id,
        mbidId: activeDoc.context.mbid_id,
        anilistId: activeDoc.context.anilist_id,
        tvmazeId: activeDoc.context.tvmaze_id,
        fallbackProvider,
        config,
        cleanHtmlSynopsis: cleanSynopsis,
      });

      if (autoRes.gallery.length === 0 && Object.keys(autoRes.extracted).length === 0) {
        onToast('No se encontraron artes visuales ni metadatos para este título/ID.', 'warning');
        return;
      }

      const safeExtracted: Record<string, string> = {};
      for (const [k, v] of Object.entries(autoRes.extracted)) {
        if (typeof v === 'string' && v.trim() && SYNCABLE_METADATA_KEYS.has(k)) {
          safeExtracted[k] = v;
        }
      }

      onUpdateActiveDoc((doc) => ({
        ...doc,
        fanartGallery: autoRes.gallery.length > 0 ? autoRes.gallery : doc.fanartGallery,
        context: {
          ...doc.context,
          ...safeExtracted,
          poster_url: safeExtracted.poster_url || doc.context.poster_url,
          logo_url: safeExtracted.logo_url || doc.context.logo_url,
          banner_url: safeExtracted.banner_url || doc.context.banner_url,
          clearart_url: safeExtracted.clearart_url || doc.context.clearart_url,
          background_url: safeExtracted.background_url || doc.context.background_url,
          capturas_bbcode: doc.context.capturas_bbcode,
          espectrograma_bbcode: doc.context.espectrograma_bbcode,
          mediainfo_completo: doc.context.mediainfo_completo,
        },
      }));
      onToast(`🎨 Galería y metadatos actualizados: ${autoRes.note}`, 'success');
    } finally {
      setFetchingFanart(false);
    }
  };

  const handleFetchFanartBySlot = async (slot: 'banner_url' | 'logo_url' | 'clearart_url') => {
    if (!config.fanartApiKey.trim() && !config.fanartClientKey.trim()) {
      onToast('Configura tu Fanart.tv API Key en ⚙ Configuración para buscar Banners, Logos y ClearArts.', 'warning');
      onOpenSettings('paths');
      return;
    }

    setFetchingFanart(true);
    try {
      const lookupOpts = {
        mediaType: activeDoc.context.media_type,
        tmdbId: activeDoc.context.tmdb_id,
        imdbId: activeDoc.context.imdb_id,
        tvdbId: activeDoc.context.tvdb_id,
        mbidId: activeDoc.context.mbid_id,
        title: activeDoc.context.titulo,
        artist: activeDoc.context.artista,
        config,
      };
      const res =
        slot === 'banner_url'
          ? await fetchFanartBanners(lookupOpts)
          : slot === 'logo_url'
          ? await fetchFanartLogos(lookupOpts)
          : await fetchFanartClearArts(lookupOpts);

      if (!res.ok || !res.primaryUrl) {
        onToast(`Fanart.tv: ${res.error || 'No se encontraron resultados.'}`, 'warning');
        return;
      }

      setCoverUrlDraft(res.primaryUrl);
      onUpdateActiveDoc((doc) => {
        const existing = (doc.fanartGallery || []).filter(
          (item) => !(item.kind === res.kind && (item.source || 'fanart') === 'fanart')
        );
        return {
          ...doc,
          fanartGallery: [...res.items, ...existing],
          context: {
            ...doc.context,
            [slot]: res.primaryUrl,
          },
        };
      });
      onToast(
        `🎨 Fanart.tv (${res.kind}): ${res.items.length} opción(es) recuperadas y aplicadas`,
        'success'
      );
    } finally {
      setFetchingFanart(false);
    }
  };

  const visualArtItems = useMemo(
    () =>
      (activeDoc.fanartGallery || []).filter(
        (item) =>
          item.kind === 'poster' ||
          item.kind === 'logo' ||
          item.kind === 'banner' ||
          item.kind === 'clearart' ||
          item.kind === 'background'
      ),
    [activeDoc.fanartGallery]
  );

  const handleInsertVisualArt = (item: FanartArtworkItem, forceTagAtCursor = false) => {
    const slotMap: Record<
      'poster' | 'logo' | 'banner' | 'clearart' | 'background',
      'poster_url' | 'logo_url' | 'banner_url' | 'clearart_url' | 'background_url'
    > = {
      poster: 'poster_url',
      logo: 'logo_url',
      banner: 'banner_url',
      clearart: 'clearart_url',
      background: 'background_url',
    };
    const labelMap: Record<
      'poster' | 'logo' | 'banner' | 'clearart' | 'background',
      string
    > = {
      poster: 'Portada / Poster',
      logo: 'Logo HD',
      banner: 'Banner',
      clearart: 'ClearArt HD',
      background: 'Fondo / Backdrop',
    };
    if (
      item.kind !== 'poster' &&
      item.kind !== 'banner' &&
      item.kind !== 'logo' &&
      item.kind !== 'clearart' &&
      item.kind !== 'background'
    ) {
      return;
    }

    const targetSlot = slotMap[item.kind];
    const kindLabel = labelMap[item.kind];
    const sourceTag =
      (item.source || 'fanart') === 'tmdb'
        ? 'TMDB'
        : (item.source || 'fanart') === 'omdb'
        ? 'OMDb'
        : 'Fanart.tv';
    const bbTag =
      item.kind === 'logo'
        ? `[center][img size=350]${item.url}[/img][/center]`
        : `[center][img]${item.url}[/img][/center]`;

    setSelectedCoverSlot(targetSlot);
    setCoverUrlDraft(item.url);

    onUpdateActiveDoc((doc) => ({
      ...doc,
      context: { ...doc.context, [targetSlot]: item.url },
    }));

    const hasCustomBodyWithoutVar =
      activeDoc.customBody !== null &&
      !activeDoc.customBody.includes(`{{${targetSlot}}}`);

    if (forceTagAtCursor || hasCustomBodyWithoutVar) {
      insertBbTag(`${bbTag}\n`, '');
      onToast(`🎨 ${kindLabel} (${sourceTag}) insertado en el post y en {{${targetSlot}}}`, 'success');
    } else {
      onToast(`🎨 ${kindLabel} (${sourceTag}) aplicado en el post ({{${targetSlot}}})`, 'success');
    }
  };

  const handleDownloadTemplateJson = () => {
    const blob = new Blob([JSON.stringify(activeTemplate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTemplate.id}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast(`Plantilla "${activeTemplate.name}" exportada como .json`, 'success');
  };

  const handleDownloadTemplateTxt = () => {
    const content = `[Plantilla BBCode: ${activeTemplate.name}]\n[ID: ${activeTemplate.id}]\n\n=== TÍTULO PATRÓN ===\n${activeTemplate.titlePattern}\n\n=== CUERPO PATRÓN ===\n${activeTemplate.bodyPattern}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTemplate.id}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onToast(`Plantilla "${activeTemplate.name}" exportada como .txt para compartir`, 'success');
  };

  // =========================================================================
  // DOCKING HELPERS
  // =========================================================================
  const removePanelEverywhere = (state: DockState, panelId: PanelId): DockState => {
    const nextSlots = { ...state.slots };
    (Object.keys(nextSlots) as DockSlotKey[]).forEach((k) => {
      const slot = nextSlots[k];
      if (slot.panels.includes(panelId)) {
        const filtered = slot.panels.filter((p) => p !== panelId);
        nextSlots[k] = {
          panels: filtered,
          active: slot.active === panelId ? filtered[0] || null : slot.active,
        };
      }
    });
    return {
      slots: nextSlots,
      floating: state.floating.filter((f) => f.id !== panelId),
    };
  };

  const dockPanelToSlot = (panelId: PanelId, targetSlot: DockSlotKey) => {
    const cleaned = removePanelEverywhere(dockState, panelId);
    const existing = cleaned.slots[targetSlot];
    cleaned.slots[targetSlot] = {
      panels: [...existing.panels, panelId],
      active: panelId,
    };
    onUpdateDockState(cleaned);
    onToast(`Panel "${PANEL_META[panelId].title}" acoplado en ${SLOT_NAMES[targetSlot]}`, 'info');
  };

  const undockPanel = (panelId: PanelId, clientX?: number, clientY?: number) => {
    const cleaned = removePanelEverywhere(dockState, panelId);
    const x = clientX
      ? Math.max(24, Math.min(window.innerWidth - 440, clientX - 180))
      : 220 + cleaned.floating.length * 28;
    const y = clientY
      ? Math.max(64, Math.min(window.innerHeight - 320, clientY - 16))
      : 120 + cleaned.floating.length * 28;
    cleaned.floating.push({ id: panelId, x, y, w: 440, h: 320 });
    onUpdateDockState(cleaned);
  };

  const focusPanel = (panelId: PanelId) => {
    const fpIdx = dockState.floating.findIndex((f) => f.id === panelId);
    if (fpIdx !== -1) {
      const nextFloating = [...dockState.floating];
      const [item] = nextFloating.splice(fpIdx, 1);
      nextFloating.push(item);
      onUpdateDockState({ ...dockState, floating: nextFloating });
      return;
    }
    let foundInSlot = false;
    const nextSlots = { ...dockState.slots };
    (Object.keys(nextSlots) as DockSlotKey[]).forEach((k) => {
      if (nextSlots[k].panels.includes(panelId)) {
        nextSlots[k] = { ...nextSlots[k], active: panelId };
        foundInSlot = true;
      }
    });
    if (!foundInSlot) {
      const fallbackSlot = PANEL_META[panelId].defaultSlot;
      const existing = nextSlots[fallbackSlot] || { panels: [], active: null };
      nextSlots[fallbackSlot] = {
        panels: [...existing.panels, panelId],
        active: panelId,
      };
    }
    onUpdateDockState({ ...dockState, slots: nextSlots });
  };

  const getPanelLocation = (
    panelId: PanelId
  ): { kind: 'slot'; slot: DockSlotKey; isActive: boolean } | { kind: 'floating' } | { kind: 'hidden' } => {
    if (dockState.floating.some((f) => f.id === panelId)) {
      return { kind: 'floating' };
    }
    for (const slotKey of Object.keys(dockState.slots) as DockSlotKey[]) {
      const slot = dockState.slots[slotKey];
      if (slot?.panels.includes(panelId)) {
        return {
          kind: 'slot',
          slot: slotKey,
          isActive: (slot.active || slot.panels[0]) === panelId,
        };
      }
    }
    return { kind: 'hidden' };
  };

  const handleRemovePanel = (panelId: PanelId) => {
    const next = removePanelEverywhere(dockState, panelId);
    onUpdateDockState(next);
    onToast(
      `Panel "${PANEL_META[panelId].title}" eliminado · Puedes activarlo en Ventana`,
      'info'
    );
  };

  const handleRestorePanel = (panelId: PanelId) => {
    const targetSlot = PANEL_META[panelId].defaultSlot;
    const cleaned = removePanelEverywhere(dockState, panelId);
    const existing = cleaned.slots[targetSlot] || { panels: [], active: null };
    cleaned.slots[targetSlot] = {
      panels: [...existing.panels, panelId],
      active: panelId,
    };
    onUpdateDockState(cleaned);
    onToast(
      `Panel "${PANEL_META[panelId].title}" activado en ${SLOT_NAMES[targetSlot]}`,
      'success'
    );
  };

  const handleTogglePanelVisibility = (panelId: PanelId) => {
    const loc = getPanelLocation(panelId);
    if (loc.kind === 'hidden') {
      handleRestorePanel(panelId);
    } else {
      handleRemovePanel(panelId);
    }
  };

  const handleRestoreAllPanels = () => {
    const nextSlots = { ...dockState.slots };
    let restoredCount = 0;
    ALL_PANEL_IDS.forEach((panelId) => {
      const loc = getPanelLocation(panelId);
      if (loc.kind === 'hidden') {
        const targetSlot = PANEL_META[panelId].defaultSlot;
        const existing = nextSlots[targetSlot] || { panels: [], active: null };
        nextSlots[targetSlot] = {
          panels: [...existing.panels, panelId],
          active: existing.active || panelId,
        };
        restoredCount += 1;
      }
    });
    if (restoredCount === 0) {
      onToast('Todos los paneles ya están activos en el espacio de trabajo', 'info');
      return;
    }
    onUpdateDockState({
      slots: nextSlots,
      floating: dockState.floating,
    });
    onToast(`↺ ${restoredCount} panel(es) restaurado(s) en la vista`, 'success');
  };

  const evaluateDropHit = (clientX: number, clientY: number) => {
    let matchedGroupSlot: DockSlotKey | null = null;
    let matchedZone: DockSlotKey | null = null;

    document.querySelectorAll('[data-group-drop-slot]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        matchedGroupSlot = el.getAttribute('data-group-drop-slot') as DockSlotKey;
      }
    });

    if (!matchedGroupSlot) {
      document.querySelectorAll('[data-drop-zone]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          matchedZone = el.getAttribute('data-drop-zone') as DockSlotKey;
        }
      });
    }

    return { matchedZone, matchedGroupSlot };
  };

  const startPanelTabDrag = (e: React.PointerEvent, panelId: PanelId) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let activeDrag = false;

    const onMove = (ev: PointerEvent) => {
      if (!activeDrag && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
      if (!activeDrag) {
        if (isWorkspaceLocked) {
          cleanup();
          onToast('Desbloquea el candado (🔒 → 🔓) para mover o desacoplar paneles', 'warning');
          return;
        }
        activeDrag = true;
      }
      const hits = evaluateDropHit(ev.clientX, ev.clientY);
      setDraggingPanel({ id: panelId, x: ev.clientX, y: ev.clientY, ...hits });
    };

    const onUp = (ev: PointerEvent) => {
      if (activeDrag) {
        const hits = evaluateDropHit(ev.clientX, ev.clientY);
        setDraggingPanel(null);
        if (hits.matchedGroupSlot) {
          dockPanelToSlot(panelId, hits.matchedGroupSlot);
        } else if (hits.matchedZone) {
          dockPanelToSlot(panelId, hits.matchedZone);
        } else {
          undockPanel(panelId, ev.clientX, ev.clientY);
        }
      }
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startFloatingDrag = (e: React.PointerEvent, fpId: PanelId, initX: number, initY: number) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const offsetX = e.clientX - initX;
    const offsetY = e.clientY - initY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - (initX + offsetX), ev.clientY - (initY + offsetY)) > 4) {
        moved = true;
      }
      const nextX = Math.max(8, Math.min(window.innerWidth - 180, ev.clientX - offsetX));
      const nextY = Math.max(40, Math.min(window.innerHeight - 60, ev.clientY - offsetY));

      const curDock = dockStateRef.current;
      onUpdateDockState({
        ...curDock,
        floating: curDock.floating.map((f) => (f.id === fpId ? { ...f, x: nextX, y: nextY } : f)),
      });

      if (moved && !isWorkspaceLocked) {
        const hits = evaluateDropHit(ev.clientX, ev.clientY);
        setDraggingPanel({ id: fpId, x: ev.clientX, y: ev.clientY, ...hits });
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (moved && !isWorkspaceLocked) {
        const hits = evaluateDropHit(ev.clientX, ev.clientY);
        setDraggingPanel(null);
        if (hits.matchedGroupSlot) {
          dockPanelToSlot(fpId, hits.matchedGroupSlot);
        } else if (hits.matchedZone) {
          dockPanelToSlot(fpId, hits.matchedZone);
        }
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // =========================================================================
  // SPLITTERS
  // =========================================================================
  const startVerticalSplit = (e: React.PointerEvent, target: 'leftColPct' | 'centerColPct', refEl: HTMLDivElement | null) => {
    if (isWorkspaceLocked) {
      onToast('Desbloquea el candado (🔒 → 🔓) para redimensionar paneles', 'warning');
      return;
    }
    if (!columnsContainerRef.current || !refEl) return;
    e.preventDefault();
    const totalW = columnsContainerRef.current.getBoundingClientRect().width;
    if (totalW <= 0) return;
    const startX = e.clientX;
    const startW = refEl.getBoundingClientRect().width;
    const otherWidthPct =
      target === 'centerColPct'
        ? leftColRef.current
          ? splitRatiosRef.current.leftColPct
          : 0
        : centerColRef.current
        ? splitRatiosRef.current.centerColPct
        : 0;
    const maxPct = Math.max(20, 82 - otherWidthPct);

    const onMove = (ev: PointerEvent) => {
      const nextW = Math.max(200, Math.min((maxPct / 100) * totalW, startW + (ev.clientX - startX)));
      const pct = Math.round((nextW / totalW) * 1000) / 10;
      onUpdateSplitRatios({ ...splitRatiosRef.current, [target]: pct });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startHorizontalSplit = (
    e: React.PointerEvent,
    target: 'leftTopPct' | 'rightTopPct',
    parentEl: HTMLDivElement | null,
    initPct: number
  ) => {
    if (isWorkspaceLocked) {
      onToast('Desbloquea el candado (🔒 → 🔓) para redimensionar paneles', 'warning');
      return;
    }
    if (!parentEl) return;
    e.preventDefault();
    const totalH = parentEl.getBoundingClientRect().height;
    if (totalH <= 0) return;
    const startY = e.clientY;
    const startH = (initPct / 100) * totalH;

    const onMove = (ev: PointerEvent) => {
      const nextH = Math.max(120, Math.min(totalH - 120, startH + (ev.clientY - startY)));
      const pct = Math.round((nextH / totalH) * 1000) / 10;
      onUpdateSplitRatios({ ...splitRatiosRef.current, [target]: pct });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startBottomDockSplit = (e: React.PointerEvent) => {
    if (isWorkspaceLocked) {
      onToast('Desbloquea el candado (🔒 → 🔓) para redimensionar paneles', 'warning');
      return;
    }
    if (!dockRootRef.current) return;
    e.preventDefault();
    const totalH = dockRootRef.current.getBoundingClientRect().height;
    if (totalH <= 0) return;
    const startY = e.clientY;
    const startBottomH = (splitRatiosRef.current.bottomDockPct / 100) * totalH;

    const onMove = (ev: PointerEvent) => {
      const nextBottomH = Math.max(130, Math.min(totalH - 220, startBottomH - (ev.clientY - startY)));
      const pct = Math.round((nextBottomH / totalH) * 1000) / 10;
      onUpdateSplitRatios({ ...splitRatiosRef.current, bottomDockPct: pct });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // =========================================================================
  // PANEL CONTENT RENDERERS
  // =========================================================================
  const renderPanelContent = (panelId: PanelId) => {
    if (panelId === 'editor') {
      const lineCount = Math.max(1, rawBody.split('\n').length);
      return (
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setEditorFileDragOver(true);
            }
          }}
          onDragLeave={() => setEditorFileDragOver(false)}
          onDrop={(e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              setEditorFileDragOver(false);
              handleFilesIngest(Array.from(e.dataTransfer.files));
            }
          }}
          className="flex-1 min-h-0 flex flex-col bg-panel overflow-hidden relative"
        >
          {(editorFileDragOver || analyzingFile) && (
            <div className="absolute inset-0 z-30 bg-void/90 border-2 border-dashed border-cyberCyan flex flex-col items-center justify-center text-center p-4 pointer-events-none">
              <span className="text-2xl mb-1">{analyzingFile ? '⚙️' : '📂'}</span>
              <span className="text-xs font-mono font-extrabold text-cyberCyan uppercase">
                {analyzingFile
                  ? 'Analizando metadatos binarios, resolución y capturas...'
                  : 'Suelta aquí tu Video (MKV/MP4), Audio (FLAC/MP3), Imagen o NFO'}
              </span>
              <span className="text-[11px] text-slate-300 mt-0.5">
                Metadatos incrustados · Extracción automática de streams, capturas y carátulas
              </span>
            </div>
          )}

          <div className="p-2 bg-void/70 border-b border-cyberBorder flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-mono text-slate-400">PLANTILLA:</span>
                <span className="font-mono text-[10px] font-bold text-cyberCyan truncate">
                  {activeTemplate.name.split('(')[0].trim()}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                {/* Indicador de Validación BBCode en Tiempo Real */}
                {bbValidation.errorCount === 0 && bbValidation.warningCount === 0 ? (
                  <span
                    data-tooltip-title="Validador BBCode en tiempo real"
                    data-tooltip-desc={`Todas las etiquetas están correctamente formadas y cerradas (${bbValidation.validTagCount} etiquetas verificadas).`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-void border border-cyberGreen/40 text-cyberGreen font-mono text-[10px] font-bold tabular-nums"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyberGreen" />
                    <span>BBCode OK</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowBbDiagnostics((v) => !v)}
                    data-tooltip-title="Errores o advertencias de BBCode"
                    data-tooltip-desc="Haz clic para ver el detalle de etiquetas mal cerradas o mal formadas y saltar a la línea."
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px] font-bold cursor-pointer tabular-nums border ${
                      bbValidation.errorCount > 0
                        ? 'bg-red-500/15 border-red-500/60 text-red-300 hover:bg-red-500/25'
                        : 'bg-amber-500/15 border-amber-400/60 text-amber-300 hover:bg-amber-500/25'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        bbValidation.errorCount > 0 ? 'bg-red-500' : 'bg-amber-400'
                      }`}
                    />
                    {bbValidation.errorCount > 0 && (
                      <span>
                        {bbValidation.errorCount} {bbValidation.errorCount === 1 ? 'error' : 'errores'}
                      </span>
                    )}
                    {bbValidation.warningCount > 0 && (
                      <span className="text-amber-300">
                        {bbValidation.errorCount > 0 ? '· ' : ''}
                        {bbValidation.warningCount} {bbValidation.warningCount === 1 ? 'aviso' : 'avisos'}
                      </span>
                    )}
                    <span>{showBbDiagnostics ? '▴' : '▾'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setBbHighlightEnabled((v) => !v)}
                  title="Activar/desactivar esquema de colores BBCode"
                  className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer ${
                    bbHighlightEnabled
                      ? 'bg-void border-cyberCyan/50 text-cyberCyan font-bold'
                      : 'bg-void border-cyberBorder text-slate-400'
                  }`}
                >
                  🎨 Color
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(true)}
                  data-tooltip-title="Contraseñas Guardadas"
                  data-tooltip-desc="Elige, guarda o inserta una contraseña debajo de Password / Contraseña"
                  className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer max-w-[140px] truncate"
                >
                  🔑 {activeDoc.context.password || 'Sin Password'}
                </button>
                <button
                  onClick={handleBrowseMediaFiles}
                  className="px-2 py-0.5 rounded bg-elevated hover:bg-panel border border-cyberCyan/40 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer"
                >
                  📂 Abrir Archivo
                </button>
                <span className="text-[10px] font-mono text-cyberGreen tabular-nums">
                  {rawBody.length} chars · {lineCount} líneas
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-400 shrink-0">TÍTULO:</span>
              <input
                type="text"
                value={rawTitle}
                onChange={(e) =>
                  onUpdateActiveDoc((doc) => ({ ...doc, customTitle: e.target.value }))
                }
                className="flex-1 min-w-0 bg-canvasbg text-white font-mono text-xs rounded px-2.5 py-1 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
              <button
                type="button"
                onClick={copyCompiledTitle}
                title="Copiar título compilado del post"
                className="px-2 py-1 rounded bg-void hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                🏷️ Copiar Título
              </button>
            </div>
          </div>

          <div className="h-3 bg-elevated border-b border-cyberBorder flex shrink-0">
            <div className="w-9 border-r border-cyberBorder bg-void" />
            <div className="flex-1 ps-ruler-top" />
          </div>

          <div className="flex-1 min-h-0 flex relative overflow-hidden bg-canvasbg">
            <div className="w-2 ps-ruler-left border-r border-cyberBorder/60 bg-elevated/40 shrink-0" />
            <div
              ref={gutterRef}
              className="w-8 bg-void/90 border-r border-cyberBorder text-right py-2.5 font-mono text-[11px] leading-5 overflow-hidden shrink-0 select-none tabular-nums"
            >
              {Array.from({ length: lineCount }, (_, i) => {
                const lineNum = i + 1;
                const sev = bbValidation.lineSeverities[lineNum];
                return (
                  <div
                    key={lineNum}
                    className={`pr-1.5 ${
                      sev === 'error'
                        ? 'text-red-400 bg-red-500/15 font-bold'
                        : sev === 'warning'
                        ? 'text-amber-300 bg-amber-500/15 font-bold'
                        : 'text-slate-500'
                    }`}
                  >
                    {lineNum}
                  </div>
                );
              })}
            </div>

            <div
              ref={editorScrollRef}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden relative"
            >
              <div className="grid min-h-full">
                <div
                  aria-hidden="true"
                  className={`col-start-1 row-start-1 p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [tab-size:2] pointer-events-none select-none ${
                    bbHighlightEnabled ? 'text-slate-100' : 'text-transparent'
                  }`}
                >
                  {bbHighlightEnabled
                    ? bbValidation.segments.map((seg) => {
                        if (seg.kind === 'error') {
                          return (
                            <span
                              key={`${seg.start}-${seg.end}`}
                              className="bg-red-500/25 text-red-300 underline decoration-wavy decoration-red-400 rounded-[2px]"
                            >
                              {seg.text}
                            </span>
                          );
                        }
                        if (seg.kind === 'warning') {
                          return (
                            <span
                              key={`${seg.start}-${seg.end}`}
                              className="bg-amber-500/20 text-amber-200 underline decoration-wavy decoration-amber-400 rounded-[2px]"
                            >
                              {seg.text}
                            </span>
                          );
                        }
                        if (seg.kind === 'tag-valid') {
                          return (
                            <span key={`${seg.start}-${seg.end}`} className="text-cyan-300">
                              {seg.text}
                            </span>
                          );
                        }
                        if (seg.kind === 'tag-code') {
                          return (
                            <span key={`${seg.start}-${seg.end}`} className="text-emerald-300">
                              {seg.text}
                            </span>
                          );
                        }
                        if (seg.kind === 'var') {
                          return (
                            <span key={`${seg.start}-${seg.end}`} className="text-purple-300">
                              {seg.text}
                            </span>
                          );
                        }
                        return (
                          <React.Fragment key={`${seg.start}-${seg.end}`}>{seg.text}</React.Fragment>
                        );
                      })
                    : rawBody}
                  {rawBody.endsWith('\n') || rawBody.length === 0 ? ' ' : null}
                </div>

                <textarea
                  ref={textareaRef}
                  value={rawBody}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    rawBodyRef.current = nextVal;
                    lastEditorSelectionRef.current = {
                      start: e.target.selectionStart ?? nextVal.length,
                      end: e.target.selectionEnd ?? nextVal.length,
                    };
                    onUpdateActiveDoc((doc) => ({ ...doc, customBody: nextVal }));
                  }}
                  onSelect={syncEditorSelection}
                  onKeyUp={syncEditorSelection}
                  onMouseUp={syncEditorSelection}
                  onFocus={() => {
                    syncEditorSelection();
                    setShowMiniMenu(true);
                  }}
                  onClick={() => {
                    syncEditorSelection();
                    setShowMiniMenu(true);
                  }}
                  spellCheck={false}
                  className={`col-start-1 row-start-1 w-full h-full min-h-full p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [tab-size:2] bg-transparent resize-none overflow-hidden focus:outline-none selection:bg-cyan-500/30 select-text ${
                    bbHighlightEnabled ? 'text-transparent caret-cyan-300' : 'text-slate-100'
                  }`}
                />
              </div>
            </div>

            {showMiniMenu && (
              <div className="absolute bottom-2.5 left-12 right-3 z-20 bg-elevated/95 border border-cyberCyan/60 rounded-xl px-2 py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.85)] backdrop-blur-md flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {miniMenuTools.map((tool, idx) =>
                    tool.open === '__MODAL_SPOILER_LINKS__' ? (
                      <button
                        key={`${tool.label}-${idx}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setShowMiniMenu(false);
                          onOpenSpoilerLinks();
                        }}
                        className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/60 text-[11px] font-mono font-bold text-cyberCyan cursor-pointer shrink-0"
                      >
                        {tool.label}
                      </button>
                    ) : (
                      <button
                        key={`${tool.label}-${idx}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insertBbTag(tool.open, tool.close);
                        }}
                        className="px-2 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-[11px] font-mono font-semibold text-slate-100 hover:text-cyberCyan cursor-pointer shrink-0"
                      >
                        {tool.label}
                      </button>
                    )
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 pl-1 border-l border-cyberBorder">
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onOpenSettings('minimenu');
                    }}
                    title="Editar Mini Menú"
                    className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder text-[10px] font-mono text-cyberMagenta cursor-pointer"
                  >
                    ✎
                  </button>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setShowMiniMenu(false);
                    }}
                    title="Ocultar Mini Menú"
                    className="px-1.5 py-0.5 rounded bg-void hover:bg-red-600 text-[10px] font-mono text-slate-400 hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* PANEL DE DIAGNÓSTICO Y LEYENDA DE COLORES BBCODE */}
          {showBbDiagnostics && bbValidation.diagnostics.length > 0 && (
            <div className="bg-void border-t border-cyberBorder max-h-32 overflow-y-auto divide-y divide-cyberBorder/50 shrink-0">
              {bbValidation.diagnostics.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => jumpToBbDiagnostic(d)}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-elevated flex items-center justify-between gap-2 text-[11px] font-mono cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        d.severity === 'error' ? 'bg-red-500' : 'bg-amber-400'
                      }`}
                    />
                    <span className="text-slate-400 tabular-nums shrink-0">
                      L{d.line}:{d.column}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded shrink-0 max-w-[130px] truncate ${
                        d.severity === 'error'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-amber-500/20 text-amber-200'
                      }`}
                    >
                      {d.snippet}
                    </span>
                    <span className="text-slate-200 truncate font-sans">{d.message}</span>
                  </div>
                  <span className="text-[10px] text-cyberCyan shrink-0">Ir →</span>
                </button>
              ))}
            </div>
          )}

          <div className="px-2.5 py-1 bg-void/90 border-t border-cyberBorder flex items-center justify-between gap-2 text-[10px] font-mono shrink-0 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-3 shrink-0">
              <span className="inline-flex items-center gap-1 text-red-300">
                <span className="w-2 h-2 rounded-sm bg-red-500/60 border border-red-400" />
                <span>Error (sin cerrar / cierre huérfano)</span>
              </span>
              <span className="inline-flex items-center gap-1 text-amber-300">
                <span className="w-2 h-2 rounded-sm bg-amber-500/50 border border-amber-400" />
                <span>Aviso (mal formada / atributo)</span>
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-cyan-300">
                <span className="w-2 h-2 rounded-sm bg-cyan-400/50" />
                <span>Etiqueta OK</span>
              </span>
              <span className="hidden md:inline-flex items-center gap-1 text-purple-300">
                <span className="w-2 h-2 rounded-sm bg-purple-400/50" />
                <span>{'{{variable}}'}</span>
              </span>
            </div>
            {bbValidation.diagnostics.length > 0 && (
              <button
                type="button"
                onClick={() => setShowBbDiagnostics((v) => !v)}
                className="text-cyberCyan hover:underline cursor-pointer shrink-0"
              >
                {showBbDiagnostics ? 'Ocultar lista' : `Ver ${bbValidation.diagnostics.length} detalle(s)`}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (panelId === 'compiled') {
      return (
        <div className="flex-1 min-h-0 flex flex-col bg-canvasbg overflow-hidden">
          <div className="px-2.5 py-1 bg-void/80 border-b border-cyberBorder flex items-center justify-between gap-2 text-[10px] font-mono shrink-0 flex-wrap">
            <span className="text-cyberGreen">BBCODE COMPILADO (SOLO CUERPO DEL POST)</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 tabular-nums">
                {cleanBbCode.split('\n').length} líneas
              </span>
              <button
                type="button"
                onClick={copyCompiledTitle}
                title="Copiar solo el título del post para pegarlo aparte en la página"
                className="px-2 py-0.5 rounded bg-elevated hover:bg-panel border border-cyberCyan/50 text-cyberCyan font-bold cursor-pointer whitespace-nowrap"
              >
                🏷️ Copiar Título
              </button>
              <button
                type="button"
                onClick={copyCompiledBbCode}
                title="Copiar solo el código BBCode compilado (sin título ni separadores)"
                className="px-2 py-0.5 rounded bg-elevated hover:bg-panel border border-cyberGreen/50 text-cyberGreen font-bold cursor-pointer whitespace-nowrap"
              >
                📋 Copiar BBCode
              </button>
            </div>
          </div>
          <div className="px-2.5 py-1.5 bg-elevated/50 border-b border-cyberBorder/80 flex items-center justify-between gap-2 text-[11px] font-mono shrink-0 select-none">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-slate-400 uppercase shrink-0">Título:</span>
              <span className="text-white font-semibold truncate select-all">
                {compiledTitle || 'Sin título'}
              </span>
            </div>
            <button
              type="button"
              onClick={copyCompiledTitle}
              className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-[10px] text-cyberCyan cursor-pointer shrink-0 whitespace-nowrap"
            >
              📋 Copiar
            </button>
          </div>
          <pre className="flex-1 min-h-0 p-2.5 font-mono text-[11px] text-slate-300 overflow-auto whitespace-pre-wrap break-words select-text">
            {cleanBbCode}
          </pre>
        </div>
      );
    }

    if (panelId === 'webview') {
      return (
        <div className="flex-1 min-h-0 flex flex-col bg-void overflow-hidden">
          <div className="px-3 py-1.5 bg-elevated/80 border-b border-cyberBorder flex items-center justify-between gap-2 shrink-0 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border shrink-0 ${
                  renderedPost.site === 'identi'
                    ? 'bg-[#80ffea]/10 border-[#80ffea]/50 text-[#80ffea]'
                    : renderedPost.site === 'zinfinal'
                    ? 'bg-[#3366ff]/15 border-[#3366ff]/60 text-cyberCyan'
                    : 'bg-panel border-cyberBorder text-slate-300'
                }`}
              >
                {renderedPost.styleLabel}
              </span>
              <span className="text-xs font-bold text-white truncate">
                {compiledTitle || 'Vista Previa del Post'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onSwitchSiteStyle('zinfinal')}
                className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors ${
                  renderedPost.site === 'zinfinal'
                    ? 'bg-[#3366ff]/25 border-cyberCyan text-white font-bold'
                    : 'bg-void border-cyberBorder text-slate-400 hover:text-white'
                }`}
              >
                Zinfinal Aensy
              </button>
              <button
                type="button"
                onClick={() => onSwitchSiteStyle('identi')}
                className={`px-2 py-0.5 rounded font-mono text-[10px] border cursor-pointer transition-colors ${
                  renderedPost.site === 'identi'
                    ? 'bg-[#80ffea]/15 border-[#80ffea] text-[#80ffea] font-bold'
                    : 'bg-void border-cyberBorder text-slate-400 hover:text-white'
                }`}
              >
                Identi
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-y-auto text-xs text-slate-200 leading-relaxed select-text">
            {compiledBodyWithMarkers.trim() ? (
              renderedPost.renderedNodes
            ) : (
              <div className="text-center text-slate-500 py-12 font-mono">
                El contenido renderizado aparecerá aquí...
              </div>
            )}
          </div>
        </div>
      );
    }

    if (panelId === 'covers') {
      const currentVal = activeDoc.context[selectedCoverSlot] || '';
      const isLocalRaster =
        currentVal.startsWith('data:image/') && !currentVal.startsWith('data:image/svg+xml');
      const gallery = activeDoc.fanartGallery || [];
      const slotMapForKind: Record<FanartArtworkItem['kind'], string> = {
        logo: 'logo_url',
        banner: 'banner_url',
        clearart: 'clearart_url',
        poster: 'poster_url',
        background: 'background_url',
        thumb: 'thumb_url',
        disc: 'thumb_url',
      };

      return (
        <div className="flex-1 min-h-0 flex flex-col bg-panel p-2.5 gap-2 overflow-y-auto">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-[10px] font-mono text-cyberCyan uppercase font-bold">
                  Tipo de Cover / Artwork:
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIdentifyModalOpen(true)}
                    className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
                    title="Identificar contenido ingresando el ID del proveedor (TMDB, IMDb, TVDB, MBID...)"
                  >
                    🎯 Identificar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRefreshMetadata()}
                    disabled={refreshingMetadata || fetchingFanart}
                    className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                    title="Volver a buscar sinopsis, metadatos y artes en todos los proveedores"
                  >
                    {refreshingMetadata ? '⏳...' : '🔄 Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={handleFetchTmdbVisualArt}
                    disabled={fetchingFanart}
                    className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                    title="Buscar portadas, logos y fondos en TMDB"
                  >
                    🎬 TMDB
                  </button>
                  <button
                    type="button"
                    onClick={handleFetchOmdbVisualArt}
                    disabled={fetchingFanart}
                    className="px-2 py-0.5 rounded bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/50 text-amber-300 font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                    title="Buscar portadas y covers en OMDb / IMDb"
                  >
                    🎞️ OMDb
                  </button>
                  {(selectedCoverSlot === 'banner_url' ||
                    selectedCoverSlot === 'logo_url' ||
                    selectedCoverSlot === 'clearart_url') && (
                    <button
                      type="button"
                      onClick={() =>
                        handleFetchFanartBySlot(
                          selectedCoverSlot as 'banner_url' | 'logo_url' | 'clearart_url'
                        )
                      }
                      disabled={fetchingFanart}
                      className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                      title="Recuperar específicamente este tipo de artwork desde Fanart.tv"
                    >
                      {selectedCoverSlot === 'banner_url'
                        ? '🎯 Solo Banners'
                        : selectedCoverSlot === 'logo_url'
                        ? '🎯 Solo Logos'
                        : '🎯 Solo ClearArt'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleFetchFanartForDoc}
                    disabled={fetchingFanart}
                    className="px-2 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                    title="Buscar Banners, ClearArts y Logos en Fanart.tv"
                  >
                    {fetchingFanart ? '⏳...' : '🎨 Fanart.tv'}
                  </button>
                </div>
              </div>
              <select
                value={selectedCoverSlot}
                onChange={(e) => setSelectedCoverSlot(e.target.value)}
                className="w-full bg-void text-white font-semibold text-xs rounded-lg px-2.5 py-1.5 border border-cyberBorder cursor-pointer"
              >
                <option value="poster_url">Portada / Poster ({'{{poster_url}}'})</option>
                <option value="logo_url">Logo HD Transparente · 350px ({'{{logo_url}}'})</option>
                <option value="banner_url">Banner / Separador Gráfico ({'{{banner_url}}'})</option>
                <option value="clearart_url">ClearArt HD ({'{{clearart_url}}'})</option>
                <option value="background_url">Fondo / Fanart 4K ({'{{background_url}}'})</option>
                <option value="thumb_url">Miniatura / Preview ({'{{thumb_url}}'})</option>
                <option value="separator_url">Separador Personalizado ({'{{separator_url}}'})</option>
              </select>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={coverUrlDraft}
                  onChange={(e) => setCoverUrlDraft(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 min-w-0 bg-void text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1 border border-cyberBorder"
                />
                <button
                  onClick={() => {
                    if (!coverUrlDraft.trim()) return;
                    onUpdateActiveDoc((doc) => ({
                      ...doc,
                      context: { ...doc.context, [selectedCoverSlot]: coverUrlDraft.trim() },
                    }));
                    onToast(`Imagen actualizada en {{${selectedCoverSlot}}}`, 'success');
                  }}
                  className="neon-btn-cyan px-3 py-1 rounded-lg font-extrabold text-[11px] shrink-0 cursor-pointer"
                >
                  Aplicar
                </button>
                {isLocalRaster && (
                  <button
                    onClick={() => handleUploadLocalCover(selectedCoverSlot, currentVal)}
                    disabled={uploadingCover}
                    className="px-2.5 py-1 rounded-lg bg-cyberGreen/20 hover:bg-cyberGreen/30 border border-cyberGreen text-cyberGreen font-mono font-bold text-[10px] shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {uploadingCover ? '⏳...' : '☁ Subir al Host'}
                  </button>
                )}
              </div>
            </div>

            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer?.files?.[0];
                if (f) handleLocalCoverFile(f);
              }}
              className="sm:w-40 border-2 border-dashed border-cyberBorder hover:border-cyberCyan rounded-xl bg-void/80 p-2 flex flex-col items-center justify-center text-center cursor-pointer shrink-0"
            >
              <span className="text-base">🖼️</span>
              <span className="text-[11px] font-bold text-white mt-0.5">Drop Cover Aquí</span>
              <span className="text-[9px] font-mono text-slate-400">PNG / JPG / WEBP</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = '';
                  if (f) handleLocalCoverFile(f);
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {COVER_SLOTS.map((slot) => {
              const isSel = slot.key === selectedCoverSlot;
              return (
                <button
                  key={slot.key}
                  onClick={() => setSelectedCoverSlot(String(slot.key))}
                  className={`rounded-lg bg-void border ${
                    isSel
                      ? 'border-cyberCyan shadow-[0_0_10px_rgba(0,240,255,0.3)]'
                      : 'border-cyberBorder'
                  } p-1 flex flex-col items-center gap-1 cursor-pointer overflow-hidden`}
                >
                  <img
                    src={activeDoc.context[slot.key]}
                    alt={slot.label}
                    referrerPolicy="no-referrer"
                    className="w-full h-10 object-cover rounded"
                  />
                  <span
                    className={`text-[9px] font-mono truncate w-full text-center ${
                      isSel ? 'text-cyberCyan font-bold' : 'text-slate-400'
                    }`}
                  >
                    {slot.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="text-[10px] font-mono text-slate-400 bg-void/60 border border-cyberBorder/60 rounded-lg px-2 py-1">
            ℹ Las capturas extraídas del archivo solo se asignan a{' '}
            <span className="text-cyberCyan font-semibold">{'{{capturas_bbcode}}'}</span> y nunca sustituyen portadas, fondos o banners.
          </div>

          {gallery.length > 0 && (
            <div className="bg-void/90 border border-cyberBorder rounded-xl p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono font-bold text-cyberGreen uppercase">
                  🎨 Galería de Arte ({gallery.length} · TMDB / OMDb / Fanart)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTool('artgallery');
                    setArtSidebarOpen(true);
                  }}
                  className="px-2 py-0.5 rounded bg-panel border border-cyberCyan/40 hover:border-cyberCyan text-cyberCyan font-mono text-[9px] font-bold cursor-pointer"
                >
                  Abrir Selector Visual
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                {gallery.map((item) => {
                  const targetSlot = slotMapForKind[item.kind];
                  const isActive = activeDoc.context[targetSlot] === item.url;
                  const srcName =
                    (item.source || 'fanart') === 'tmdb'
                      ? 'TMDB'
                      : (item.source || 'fanart') === 'omdb'
                      ? 'OMDb'
                      : 'Fanart';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedCoverSlot(targetSlot);
                        setCoverUrlDraft(item.url);
                        onUpdateActiveDoc((doc) => ({
                          ...doc,
                          context: { ...doc.context, [targetSlot]: item.url },
                        }));
                        onToast(`${srcName} (${item.kind}) aplicado en {{${targetSlot}}}`, 'success');
                      }}
                      title={`${srcName} · ${item.kind.toUpperCase()} (${item.lang || 'N/A'}) → {{${targetSlot}}}`}
                      className={`rounded-lg bg-panel border p-1 flex flex-col items-center gap-0.5 cursor-pointer transition-colors overflow-hidden ${
                        isActive
                          ? 'border-cyberGreen shadow-[0_0_8px_rgba(0,255,157,0.35)]'
                          : 'border-cyberBorder hover:border-cyberCyan'
                      }`}
                    >
                      <img
                        src={item.previewUrl || item.url}
                        alt={`${srcName} ${item.kind} ${item.lang || ''}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-9 object-contain bg-void rounded"
                      />
                      <span className="text-[9px] font-mono text-slate-300 truncate w-full text-center">
                        {srcName} · {item.kind}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (panelId === 'mediainfo') {
      const mi = activeDoc.mediainfoDetails;
      const fallbackRaw = activeDoc.context.mediainfo_completo || '';
      const rawTextToUse = mi?.rawReport || fallbackRaw;

      const copyRawReport = async () => {
        if (!rawTextToUse.trim()) return;
        try {
          await navigator.clipboard.writeText(rawTextToUse);
        } catch {
          const tempTa = document.createElement('textarea');
          tempTa.value = rawTextToUse;
          document.body.appendChild(tempTa);
          tempTa.select();
          document.execCommand('copy');
          document.body.removeChild(tempTa);
        }
        onToast('📊 Informe MediaInfo copiado al portapapeles', 'success');
      };

      const insertRawReportToEditor = () => {
        if (!rawTextToUse.trim()) return;
        insertBbTag(`[code]\n${rawTextToUse}\n[/code]`, '');
        onToast('📝 Informe MediaInfo insertado en el Editor BBCode', 'success');
      };

      return (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setMediainfoDragOver(true);
          }}
          onDragLeave={() => setMediainfoDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setMediainfoDragOver(false);
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
              handleFilesIngest(Array.from(e.dataTransfer.files));
            }
          }}
          className={`flex-1 min-h-0 flex flex-col bg-panel overflow-hidden relative ${
            mediainfoDragOver ? 'ring-2 ring-inset ring-cyberCyan bg-cyberCyan/5' : ''
          }`}
        >
          {/* Barra superior del panel MediaInfo */}
          <div className="px-2.5 py-1.5 bg-elevated/80 border-b border-cyberBorder flex items-center justify-between gap-2 shrink-0 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-bold text-white truncate">
                {mediainfoShowRecents
                  ? `Proyectos Recientes (${recentProjects.length})`
                  : mi
                  ? mi.fileName
                  : 'Análisis Técnico MediaInfo'}
              </span>
              {!mediainfoShowRecents && mi && (
                <span className="px-1.5 py-0.5 rounded bg-void border border-cyberCyan/40 text-[10px] font-mono text-cyberCyan shrink-0">
                  {mi.container}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleBrowseMediaFiles}
                disabled={analyzingFile}
                className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {analyzingFile ? '⏳...' : '📂 Analizar'}
              </button>
              <button
                type="button"
                onClick={() => setIdentifyModalOpen(true)}
                title="Identificar contenido ingresando el ID del proveedor (TMDB, IMDb, TVDB, MBID...)"
                className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
              >
                🎯 Identificar
              </button>
              <button
                type="button"
                onClick={() => handleRefreshMetadata()}
                disabled={refreshingMetadata}
                title="Buscar metadatos nuevamente en TMDB, OMDb/IMDb y Fanart.tv"
                className="px-2 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {refreshingMetadata ? '⏳...' : '🔄 Refresh'}
              </button>
              <button
                type="button"
                onClick={() => setMediainfoShowRecents((v) => !v)}
                className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer whitespace-nowrap tabular-nums ${
                  mediainfoShowRecents
                    ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan font-bold'
                    : 'bg-void hover:bg-elevated border-cyberBorder text-slate-200 hover:border-cyberCyan/60'
                }`}
              >
                🕒 Recientes ({recentProjects.length})
              </button>
              {mi && !mediainfoShowRecents && (
                <button
                  type="button"
                  onClick={() => setMediainfoRawView((v) => !v)}
                  className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer whitespace-nowrap ${
                    mediainfoRawView
                      ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan font-bold'
                      : 'bg-void hover:bg-elevated border-cyberBorder text-slate-300'
                  }`}
                >
                  {mediainfoRawView ? '📊 Vista Técnica' : '📄 Texto Raw'}
                </button>
              )}
              {!mediainfoShowRecents && rawTextToUse.trim() && (
                <>
                  <button
                    type="button"
                    onClick={copyRawReport}
                    title="Copiar reporte MediaInfo"
                    className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[10px] cursor-pointer whitespace-nowrap"
                  >
                    📋 Copiar
                  </button>
                  <button
                    type="button"
                    onClick={insertRawReportToEditor}
                    title="Insertar bloque [code] en Editor BBCode"
                    className="px-2 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
                  >
                    📝 Insertar [code]
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 text-xs">
            {mediainfoShowRecents ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 pb-1 border-b border-cyberBorder/60">
                  <span className="text-[10px] font-mono text-slate-400">
                    Reabre metadatos e informe MediaInfo guardados sin volver a escanear el archivo físico.
                  </span>
                  {recentProjects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearRecentProjects();
                        onToast('Historial de proyectos recientes limpiado.', 'info');
                      }}
                      className="px-2 py-0.5 rounded bg-void hover:bg-red-950/40 border border-cyberBorder hover:border-red-500/60 text-slate-300 hover:text-red-300 font-mono text-[10px] cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      🗑 Limpiar todo
                    </button>
                  )}
                </div>

                {recentProjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-cyberBorder bg-void/60 p-5 text-center space-y-2">
                    <div className="text-xl">🕒</div>
                    <div className="text-xs font-bold text-slate-200">
                      No hay proyectos MediaInfo recientes todavía
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Cada vez que sueltes o analices un archivo MKV, MP4, FLAC o MP3, sus datos técnicos quedarán guardados aquí automáticamente.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {recentProjects.map((proj) => {
                      const pmi = proj.mediainfoDetails;
                      const isCurrentlyOpen =
                        activeDoc.mediainfoDetails?.fileName === pmi.fileName &&
                        activeDoc.mediainfoDetails?.fileSizeBytes === pmi.fileSizeBytes;
                      return (
                        <div
                          key={proj.id}
                          className={`rounded-lg border p-2.5 bg-void/90 flex flex-col gap-2 transition-colors ${
                            isCurrentlyOpen
                              ? 'border-cyberCyan/70 bg-cyberCyan/5'
                              : 'border-cyberBorder hover:border-cyberCyan/50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-white truncate text-[12px]">
                                  {pmi.fileName}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-panel border border-cyberCyan/40 text-[9px] font-mono text-cyberCyan shrink-0">
                                  {pmi.container}
                                </span>
                                {isCurrentlyOpen && (
                                  <span className="px-1.5 py-0.5 rounded bg-cyberGreen/15 border border-cyberGreen/40 text-[9px] font-mono text-cyberGreen shrink-0">
                                    Activo
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-slate-300 mt-0.5 tabular-nums truncate">
                                {formatRecentTechSummary(pmi)}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 shrink-0 tabular-nums">
                              {new Date(proj.analyzedAt).toLocaleString('es-ES', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => openRecentProjectInWorkspace(proj, 'current-tab')}
                              className="px-2 py-0.5 rounded bg-elevated hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[10px] cursor-pointer whitespace-nowrap"
                            >
                              ↩ Cargar aquí
                            </button>
                            <button
                              type="button"
                              onClick={() => openRecentProjectInWorkspace(proj, 'new-tab')}
                              className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
                            >
                              📑 Abrir pestaña
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveRecentProject(proj.id)}
                              title="Eliminar del historial"
                              className="px-1.5 py-0.5 rounded bg-void hover:bg-red-950/40 border border-cyberBorder hover:border-red-500/60 text-slate-400 hover:text-red-300 font-mono text-[10px] cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : mi ? (
              mediainfoRawView ? (
                <pre className="bg-void border border-cyberBorder rounded-lg p-2.5 font-mono text-[11px] text-slate-200 whitespace-pre-wrap select-text leading-relaxed">
                  {mi.rawReport}
                </pre>
              ) : (
                <>
                  {/* GENERAL */}
                  <section className="bg-void/90 border border-cyberBorder rounded-lg p-2.5">
                    <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-cyberBorder/60">
                      <span className="text-[10px] font-mono font-bold text-cyberCyan uppercase tracking-wider">
                        General · Contenedor
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                        {new Date(mi.analyzedAt).toLocaleTimeString('es-ES', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-400">Formato</div>
                        <div className="font-mono font-bold text-slate-100 truncate">{mi.container}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Tamaño</div>
                        <div className="font-mono font-bold text-slate-100 tabular-nums">{mi.fileSize}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Duración</div>
                        <div className="font-mono font-bold text-slate-100 tabular-nums">{mi.duration}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Bitrate Global</div>
                        <div className="font-mono font-bold text-cyberGreen tabular-nums">{mi.overallBitrate}</div>
                      </div>
                    </div>
                  </section>

                  {/* VIDEO STREAMS */}
                  {mi.videoTracks.length > 0 && (
                    <section className="space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-cyberCyan uppercase tracking-wider px-0.5">
                        Video ({mi.videoTracks.length})
                      </div>
                      {mi.videoTracks.map((vt) => (
                        <div
                          key={`v-${vt.index}`}
                          className="bg-void/90 border border-cyberBorder rounded-lg p-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2"
                        >
                          <div>
                            <div className="text-[10px] text-slate-400">Códec</div>
                            <div className="font-mono font-bold text-white truncate">
                              {vt.codec}
                              {vt.profile ? (
                                <span className="text-slate-400 font-normal"> · {vt.profile}</span>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Resolución</div>
                            <div className="font-mono font-bold text-cyberCyan tabular-nums">
                              {vt.width && vt.height ? `${vt.width} × ${vt.height}` : vt.resolutionLabel || '—'}
                              {vt.resolutionLabel && vt.width ? (
                                <span className="text-slate-400 font-normal"> ({vt.resolutionLabel})</span>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">FPS</div>
                            <div className="font-mono font-bold text-cyberGreen tabular-nums">
                              {vt.fps || 'No detectado'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Bitrate Video</div>
                            <div className="font-mono font-bold text-slate-100 tabular-nums">
                              {vt.bitrate || 'Variable / Contenedor'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Relación de Aspecto</div>
                            <div className="font-mono text-slate-200 tabular-nums">
                              {vt.aspectRatio || '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Color / Profundidad</div>
                            <div className="font-mono text-slate-200 truncate tabular-nums">
                              {[vt.bitDepth, vt.colorSpace].filter(Boolean).join(' · ') || 'Estándar 8-bit'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* AUDIO STREAMS */}
                  {mi.audioTracks.length > 0 && (
                    <section className="space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-cyberGreen uppercase tracking-wider px-0.5">
                        Audio ({mi.audioTracks.length})
                      </div>
                      {mi.audioTracks.map((at) => (
                        <div
                          key={`a-${at.index}`}
                          className="bg-void/90 border border-cyberBorder rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[10px] font-bold text-cyberGreen shrink-0">
                              #{at.index}
                            </span>
                            <span className="font-mono font-bold text-white truncate">{at.codec}</span>
                            {at.language && (
                              <span className="px-1.5 py-0.5 rounded bg-panel border border-cyberBorder font-mono text-[10px] text-slate-200 shrink-0">
                                {at.language}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-300 tabular-nums">
                            {at.bitrate && <span className="text-cyberCyan font-bold">{at.bitrate}</span>}
                            {(at.channelLayout || at.channels) && (
                              <span>
                                {at.channels ? `${at.channels} ch` : ''}
                                {at.channelLayout ? ` (${at.channelLayout})` : ''}
                              </span>
                            )}
                            {at.sampleRate && <span>{at.sampleRate}</span>}
                            {at.bitDepth && <span>{at.bitDepth}</span>}
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* SUBTITLE STREAMS */}
                  {mi.subtitleTracks.length > 0 && (
                    <section className="space-y-1.5">
                      <div className="text-[10px] font-mono font-bold text-cyberMagenta uppercase tracking-wider px-0.5">
                        Subtítulos ({mi.subtitleTracks.length})
                      </div>
                      <div className="bg-void/90 border border-cyberBorder rounded-lg divide-y divide-cyberBorder/50">
                        {mi.subtitleTracks.map((st) => (
                          <div
                            key={`s-${st.index}`}
                            className="px-2.5 py-1.5 flex items-center justify-between gap-2 font-mono text-[11px]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-cyberMagenta font-bold">#{st.index}</span>
                              <span className="text-white font-semibold">{st.format}</span>
                              {st.title && <span className="text-slate-400 truncate">· {st.title}</span>}
                            </div>
                            <span className="text-slate-300 shrink-0">{st.language || 'Und'}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-4 px-2">
                <div className="w-full max-w-md rounded-xl border-2 border-dashed border-cyberBorder hover:border-cyberCyan/70 bg-void/70 p-4 space-y-2">
                  <div className="text-2xl">📊</div>
                  <div className="text-xs font-bold text-white">
                    Suelta aquí un archivo multimedia o analízalo con MediaInfo
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Extrae bitrate, códecs de video/audio, resolución, FPS, canales, espacio de color y subtítulos de MKV, MP4, FLAC o MP3.
                  </p>
                  <button
                    type="button"
                    onClick={handleBrowseMediaFiles}
                    className="neon-btn-cyan px-3.5 py-1.5 rounded-lg font-extrabold text-[11px] cursor-pointer"
                  >
                    📂 Seleccionar Archivo para Analizar
                  </button>
                </div>

                {recentProjects.length > 0 && (
                  <div className="w-full max-w-md text-left bg-void/80 border border-cyberBorder rounded-xl p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-cyberBorder/60">
                      <span className="text-[10px] font-mono font-bold text-cyberCyan uppercase tracking-wider">
                        🕒 Proyectos Recientes ({recentProjects.length})
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        Sin re-analizar archivo
                      </span>
                    </div>
                    <div className="space-y-1">
                      {recentProjects.slice(0, 5).map((proj) => (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => openRecentProjectInWorkspace(proj, 'new-tab')}
                          className="w-full text-left px-2 py-1.5 rounded-lg bg-panel/70 hover:bg-elevated border border-cyberBorder/70 hover:border-cyberCyan/60 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold text-white truncate">
                              {proj.mediainfoDetails.fileName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate tabular-nums">
                              {formatRecentTechSummary(proj.mediainfoDetails)}
                            </div>
                          </div>
                          <span className="px-1.5 py-0.5 rounded bg-void border border-cyberCyan/40 text-[9px] font-mono text-cyberCyan shrink-0">
                            Abrir
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {fallbackRaw.trim() && (
                  <details className="w-full text-left bg-void border border-cyberBorder rounded-lg p-2">
                    <summary className="text-[10px] font-mono text-cyberCyan cursor-pointer font-bold">
                      Ver bloque MediaInfo guardado en este documento ({'{{mediainfo_completo}}'})
                    </summary>
                    <pre className="mt-2 font-mono text-[10px] text-slate-300 whitespace-pre-wrap select-text">
                      {fallbackRaw}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    // layers
    const groups = [
      {
        title: 'Stream #0: Video & General (Zinfinal / Identi)',
        color: 'text-cyberCyan',
        vars: [
          'titulo',
          'anio',
          'resolucion',
          'codec_video',
          'duracion',
          'peso_archivo',
          'fuente',
          'capitulos',
          'servidores',
          'creditos',
          'notas_uploader',
          'video_info_bloque',
          'video_info_identi',
        ],
      },
      {
        title: 'Stream #1: Audio, Subtítulos & Música',
        color: 'text-cyberGreen',
        vars: [
          'audio_idiomas',
          'audio_info_bloque',
          'audio_info_identi',
          'subtitulos_info',
          'subtitulos_identi',
          'artista',
          'album',
          'tracklist',
        ],
      },
      {
        title: 'Assets Fanart.tv, Logos & Capturas',
        color: 'text-cyberMagenta',
        vars: [
          'logo_url',
          'poster_url',
          'banner_url',
          'clearart_url',
          'background_url',
          'trailer_url',
          'capturas_bbcode',
          'espectrograma_bbcode',
        ],
      },
      {
        title: 'Metadatos API & Descargas (Zinfinal / Identi)',
        color: 'text-cyberPurple',
        vars: [
          'sinopsis',
          'tmdb_rating',
          'imdb_rating',
          'enlaces_spoiler',
          'enlaces_identi',
          'enlaces_descarga',
          'password',
          'mediainfo_completo',
        ],
      },
    ];

    const hostPolicy = HOST_IMAGE_POLICIES[config.imgHostProvider] || HOST_IMAGE_POLICIES.imgbb;
    const localRasterAssets = analyzedImages.filter((a) => a.isLocalDataUrl && !a.isSvg);
    const localCaptureAssets = localRasterAssets.filter(
      (a) => a.slotKey === 'capturas_bbcode'
    );
    const replaceTargets =
      localCaptureAssets.length > 0 ? localCaptureAssets : localRasterAssets;
    const totalLocalBytes = localRasterAssets.reduce((acc, a) => acc + (a.sizeBytes || 0), 0);

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setLayersImageDragOver(true);
        }}
        onDragLeave={() => setLayersImageDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setLayersImageDragOver(false);
          if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            setLayersSubTab('quality');
            void handleAddCapturesToAnalyzer(Array.from(e.dataTransfer.files));
          }
        }}
        className={`flex-1 min-h-0 flex flex-col bg-panel overflow-hidden ${
          layersImageDragOver ? 'ring-2 ring-inset ring-cyberCyan bg-cyberCyan/5' : ''
        }`}
      >
        {/* Cabecera del panel Capas / Streams */}
        <div className="px-2.5 py-1.5 bg-elevated/80 border-b border-cyberBorder flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-void border border-cyberBorder">
            <button
              type="button"
              onClick={() => setLayersSubTab('quality')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer whitespace-nowrap tabular-nums transition-colors ${
                layersSubTab === 'quality'
                  ? 'bg-panel text-cyberCyan font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🔍 Calidad Imagen ({analyzedImages.length})
            </button>
            <button
              type="button"
              onClick={() => setLayersSubTab('streams')}
              className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer whitespace-nowrap transition-colors ${
                layersSubTab === 'streams'
                  ? 'bg-panel text-cyberCyan font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📑 Streams / Vars
            </button>
          </div>

          {layersSubTab === 'quality' && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const files = await pickMultipleMediaFiles('image/*,.png,.jpg,.jpeg,.webp');
                  if (files.length > 0) void handleAddCapturesToAnalyzer(files);
                }}
                className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[10px] cursor-pointer whitespace-nowrap"
              >
                + Capturas
              </button>
              {replaceTargets.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleOptimizeAndReplaceCaptures(replaceTargets)}
                  disabled={optimizingImageId !== null}
                  className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {optimizingImageId === 'all'
                    ? '⏳ Optimizando...'
                    : `⚡ Optimizar y Reemplazar (${replaceTargets.length})`}
                </button>
              )}
              {localRasterAssets.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleUploadAnalyzedCaptures(localRasterAssets)}
                  disabled={uploadingAnalyzedCaptures}
                  className="px-2 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {uploadingAnalyzedCaptures
                    ? '⏳ Subiendo...'
                    : `☁ Subir (${localRasterAssets.length})`}
                </button>
              )}
            </div>
          )}
        </div>

        {layersSubTab === 'quality' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5 text-xs">
            {/* Resumen de Host y Ajustes de Optimización */}
            <div className="bg-void/90 border border-cyberBorder rounded-lg p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white">
                    Analizador Pre-Subida · Host: {hostPolicy.label}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    {hostPolicy.note}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-300 tabular-nums shrink-0">
                  {analyzedImages.length} img ·{' '}
                  <strong className="text-white">{formatBytes(totalLocalBytes)}</strong> locales
                </div>
              </div>

              <div className="pt-2 border-t border-cyberBorder/60 flex flex-wrap items-center justify-between gap-2.5 text-[10px] font-mono">
                <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                  <label className="flex items-center gap-1.5 text-slate-300">
                    <span>Resolución:</span>
                    <select
                      value={targetOptimizeWidth}
                      onChange={(e) => setTargetOptimizeWidth(Number(e.target.value))}
                      className="bg-panel text-cyberCyan rounded px-1.5 py-0.5 border border-cyberBorder cursor-pointer"
                    >
                      <option value={0}>Original (Nativa)</option>
                      <option value={2560}>2560 px máx (QHD)</option>
                      <option value={1920}>1920 px máx (Full HD)</option>
                      <option value={1280}>1280 px máx (Ligero)</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-slate-300">
                    <span>Compresión:</span>
                    <input
                      type="range"
                      min={5}
                      max={75}
                      step={5}
                      value={compressionPercent}
                      onChange={(e) =>
                        onUpdateConfig({ captureCompressionPercent: Number(e.target.value) })
                      }
                      className="w-24 accent-cyan-400 cursor-pointer"
                    />
                    <span className="px-1.5 py-0.5 rounded bg-panel border border-cyberBorder text-cyberGreen font-bold tabular-nums whitespace-nowrap">
                      {compressionPercent}% (Calidad {100 - compressionPercent}%)
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onOpenSettings('imghost')}
                    className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-300 font-mono text-[10px] cursor-pointer whitespace-nowrap tabular-nums"
                    title="Abrir Optimizador de Capturas en Configuración"
                  >
                    ⚙ {config.captureCount ?? 6} cap.
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleOptimizeAndReplaceCaptures(replaceTargets)}
                  disabled={optimizingImageId !== null || replaceTargets.length === 0}
                  className="px-2.5 py-1 rounded bg-cyberCyan/20 hover:bg-cyberCyan/30 border border-cyberCyan/60 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-40"
                >
                  {optimizingImageId === 'all'
                    ? '⏳ Optimizando y reemplazando...'
                    : `⚡ Optimizar y Reemplazar (${replaceTargets.length})`}
                </button>
              </div>
            </div>

            {analyzingImages && analyzedImages.length === 0 ? (
              <div className="space-y-2">
                <div className="h-14 rounded-lg bg-void/70 border border-cyberBorder animate-pulse" />
                <div className="h-14 rounded-lg bg-void/50 border border-cyberBorder animate-pulse" />
              </div>
            ) : analyzedImages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cyberBorder bg-void/70 p-5 text-center space-y-2">
                <div className="text-xs font-bold text-slate-200">
                  No hay capturas ni imágenes cargadas en este documento
                </div>
                <p className="text-[11px] text-slate-400">
                  Suelta capturas PNG/JPG/WEBP aquí o genera capturas desde un video para analizar su peso, resolución y sugerencias de optimización antes de subirlas.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const files = await pickMultipleMediaFiles('image/*,.png,.jpg,.jpeg,.webp');
                    if (files.length > 0) void handleAddCapturesToAnalyzer(files);
                  }}
                  className="neon-btn-cyan px-3 py-1 rounded-lg font-extrabold text-[11px] cursor-pointer"
                >
                  📂 Cargar Capturas para Analizar
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {analyzedImages.map((img) => {
                  const statusTone =
                    img.severity === 'critical'
                      ? 'text-red-400'
                      : img.severity === 'warning'
                      ? 'text-amber-300'
                      : 'text-cyberGreen';
                  const isBusy = optimizingImageId === img.id || optimizingImageId === 'all';
                  return (
                    <div
                      key={img.id}
                      className="bg-void/90 border border-cyberBorder rounded-lg p-2 flex items-start gap-2.5"
                    >
                      <img
                        src={img.src}
                        alt={img.label}
                        referrerPolicy="no-referrer"
                        className="w-16 h-12 rounded object-cover border border-cyberBorder bg-panel shrink-0"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-[11px] truncate">
                            {img.label}
                          </span>
                          <span
                            className={`font-mono text-[10px] font-bold shrink-0 ${statusTone}`}
                          >
                            {img.statusLabel}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-slate-300 tabular-nums flex flex-wrap items-center gap-x-2">
                          <span>{img.format}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-cyberCyan font-semibold">
                            {img.width && img.height ? `${img.width}×${img.height}` : 'Dim. N/D'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-white font-semibold">{img.sizeLabel}</span>
                          {img.aspectRatio !== '—' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-slate-400">{img.aspectRatio}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 leading-snug">
                          {img.suggestions[0]}
                        </div>
                        {img.isLocalDataUrl && !img.isSvg && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => handleOptimizeSingleAsset(img)}
                              disabled={isBusy}
                              className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              {isBusy ? '⏳...' : `⚡ Optimizar y Reemplazar (${compressionPercent}%)`}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUploadAnalyzedCaptures([img])}
                              disabled={uploadingAnalyzedCaptures}
                              className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberGreen text-cyberGreen font-mono text-[10px] cursor-pointer whitespace-nowrap disabled:opacity-50"
                            >
                              ☁ Subir
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col p-2.5 gap-2 overflow-y-auto font-mono text-[11px]">
            {/* Selector rápido de Contraseñas Guardadas */}
            <div className="bg-void/90 border border-cyberMagenta/45 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-cyberMagenta">
                  🔑 Contraseña del Post ({'{{password}}'})
                </span>
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(true)}
                  className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/60 text-cyberMagenta text-[10px] font-bold cursor-pointer whitespace-nowrap"
                >
                  ⚙ Guardar / Gestionar ({savedPasswordsList.length})
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={
                    savedPasswordsList.some((p) => p.value === activeDoc.context.password)
                      ? activeDoc.context.password
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setPasswordModalOpen(true);
                      return;
                    }
                    handleApplyPasswordToPost(e.target.value, { ensureVariable: true });
                  }}
                  className="flex-1 min-w-[140px] bg-panel text-white rounded px-2 py-1 border border-cyberBorder text-[11px] cursor-pointer"
                >
                  {savedPasswordsList.map((p) => (
                    <option key={p.id} value={p.value}>
                      {p.label ? `${p.label}: ${p.value}` : p.value}
                    </option>
                  ))}
                  {!savedPasswordsList.some((p) => p.value === activeDoc.context.password) && (
                    <option value="__custom__">
                      Personalizada: {activeDoc.context.password || 'Sin Password'}
                    </option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => insertBbTag('{{password}}', '')}
                  className="px-2 py-1 rounded bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-[10px] text-cyberCyan cursor-pointer"
                  title="Insertar {{password}} en el editor"
                >
                  {'{{password}}'}
                </button>
                <button
                  type="button"
                  onClick={() => insertBbTag('{{PASSWORD}}', '')}
                  className="px-2 py-1 rounded bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberMagenta text-[10px] text-cyberMagenta cursor-pointer"
                  title="Insertar {{PASSWORD}} en mayúsculas"
                >
                  {'{{PASSWORD}}'}
                </button>
              </div>
            </div>

            <div className="text-[10px] text-slate-400">
              Haz clic en cualquier variable para insertarla en el Editor BBCode:
            </div>
            {groups.map((g) => (
              <div key={g.title} className="bg-void/80 border border-cyberBorder rounded-lg p-2">
                <div className={`font-bold ${g.color} mb-1`}>{g.title}</div>
                <div className="flex flex-wrap gap-1">
                  {g.vars.map((v) => (
                    <button
                      key={v}
                      onClick={() => insertBbTag(`{{${v}}}`, '')}
                      className="px-1.5 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-[10px] text-slate-300 hover:text-cyberCyan cursor-pointer"
                    >
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {config.mediaFilesIndex && config.mediaFilesIndex.length > 0 && (
              <div className="bg-void/80 border border-cyberCyan/40 rounded-lg p-2">
                <div className="font-bold text-cyberCyan mb-1">
                  📁 Carpeta Vinculada: {config.mediaFolderLinked} ({config.mediaFilesIndex.length})
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {config.mediaFilesIndex.slice(0, 30).map((mf, i) => (
                    <div key={`${mf.name}-${i}`} className="flex items-center justify-between text-[10px] text-slate-300">
                      <span className="truncate">{mf.name}</span>
                      <span className="text-slate-500 shrink-0 ml-2">{formatBytes(mf.sizeBytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSlot = (slotKey: DockSlotKey, extraStyle?: React.CSSProperties, extraClass = '') => {
    const slot = dockState.slots[slotKey];
    if (!slot || slot.panels.length === 0) return null;
    const activePanelId = slot.active && slot.panels.includes(slot.active) ? slot.active : slot.panels[0];
    const isRightSide = slotKey.startsWith('right');
    const targetOpposite: DockSlotKey = isRightSide ? 'left-bottom' : 'right-bottom';

    const isGroupHighlighted = Boolean(draggingPanel);
    const isGroupHovered = draggingPanel?.matchedGroupSlot === slotKey;

    return (
      <div style={extraStyle} className={`min-h-[120px] min-w-0 flex flex-col overflow-hidden relative ${extraClass}`}>
        <div
          data-group-drop-slot={slotKey}
          className={`dock-tab-bar h-8 bg-elevated/95 border-b border-cyberBorder px-1.5 flex items-center justify-between gap-1 shrink-0 select-none ${
            isGroupHighlighted ? 'tab-bar-drop-highlight' : ''
          } ${isGroupHovered ? 'hovered' : ''}`}
        >
          <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
            {slot.panels.map((pId) => {
              const meta = PANEL_META[pId];
              const isActive = pId === activePanelId;
              return (
                <div
                  key={pId}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => {
                    onUpdateDockState({
                      ...dockState,
                      slots: { ...dockState.slots, [slotKey]: { ...slot, active: pId } },
                    });
                  }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    startPanelTabDrag(e, pId);
                  }}
                  className={`pl-2 pr-1 py-1 rounded text-[11px] font-semibold flex items-center gap-1.5 shrink-0 cursor-grab whitespace-nowrap group ${
                    isActive
                      ? 'bg-void text-cyberCyan border border-cyberCyan/50 shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-void/60 border border-transparent'
                  }`}
                >
                  <span className="text-slate-500 font-mono text-[10px]">≡</span>
                  <span>{meta.icon}</span>
                  <span>{meta.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePanel(pId);
                    }}
                    title={`Eliminar "${meta.title}" (reactivable en Ventana)`}
                    aria-label={`Eliminar panel ${meta.title}`}
                    className="ml-0.5 w-4 h-4 rounded flex items-center justify-center text-[10px] leading-none text-slate-500 hover:text-rose-400 hover:bg-rose-500/15 cursor-pointer transition-colors"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => dockPanelToSlot(activePanelId, targetOpposite)}
              title={`Mover a ${isRightSide ? 'Izquierda' : 'Derecha'}`}
              className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberMagenta text-[10px] font-mono text-slate-300 hover:text-cyberMagenta cursor-pointer"
            >
              {isRightSide ? '◧ Izq' : '◨ Der'}
            </button>
            <button
              type="button"
              onClick={() => undockPanel(activePanelId)}
              title="Desacoplar Panel Flotante"
              className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-[10px] font-mono text-slate-300 hover:text-cyberCyan cursor-pointer"
            >
              ⧉
            </button>
            <button
              type="button"
              onClick={() => handleRemovePanel(activePanelId)}
              title={`Eliminar "${PANEL_META[activePanelId].title}" (reactivable en Ventana)`}
              aria-label={`Eliminar panel activo ${PANEL_META[activePanelId].title}`}
              className="px-1.5 py-0.5 rounded bg-void hover:bg-rose-500/15 border border-cyberBorder hover:border-rose-400/70 text-[10px] font-mono text-slate-400 hover:text-rose-400 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
        {renderPanelContent(activePanelId)}
      </div>
    );
  };

  // =========================================================================
  // COLUMN VISIBILITY FLAGS
  // =========================================================================
  const hasLeftTop = dockState.slots['left-top'].panels.length > 0;
  const hasLeftBottom = dockState.slots['left-bottom'].panels.length > 0;
  const hasLeft = hasLeftTop || hasLeftBottom;
  const hasCenter = dockState.slots['center-main'].panels.length > 0;
  const hasRightTop = dockState.slots['right-top'].panels.length > 0;
  const hasRightBottom = dockState.slots['right-bottom'].panels.length > 0;
  const hasRight = hasRightTop || hasRightBottom;
  const hasBottom = dockState.slots['bottom-main'].panels.length > 0;

  const activeApiObj = apiProviders.find((p) => p.id === activeApiProviderId) || apiProviders[0];
  const connectedApis = useMemo(
    () => getConnectedMetadataProviders(apiProviders, config),
    [apiProviders, config]
  );

  const flyoutItems: Record<ToolKey, Array<{ label: string; hint: string; action: () => void }>> = {
    covers: [
      { label: 'Reemplazar Portada / Poster', hint: '{{poster_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('poster_url'); } },
      { label: 'Reemplazar Logo HD (350px)', hint: '{{logo_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('logo_url'); } },
      { label: 'Reemplazar Banner / Separador', hint: '{{banner_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('banner_url'); } },
      { label: 'Reemplazar ClearArt HD', hint: '{{clearart_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('clearart_url'); } },
      { label: 'Reemplazar Fondo 4K', hint: '{{background_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('background_url'); } },
      { label: 'Reemplazar Miniatura / Preview', hint: '{{thumb_url}}', action: () => { focusPanel('covers'); setSelectedCoverSlot('thumb_url'); } },
      { label: '🎨 Buscar Artworks en Fanart.tv', hint: 'v3.2', action: () => { focusPanel('covers'); void handleFetchFanartForDoc(); } },
    ],
    text: [
      { label: 'Negrita', hint: '[b]...[/b]', action: () => insertBbTag('[b]', '[/b]') },
      { label: 'Itálica', hint: '[i]...[/i]', action: () => insertBbTag('[i]', '[/i]') },
      { label: 'Subrayado', hint: '[u]...[/u]', action: () => insertBbTag('[u]', '[/u]') },
      { label: 'Tamaño Título (20px)', hint: '[size=20]', action: () => insertBbTag('[size=20]', '[/size]') },
      { label: 'Cita / Sinopsis', hint: '[quote]', action: () => insertBbTag('[quote]', '[/quote]') },
      { label: 'Bloque Código / MediaInfo', hint: '[code]', action: () => insertBbTag('[code]', '[/code]') },
    ],
    align: [
      { label: 'Centrar Bloque', hint: '[center]', action: () => insertBbTag('[center]\n', '\n[/center]') },
      { label: 'Lista con Viñetas', hint: '[list][*]', action: () => insertBbTag('[list]\n[*]', '\n[/list]') },
      { label: 'Spoiler Desplegable', hint: '[spoiler=]', action: () => insertBbTag('[spoiler=Ver Información]\n', '\n[/spoiler]') },
    ],
    media: [
      { label: '▶ Buscar Trailer YouTube (Prioridades)', hint: '{{trailer_url}}', action: onOpenYoutubeSearch },
      { label: 'Insertar Imagen [img]', hint: '[img]URL[/img]', action: () => insertBbTag('[img]', '[/img]') },
      { label: 'Insertar Tag [youtube]', hint: '[youtube]', action: () => insertBbTag('[youtube]', '[/youtube]') },
      { label: '📊 Ver Panel MediaInfo Técnico', hint: 'Panel', action: () => focusPanel('mediainfo') },
      { label: 'Escanear Video / Audio Local', hint: 'Archivo', action: () => setIngestModalOpen(true) },
    ],
    links: [
      { label: '🔗 Insertador de Enlaces (Spoiler / Personalizado)', hint: 'Ventana', action: onOpenSpoilerLinks },
      { label: '🔑 Contraseñas Guardadas...', hint: '{{password}}', action: () => setPasswordModalOpen(true) },
      { label: '🌐 Contenedor JDownloader', hint: '[jd]...[/jd]', action: () => insertBbTag('[jd]\n', '\n[/jd]') },
      { label: 'Enlace Hipervínculo', hint: '[url=]', action: () => insertBbTag('[url=https://]', '[/url]') },
    ],
    vars: [
      ...apiProviders.slice(0, 4).map((p) => ({
        label: p.name,
        hint: p.category,
        action: () => onSelectApiProvider(p.id),
      })),
      { label: '🔑 Contraseñas Guardadas...', hint: '{{password}}', action: () => setPasswordModalOpen(true) },
      { label: 'Ver Capas / Streams', hint: 'Panel', action: () => focusPanel('layers') },
      { label: '📊 Ver MediaInfo Técnico', hint: 'Panel', action: () => focusPanel('mediainfo') },
      { label: 'Conectar / Probar API...', hint: 'HTTP', action: onOpenConnectApi },
    ],
    templates: templates.map((t) => ({
      label: t.name,
      hint: t.site === 'zinfinal' ? 'Zinfinal' : t.site === 'identi' ? 'Identi' : 'Custom',
      action: () =>
        onUpdateActiveDoc((doc) => ({
          ...doc,
          templateId: t.id,
          customTitle: null,
          customBody: null,
        })),
    })),
    ingest: [
      { label: '📂 Escanear medios (Archivo o Drop)...', hint: 'Asistente', action: () => setIngestModalOpen(true) },
      { label: '📊 Ver Panel MediaInfo Técnico', hint: 'Panel', action: () => focusPanel('mediainfo') },
      { label: '📁 Configurar Carpetas de Medios', hint: 'Rutas', action: () => onOpenSettings('paths') },
    ],
    artgallery: [
      { label: '🎨 Abrir Selección Visual de Arte', hint: 'TMDB/OMDb/Fanart', action: () => setArtSidebarOpen(true) },
      { label: '🔄 Buscar en Todos (TMDB + OMDb + Fanart)', hint: 'Cascada', action: () => { setArtSidebarOpen(true); setArtSourceFilter('all'); void handleFetchAllVisualArt(); } },
      { label: '🎬 Portadas, Logos y Fondos TMDB', hint: 'TMDB', action: () => { setArtSidebarOpen(true); setArtSourceFilter('tmdb'); void handleFetchTmdbVisualArt(); } },
      { label: '🎞️ Portadas y Covers OMDb / IMDb', hint: 'OMDb', action: () => { setArtSidebarOpen(true); setArtSourceFilter('omdb'); void handleFetchOmdbVisualArt(); } },
      { label: '🎯 Banners Fanart.tv', hint: 'banner_url', action: () => { setArtSidebarOpen(true); setArtSourceFilter('fanart'); setArtSidebarFilter('banner'); void handleFetchFanartBySlot('banner_url'); } },
      { label: '🎯 ClearArts Fanart.tv', hint: 'clearart_url', action: () => { setArtSidebarOpen(true); setArtSourceFilter('fanart'); setArtSidebarFilter('clearart'); void handleFetchFanartBySlot('clearart_url'); } },
      { label: '🎯 Logos Fanart.tv', hint: 'logo_url', action: () => { setArtSidebarOpen(true); setArtSourceFilter('fanart'); setArtSidebarFilter('logo'); void handleFetchFanartBySlot('logo_url'); } },
    ],
  };

  const savedTimeLabel = new Date(lastSavedAt).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  shortcutActionsRef.current = {
    insertBbTag,
    copyCompiledBbCode,
    runApiSearch: handleRunApiSearch,
    createNewPost: () => {
      onCreateDocument();
      setIngestModalOpen(true);
    },
    openIngest: () => setIngestModalOpen(true),
    toggleLock: onToggleLock,
    selectTool: (tool: ToolKey) => {
      setActiveTool(tool);
      if (tool === 'artgallery') setArtSidebarOpen(true);
    },
    isModalBlocking:
      ingestModalOpen ||
      shortcutsModalOpen ||
      identifyModalOpen ||
      passwordModalOpen ||
      Boolean(watermarkPrompt?.open),
    cancelWatermarkPrompt: () => {
      if (watermarkPrompt?.open) {
        const resolveFn = watermarkPrompt.resolve;
        setWatermarkPrompt(null);
        resolveFn({ action: 'cancel' });
      }
    },
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col w-full h-full overflow-hidden select-none"
      onPointerOver={(e) => {
        const target = (e.target as HTMLElement).closest('[data-tooltip-title]') as HTMLElement | null;
        if (!target) {
          setTooltip(null);
          return;
        }
        setTooltip({
          title: target.getAttribute('data-tooltip-title') || '',
          desc: target.getAttribute('data-tooltip-desc') || '',
          x: e.clientX,
          y: e.clientY,
        });
      }}
      onPointerMove={(e) => {
        if (tooltip) setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
      }}
      onPointerOut={() => setTooltip(null)}
    >
      {/* HUD TOOLTIP */}
      {tooltip && (
        <div
          style={{
            left: Math.min(window.innerWidth - 280, Math.max(8, tooltip.x + 14)),
            top: Math.min(window.innerHeight - 90, Math.max(8, tooltip.y + 16)),
          }}
          className="fixed z-[90] pointer-events-none max-w-xs bg-panel/95 border border-cyberCyan/70 rounded-lg px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.85)] backdrop-blur-md"
        >
          <div className="text-[11px] font-mono font-bold text-cyberCyan uppercase tracking-wide">
            {tooltip.title}
          </div>
          {tooltip.desc && <div className="text-[11px] text-slate-300 mt-0.5 leading-snug">{tooltip.desc}</div>}
        </div>
      )}

      {/* DRAG GHOST */}
      {draggingPanel && (
        <div
          style={{ left: draggingPanel.x + 14, top: draggingPanel.y + 14 }}
          className="fixed z-[95] pointer-events-none bg-elevated/95 border-2 border-cyberCyan rounded-lg px-3 py-1.5 shadow-[0_14px_34px_rgba(0,240,255,0.4)] flex items-center gap-2"
        >
          <span className="text-cyberCyan font-mono text-xs">⧉</span>
          <div>
            <div className="text-xs font-bold text-white">{PANEL_META[draggingPanel.id].title}</div>
            <div className="text-[10px] font-mono text-cyberCyan">
              {draggingPanel.matchedGroupSlot
                ? `Unir como Pestaña en ${SLOT_NAMES[draggingPanel.matchedGroupSlot]}`
                : draggingPanel.matchedZone
                ? `Acoplar en ${SLOT_NAMES[draggingPanel.matchedZone]}`
                : 'Soltar fuera como Panel Flotante'}
            </div>
          </div>
        </div>
      )}

      {/* 1. BARRA DE MENÚ SUPERIOR */}
      <header
        data-top-menu-root
        className="min-h-9 bg-elevated border-b border-cyberBorder px-2 py-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 shrink-0 z-30"
      >
        <div className="flex items-center gap-1 min-w-0 flex-wrap">
          <button
            onClick={() => onSelectScreen('welcome')}
            data-tooltip-title={`${APP_INFO.fullName} v${APP_INFO.version}`}
            data-tooltip-desc={`Creado por ${APP_INFO.creator}. Volver a la pantalla de bienvenida o asistente inicial.`}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-void border border-cyberCyan/50 text-cyberCyan font-mono font-extrabold text-xs shrink-0 cursor-pointer whitespace-nowrap"
          >
            <PostProLogo size={17} />
            <span>{APP_INFO.name}</span>
          </button>

          <nav className="flex items-center gap-0.5 text-xs flex-wrap">
            {(
              [
                ['archivo', 'Archivo', 'text-slate-200'],
                ['edicion', 'Edición', 'text-slate-200'],
                ['plantillas', 'Plantillas', 'text-slate-200'],
                ['herramientas', 'Herramientas', 'text-slate-200'],
                ['apis', 'APIs', 'text-cyberCyan font-semibold'],
                ['plugins', 'Plugins', 'text-cyberMagenta font-semibold'],
                ['ventana', 'Ventana', 'text-slate-200'],
                ['ayuda', 'Ayuda', 'text-slate-200'],
              ] as const
            ).map(([k, label, cls]) => (
              <button
                key={k}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setOpenTopMenu(openTopMenu?.key === k ? null : { key: k, left: r.left, top: r.bottom + 2 });
                }}
                className={`px-1.5 py-0.5 rounded hover:bg-void hover:text-cyberCyan cursor-pointer whitespace-nowrap shrink-0 ${cls}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1 flex-wrap ml-auto shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={undoCount === 0}
            data-tooltip-title="Deshacer último cambio (Ctrl+Z)"
            data-tooltip-desc={
              undoCount > 0 && lastUndoLabel
                ? `Deshacer "${lastUndoLabel}" · Historial disponible: ${undoCount}/${undoLimit} pasos.`
                : `Sin cambios pendientes por deshacer (límite configurado: ${undoLimit} pasos).`
            }
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-[11px] font-mono font-bold text-slate-200 hover:text-cyberCyan cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>↩</span>
            <span className="hidden 2xl:inline">Deshacer</span>
            <span className="text-[10px] text-cyberCyan tabular-nums">
              {undoCount}/{undoLimit}
            </span>
          </button>

          <button
            onClick={onOpenYoutubeSearch}
            data-tooltip-title="Buscador de Trailers YouTube"
            data-tooltip-desc="Busca el trailer oficial por nombre y año según tus prioridades (Latino / Subtitulado / Original) e insértalo en {{trailer_url}}."
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-void hover:bg-panel border border-red-500/60 hover:border-red-400 text-[11px] font-bold text-red-400 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>▶</span>
            <span className="hidden xl:inline">YT</span>
            <span className="hidden 2xl:inline">YouTube</span>
          </button>

          <button
            onClick={onOpenConnectApi}
            data-tooltip-title="Conectar y Probar API"
            data-tooltip-desc="Prueba endpoints REST/GraphQL, extrae JSONPath y conecta proveedores de metadatos."
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-void hover:bg-panel border border-cyberCyan/50 hover:border-cyberCyan text-[11px] font-bold text-cyberCyan cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>🔌</span>
            <span className="hidden sm:inline">API</span>
          </button>

          <button
            onClick={() => onOpenPlugins('installed')}
            data-tooltip-title="Gestor de Plugins & Temas"
            data-tooltip-desc="Administra extensiones funcionales, temas visuales e importa plugins."
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-void hover:bg-panel border border-cyberMagenta/50 hover:border-cyberMagenta text-[11px] font-bold text-cyberMagenta cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>🧩</span>
            <span className="hidden 2xl:inline">Plugins</span>
          </button>

          <button
            onClick={() => onOpenSettings('paths')}
            data-tooltip-title="Configuración del Estudio"
            data-tooltip-desc="Ajusta rutas locales, API Keys, host de imágenes, historial Ctrl+Z y copias."
            className="flex items-center gap-1 px-1.5 py-1 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-[11px] font-semibold text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>⚙</span>
            <span className="hidden 2xl:inline">Config</span>
          </button>

          <button
            onClick={onToggleLock}
            data-tooltip-title="Candado de Mesa de Trabajo"
            data-tooltip-desc="Bloquea o desbloquea el movimiento de paneles acoplables y divisores."
            className={`flex items-center gap-1 px-1.5 py-1 rounded bg-void border text-[11px] font-mono font-bold cursor-pointer whitespace-nowrap shrink-0 ${
              isWorkspaceLocked
                ? 'border-cyberBorder text-slate-300'
                : 'border-cyberCyan text-cyberCyan'
            }`}
          >
            <span>{isWorkspaceLocked ? '🔒' : '🔓'}</span>
            <span className="hidden 2xl:inline">{isWorkspaceLocked ? 'Bloqueado' : 'Desbloqueado'}</span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <select
              value={activeWorkspacePreset}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'save_custom') {
                  onSaveCustomWorkspace();
                } else if (v === 'essentials' || v === 'floating' || v === 'codefocus' || v === 'custom') {
                  onApplyWorkspacePreset(v);
                }
              }}
              data-tooltip-title="Espacio de Trabajo Activo"
              data-tooltip-desc="Cambia entre distribuciones predefinidas o carga tu espacio de trabajo guardado."
              className="bg-void text-slate-200 font-mono text-[11px] rounded px-1.5 py-1 border border-cyberBorder hover:border-cyberCyan cursor-pointer max-w-[138px]"
            >
              <option value="essentials">WS: Esenciales</option>
              <option value="floating">WS: Flotante</option>
              <option value="codefocus">WS: Código + Visor</option>
              {hasCustomSavedWorkspace && <option value="custom">⭐ Mi Espacio</option>}
              <option value="save_custom">+ Guardar Actual...</option>
            </select>
            <button
              type="button"
              onClick={onSaveCustomWorkspace}
              data-tooltip-title="Guardar Espacio de Trabajo"
              data-tooltip-desc="Guarda la distribución actual de paneles visibles, ocultos, flotantes y divisores."
              className={`px-1.5 py-1 rounded bg-void hover:bg-panel border text-[11px] font-mono font-bold cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 ${
                hasCustomSavedWorkspace
                  ? 'border-cyberGreen/60 text-cyberGreen hover:border-cyberGreen'
                  : 'border-cyberBorder hover:border-cyberCyan text-slate-200 hover:text-cyberCyan'
              }`}
            >
              <span>💾</span>
              <span className="hidden 2xl:inline">Guardar WS</span>
            </button>
          </div>

          <button
            type="button"
            onClick={copyCompiledTitle}
            data-tooltip-title="Copiar Título del Post"
            data-tooltip-desc="Copia únicamente el título compilado para pegarlo en el campo Título de tu sitio."
            className="px-2 py-1 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-cyberCyan font-bold text-[11px] cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <span>🏷️</span>
            <span className="hidden xl:inline">Copiar Título</span>
          </button>

          <button
            onClick={copyCompiledBbCode}
            data-tooltip-title="Copiar BBCode Compilado"
            data-tooltip-desc="Copia únicamente el código BBCode final del post (sin título ni separadores)."
            className="neon-btn-cyan px-2 py-1 rounded font-extrabold text-[11px] cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <span>📋</span>
            <span className="hidden sm:inline">Copiar BBCode</span>
          </button>
        </div>
      </header>

      {/* DROPDOWN TOP MENU */}
      {openTopMenu && (
        <div
          data-top-menu-root
          style={{
            left: Math.max(8, Math.min(window.innerWidth - (openTopMenu.key === 'ventana' ? 305 : 250), openTopMenu.left)),
            top: openTopMenu.top,
          }}
          className={`fixed z-50 bg-panel/98 border border-cyberCyan/60 rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.92)] py-1.5 text-xs backdrop-blur-md ${
            openTopMenu.key === 'ventana' ? 'min-w-[295px] max-h-[82vh] overflow-y-auto' : 'min-w-[240px]'
          }`}
        >
          {openTopMenu.key === 'archivo' && (
            <>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onCreateDocument();
                  setIngestModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>📄 Nuevo Post BBCode</span>
                <span className="text-[10px] font-mono text-slate-400">Ctrl+N</span>
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onSaveNow();
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberGreen hover:text-white flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>💾 Guardar Estado</span>
                <span className="text-[10px] font-mono text-slate-400">Ctrl+S</span>
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  setIngestModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberCyan cursor-pointer"
              >
                📂 Escanear medios...
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  setMediainfoShowRecents(true);
                  focusPanel('mediainfo');
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>🕒 Proyectos Recientes</span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  {recentProjects.length}
                </span>
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onOpenSettings('backups');
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan flex items-center justify-between gap-2 cursor-pointer"
              >
                <span>💾 Backups Incrementales ({config.autoBackupIntervalMinutes || 10}m)</span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  {backupCount}
                </span>
              </button>
              <div className="my-1 border-t border-cyberBorder" />
              <button onClick={() => { setOpenTopMenu(null); onSelectScreen('welcome'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🏠 Pantalla de Bienvenida</button>
              <button onClick={() => { setOpenTopMenu(null); onSelectScreen('setup'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🛠 Asistente Configuración Inicial</button>
            </>
          )}
          {openTopMenu.key === 'edicion' && (
            <>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onUndo();
                }}
                disabled={undoCount === 0}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan flex items-center justify-between gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>
                  ↩ Deshacer {lastUndoLabel ? `(${lastUndoLabel})` : ''}
                </span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  Ctrl+Z · {undoCount}/{undoLimit}
                </span>
              </button>
              <div className="my-1 border-t border-cyberBorder" />
              <button onClick={() => { setOpenTopMenu(null); onOpenSettings('minimenu'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">✎ Editar Mini Menú Flotante</button>
              <button onClick={() => { setOpenTopMenu(null); copyCompiledTitle(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🏷️ Copiar Título del Post</button>
              <button onClick={() => { setOpenTopMenu(null); copyCompiledBbCode(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">📋 Copiar BBCode Compilado</button>
            </>
          )}
          {openTopMenu.key === 'plantillas' && (
            <>
              <div className="px-2 py-1.5 mb-1.5 border-b border-cyberBorder flex flex-col gap-1">
                <button
                  onClick={() => {
                    setOpenTopMenu(null);
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.post,.Post,application/json';
                    input.onchange = async (e: any) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const text = await f.text();
                        onImportPostTemplate?.(text);
                      } catch (err: any) {
                        onToast(`Error al leer archivo .Post: ${err?.message}`, 'error');
                      }
                    };
                    input.click();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-void text-cyberCyan font-bold flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span>➕ Importar Plantilla (.Post)</span>
                  <span className="text-[9px] font-mono text-slate-400">Seguro</span>
                </button>
                <button
                  onClick={() => {
                    setOpenTopMenu(null);
                    setTemplateExportModalOpen(true);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-void text-cyberGreen font-semibold flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span>📥 Exportar Actual (.Post)</span>
                  <span className="text-[9px] font-mono text-slate-400">Autoría</span>
                </button>
              </div>
              {(
                [
                  { key: 'zinfinal', label: 'SITIO: ZINFINAL', cls: 'text-cyberCyan' },
                  { key: 'identi', label: 'SITIO: IDENTI', cls: 'text-cyberGreen' },
                  { key: 'custom', label: 'PERSONALIZADAS', cls: 'text-cyberPurple' },
                ] as const
              ).map((grp) => {
                const items = templates.filter(
                  (t) => (t.site || 'custom') === grp.key
                );
                if (items.length === 0) return null;
                return (
                  <div key={grp.key} className="mb-1 last:mb-0">
                    <div className={`px-3.5 py-1 text-[9px] font-mono font-bold uppercase ${grp.cls}`}>
                      {grp.label}
                    </div>
                    {items.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setOpenTopMenu(null);
                          onUpdateActiveDoc((doc) => ({
                            ...doc,
                            templateId: t.id,
                            customTitle: null,
                            customBody: null,
                          }));
                        }}
                        className={`w-full text-left px-3.5 py-1.5 hover:bg-elevated flex items-center justify-between gap-2 cursor-pointer ${
                          t.id === activeDoc.templateId
                            ? 'text-cyberCyan font-bold bg-void/60'
                            : 'text-slate-200 hover:text-cyberCyan'
                        }`}
                      >
                        <span className="truncate">📑 {t.name}</span>
                        {t.id === activeDoc.templateId && (
                          <span className="text-[10px] font-mono text-cyberGreen shrink-0">✔</span>
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </>
          )}
          {openTopMenu.key === 'herramientas' && (
            <>
              <button onClick={() => { setOpenTopMenu(null); onOpenYoutubeSearch(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-red-400 font-bold cursor-pointer">▶ Buscador de Trailer YouTube</button>
              <button onClick={() => { setOpenTopMenu(null); setPasswordModalOpen(true); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberMagenta font-bold cursor-pointer">🔑 Contraseñas Guardadas...</button>
              <button onClick={() => { setOpenTopMenu(null); focusPanel('mediainfo'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberCyan font-semibold cursor-pointer">📊 Panel MediaInfo Técnico</button>
              <button onClick={() => { setOpenTopMenu(null); onOpenSpoilerLinks(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🔗 Insertador de Enlaces</button>
              <button onClick={() => { setOpenTopMenu(null); focusPanel('covers'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🖼️ Gestor de Covers & Assets</button>
              <button onClick={() => { setOpenTopMenu(null); setLayersSubTab('quality'); focusPanel('layers'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🔍 Analizador Calidad Imagen (Capas)</button>
              <button onClick={() => { setOpenTopMenu(null); onOpenConnectApi(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">🔌 Conectar Nueva API...</button>
              <button onClick={() => { setOpenTopMenu(null); onOpenSettings('paths'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer">⚙ Configuración General</button>
            </>
          )}
          {openTopMenu.key === 'apis' && (
            <>
              <button onClick={() => { setOpenTopMenu(null); onOpenConnectApi(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberCyan font-bold cursor-pointer">🔌 + Conectar / Probar Nueva API...</button>
              <button onClick={() => { setOpenTopMenu(null); handleRunApiSearch(); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberGreen font-bold cursor-pointer">⚡ Consultar API Activa Ahora</button>
              <div className="my-1 border-t border-cyberBorder" />
              {apiProviders.map((p) => {
                const isConnected = isApiProviderConnected(p, config);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setOpenTopMenu(null);
                      onSelectApiProvider(p.id);
                    }}
                    className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate">
                      {p.id === activeApiProviderId ? '✔' : '○'} {p.name} [{p.category}]
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                        isConnected
                          ? 'bg-cyberGreen/15 text-cyberGreen border border-cyberGreen/40'
                          : 'bg-void text-slate-500 border border-cyberBorder'
                      }`}
                    >
                      {isConnected ? 'Conectada' : p.requiresKey ? 'Sin Key' : 'Inactiva'}
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {openTopMenu.key === 'plugins' && (
            <>
              <button onClick={() => { setOpenTopMenu(null); onOpenPlugins('installed'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberMagenta cursor-pointer">🧩 Gestor de Plugins & Temas</button>
              <button onClick={() => { setOpenTopMenu(null); onOpenPlugins('import'); }} className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberMagenta cursor-pointer">➕ Importar Plugin (.psplugin / .json)</button>
            </>
          )}
          {openTopMenu.key === 'ventana' && (
            <>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onToggleLock();
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer flex items-center justify-between gap-2"
              >
                <span>{isWorkspaceLocked ? '🔓 Desbloquear Mesa de Trabajo' : '🔒 Bloquear Mesa de Trabajo'}</span>
                <span className="text-[10px] font-mono text-slate-400">
                  {isWorkspaceLocked ? 'Bloqueado' : 'Libre'}
                </span>
              </button>

              <div className="my-1.5 border-t border-cyberBorder/70" />
              <div className="px-3.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Paneles (Activar / Eliminar)</span>
                <span className="text-cyberCyan">
                  {ALL_PANEL_IDS.filter((id) => getPanelLocation(id).kind !== 'hidden').length}/{ALL_PANEL_IDS.length}
                </span>
              </div>

              {ALL_PANEL_IDS.map((panelId) => {
                const meta = PANEL_META[panelId];
                const loc = getPanelLocation(panelId);
                const isVisible = loc.kind !== 'hidden';
                return (
                  <button
                    key={panelId}
                    onClick={() => handleTogglePanelVisibility(panelId)}
                    className="w-full text-left px-3.5 py-1.5 hover:bg-elevated flex items-center justify-between gap-2 cursor-pointer group"
                  >
                    <span className={`flex items-center gap-2 ${isVisible ? 'text-slate-100' : 'text-slate-400'}`}>
                      <span
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] font-bold ${
                          isVisible
                            ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan'
                            : 'bg-void border-slate-600 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span>{meta.icon}</span>
                      <span>{meta.title}</span>
                    </span>
                    <span
                      className={`text-[10px] font-mono ${
                        loc.kind === 'floating'
                          ? 'text-cyberMagenta'
                          : isVisible
                          ? 'text-cyberGreen'
                          : 'text-amber-300/90 group-hover:text-cyberCyan'
                      }`}
                    >
                      {loc.kind === 'floating' ? 'Flotante' : isVisible ? 'Activo' : '+ Activar'}
                    </span>
                  </button>
                );
              })}

              {ALL_PANEL_IDS.some((id) => getPanelLocation(id).kind === 'hidden') && (
                <button
                  onClick={() => {
                    setOpenTopMenu(null);
                    handleRestoreAllPanels();
                  }}
                  className="w-full text-left px-3.5 py-1.5 mt-0.5 hover:bg-elevated text-amber-300 hover:text-amber-200 font-semibold cursor-pointer flex items-center justify-between gap-2"
                >
                  <span>↺ Restaurar todos los paneles</span>
                  <span className="text-[10px] font-mono">
                    +{ALL_PANEL_IDS.filter((id) => getPanelLocation(id).kind === 'hidden').length}
                  </span>
                </button>
              )}

              <div className="my-1.5 border-t border-cyberBorder/70" />
              <div className="px-3.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Espacio de Trabajo
              </div>

              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onSaveCustomWorkspace();
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberGreen hover:text-white font-bold cursor-pointer flex items-center justify-between gap-2"
              >
                <span>
                  💾 {hasCustomSavedWorkspace ? 'Actualizar Espacio Guardado' : 'Guardar Espacio de Trabajo Actual'}
                </span>
                {customWorkspaceSavedAt && (
                  <span className="text-[9px] font-mono text-slate-400 font-normal">
                    {new Date(customWorkspaceSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </button>

              {hasCustomSavedWorkspace && (
                <div className="flex items-center hover:bg-elevated pr-2">
                  <button
                    onClick={() => {
                      setOpenTopMenu(null);
                      onApplyWorkspacePreset('custom');
                    }}
                    className={`flex-1 text-left pl-3.5 pr-2 py-1.5 cursor-pointer flex items-center justify-between gap-2 ${
                      activeWorkspacePreset === 'custom'
                        ? 'text-cyberCyan font-bold'
                        : 'text-slate-200 hover:text-cyberCyan'
                    }`}
                  >
                    <span>⭐ Cargar Mi Espacio Guardado</span>
                    {activeWorkspacePreset === 'custom' && (
                      <span className="text-[10px] font-mono text-cyberCyan">✓</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenTopMenu(null);
                      onClearCustomWorkspace();
                    }}
                    title="Eliminar espacio guardado"
                    className="px-1.5 py-1 rounded text-[10px] text-slate-500 hover:text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                  >
                    🗑
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onApplyWorkspacePreset('essentials');
                }}
                className={`w-full text-left px-3.5 py-1.5 hover:bg-elevated cursor-pointer flex items-center justify-between gap-2 ${
                  activeWorkspacePreset === 'essentials'
                    ? 'text-cyberCyan font-bold'
                    : 'text-slate-200 hover:text-cyberCyan'
                }`}
              >
                <span>🖥 Espacio: PostPro Esenciales</span>
                {activeWorkspacePreset === 'essentials' && <span className="text-[10px] font-mono">✓</span>}
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onApplyWorkspacePreset('floating');
                }}
                className={`w-full text-left px-3.5 py-1.5 hover:bg-elevated cursor-pointer flex items-center justify-between gap-2 ${
                  activeWorkspacePreset === 'floating'
                    ? 'text-cyberCyan font-bold'
                    : 'text-slate-200 hover:text-cyberCyan'
                }`}
              >
                <span>🪟 Espacio: Estudio Flotante</span>
                {activeWorkspacePreset === 'floating' && <span className="text-[10px] font-mono">✓</span>}
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onApplyWorkspacePreset('codefocus');
                }}
                className={`w-full text-left px-3.5 py-1.5 hover:bg-elevated cursor-pointer flex items-center justify-between gap-2 ${
                  activeWorkspacePreset === 'codefocus'
                    ? 'text-cyberCyan font-bold'
                    : 'text-slate-200 hover:text-cyberCyan'
                }`}
              >
                <span>📐 Espacio: Código + Visor</span>
                {activeWorkspacePreset === 'codefocus' && <span className="text-[10px] font-mono">✓</span>}
              </button>
            </>
          )}
          {openTopMenu.key === 'ayuda' && (
            <>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  setShortcutsModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-cyberCyan hover:text-white cursor-pointer flex items-center justify-between gap-2"
              >
                <span>⌨ Guía de Atajos de Teclado</span>
                <span className="text-[10px] font-mono text-slate-400">Ctrl+/</span>
              </button>
              <button
                onClick={() => {
                  setOpenTopMenu(null);
                  onOpenAbout();
                }}
                className="w-full text-left px-3.5 py-1.5 hover:bg-elevated text-slate-200 hover:text-cyberCyan cursor-pointer"
              >
                ℹ Acerca de {APP_INFO.name} v{APP_INFO.version} ({APP_INFO.creator})
              </button>
            </>
          )}
        </div>
      )}

      {/* 2. BARRA CONTEXTUAL "OPCIONES DE HERRAMIENTAS" */}
      <div className="h-9 bg-panel border-b border-cyberBorder px-3 flex items-center justify-between gap-2 overflow-x-auto shrink-0 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-cyberCyan font-mono text-[10px] font-bold shrink-0">
            {TOOL_NAMES[activeTool]}
          </span>
          <span className="text-cyberBorder">|</span>

          {activeTool === 'covers' && (
            <div className="flex items-center gap-1.5 text-xs">
              <select
                value={selectedCoverSlot}
                onChange={(e) => setSelectedCoverSlot(e.target.value)}
                className="bg-void text-white text-[11px] rounded px-2 py-1 border border-cyberBorder cursor-pointer"
              >
                <option value="poster_url">Portada / Poster</option>
                <option value="logo_url">Logo HD (350px)</option>
                <option value="banner_url">Banner / Separador</option>
                <option value="clearart_url">ClearArt HD</option>
                <option value="background_url">Fondo 4K</option>
                <option value="thumb_url">Miniatura</option>
                <option value="separator_url">Separador</option>
              </select>
              <button
                onClick={() => focusPanel('covers')}
                className="px-2.5 py-1 rounded bg-elevated hover:bg-void border border-cyberBorder hover:border-cyberCyan text-[11px] text-cyberCyan font-semibold cursor-pointer whitespace-nowrap"
              >
                🖼️ Abrir Gestor Covers
              </button>
              <button
                type="button"
                onClick={() => setArtSidebarOpen((v) => !v)}
                className="px-2.5 py-1 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-[11px] text-cyberGreen font-bold cursor-pointer whitespace-nowrap"
              >
                🎨 Selección Visual de Arte ({visualArtItems.length})
              </button>
            </div>
          )}

          {activeTool === 'text' && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[b]', '[/b]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder font-bold text-xs cursor-pointer">B</button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[i]', '[/i]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder italic text-xs cursor-pointer">I</button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[u]', '[/u]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder underline text-xs cursor-pointer">U</button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[size=20]', '[/size]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder font-mono text-[11px] cursor-pointer">Size 20</button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[quote]', '[/quote]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder text-[11px] cursor-pointer">❞ Cita</button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => insertBbTag('[code]', '[/code]')} className="px-2.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder font-mono text-[11px] text-cyberGreen cursor-pointer">[code]</button>
              <span className="text-cyberBorder">|</span>
              <div className="flex items-center gap-1 bg-void/80 border border-cyberBorder rounded px-1.5 py-0.5 shrink-0">
                <span className="text-[10px] font-mono text-slate-400">Color:</span>
                {['#00f0ff', '#3366ff', '#80ffea', '#00ff9d', '#ff0055', '#f59e0b', '#ffffff'].map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFgColor(hex);
                      applyBbColorToSelection(hex, { restoreFocus: true });
                    }}
                    title={`Aplicar o reemplazar color ${hex}`}
                    style={{ backgroundColor: hex }}
                    className={`w-3.5 h-3.5 rounded-sm border cursor-pointer transition-transform hover:scale-110 ${
                      fgColor.toLowerCase() === hex.toLowerCase()
                        ? 'border-white ring-1 ring-cyberCyan'
                        : 'border-white/40'
                    }`}
                  />
                ))}
                <input
                  type="color"
                  value={fgColor}
                  onMouseDown={() => syncEditorSelection()}
                  onChange={(e) => {
                    setFgColor(e.target.value);
                    applyBbColorToSelection(e.target.value, { restoreFocus: false });
                  }}
                  title="Selector libre de color BBCode (reemplaza color existente)"
                  className="w-5 h-4 rounded border border-cyberBorder bg-transparent p-0 cursor-pointer"
                />
              </div>
            </div>
          )}

          {activeTool === 'align' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button onClick={() => insertBbTag('[center]\n', '\n[/center]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan cursor-pointer">≡ Centrar</button>
              <button onClick={() => insertBbTag('[list]\n[*]', '\n[/list]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan cursor-pointer">• Lista</button>
              <button onClick={() => insertBbTag('[spoiler=Info]\n', '\n[/spoiler]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan cursor-pointer">👁 Spoiler</button>
            </div>
          )}

          {activeTool === 'media' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button onClick={onOpenYoutubeSearch} className="px-2.5 py-0.5 rounded bg-red-600/20 hover:bg-red-600/35 border border-red-500/70 text-red-300 font-extrabold cursor-pointer whitespace-nowrap">▶ Buscar Trailer YouTube</button>
              <button onClick={() => insertBbTag('[img]', '[/img]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan cursor-pointer">🖼 [img]</button>
              <button onClick={() => insertBbTag('[youtube]', '[/youtube]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-red-400 text-slate-200 cursor-pointer">[youtube]</button>
              <button onClick={() => setIngestModalOpen(true)} className="px-2.5 py-0.5 rounded bg-cyberCyan/15 border border-cyberCyan/50 text-cyberCyan font-bold cursor-pointer">📂 Escanear medios</button>
            </div>
          )}

          {activeTool === 'links' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button onClick={onOpenSpoilerLinks} className="neon-btn-cyan px-3 py-0.5 rounded font-extrabold cursor-pointer whitespace-nowrap">
                🔗 Insertador de Enlaces (Link Personalizado)
              </button>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(true)}
                className="px-2.5 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/60 text-cyberMagenta font-mono font-bold cursor-pointer whitespace-nowrap"
              >
                🔑 Contraseñas
              </button>
              <button onClick={() => insertBbTag('[jd]\n', '\n[/jd]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberCyan/50 text-cyberCyan font-mono cursor-pointer">🌐 [jd]...[/jd]</button>
              <button onClick={() => insertBbTag('[url=https://]', '[/url]')} className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder cursor-pointer">[url=]</button>
            </div>
          )}

          {activeTool === 'vars' && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <select
                value={activeApiProviderId}
                onChange={(e) => onSelectApiProvider(e.target.value)}
                className="bg-void text-cyberGreen font-mono text-[11px] rounded px-2 py-0.5 border border-cyberGreen/50 shrink-0 cursor-pointer"
              >
                {apiProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    API: {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={apiSearchQuery}
                onChange={(e) => setApiSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRunApiSearch();
                }}
                placeholder="Buscar título en API..."
                className="bg-void text-white font-mono text-[11px] rounded px-2 py-0.5 border border-cyberBorder w-36 focus:outline-none focus:border-cyberCyan"
              />
              <button
                onClick={handleRunApiSearch}
                disabled={runningApi}
                className="px-2.5 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/60 text-cyberGreen font-mono text-[10px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
              >
                {runningApi ? '⏳...' : '⚡ Consultar API'}
              </button>
              <button
                type="button"
                onClick={() => setIdentifyModalOpen(true)}
                className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
                title="Ingresar ID de proveedor (TMDB, IMDb, TVDB, MBID, AniList, TVMaze)"
              >
                🎯 Identificar
              </button>
              <button
                type="button"
                onClick={() => handleRefreshMetadata()}
                disabled={refreshingMetadata}
                className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold shrink-0 cursor-pointer whitespace-nowrap disabled:opacity-50"
                title="Re-buscar sinopsis, título y artes desde todos los proveedores"
              >
                {refreshingMetadata ? '⏳...' : '🔄 Refresh'}
              </button>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(true)}
                className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
                title="Elegir, guardar o insertar contraseñas debajo de Password / Contraseña"
              >
                🔑 Contraseñas
              </button>
              <button
                onClick={onOpenConnectApi}
                className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold shrink-0 cursor-pointer"
              >
                + API
              </button>
            </div>
          )}

          {activeTool === 'templates' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <div className="flex items-center bg-void rounded border border-cyberBorder p-0.5 shrink-0">
                {(
                  [
                    ['all', 'Todas'],
                    ['zinfinal', 'Zinfinal'],
                    ['identi', 'Identi'],
                  ] as const
                ).map(([siteKey, siteLabel]) => (
                  <button
                    key={siteKey}
                    type="button"
                    onClick={() => setTemplateSiteFilter(siteKey)}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] cursor-pointer whitespace-nowrap ${
                      templateSiteFilter === siteKey
                        ? 'bg-panel text-cyberCyan font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {siteLabel}
                  </button>
                ))}
              </div>
              <select
                value={activeDoc.templateId}
                onChange={(e) =>
                  onUpdateActiveDoc((doc) => ({
                    ...doc,
                    templateId: e.target.value,
                    customTitle: null,
                    customBody: null,
                  }))
                }
                className="bg-void text-white rounded px-2 py-0.5 border border-cyberBorder cursor-pointer"
              >
                {templates
                  .filter((t) =>
                    templateSiteFilter === 'all' ? true : (t.site || 'custom') === templateSiteFilter
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              <select
                value={newTplSite}
                onChange={(e) => setNewTplSite(e.target.value as TemplateSite)}
                className="bg-void text-cyberCyan font-mono rounded px-1.5 py-0.5 border border-cyberBorder cursor-pointer"
              >
                <option value="zinfinal">Zinfinal</option>
                <option value="identi">Identi</option>
                <option value="custom">Custom</option>
              </select>
              <input
                type="text"
                value={newTplName}
                onChange={(e) => setNewTplName(e.target.value)}
                placeholder="Nombre nueva plantilla..."
                className="bg-void text-white rounded px-2 py-0.5 border border-cyberBorder w-36"
              />
              <button
                onClick={() => {
                  onCreateTemplate(
                    newTplName.trim() || `Plantilla ${newTplSite} #${templates.length + 1}`,
                    newTplSite
                  );
                  setNewTplName('');
                }}
                className="neon-btn-cyan px-2.5 py-0.5 rounded font-extrabold cursor-pointer whitespace-nowrap"
              >
                ➕ Nueva
              </button>
              <button
                onClick={handleDownloadTemplateJson}
                className="px-2 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono cursor-pointer whitespace-nowrap"
              >
                ⬇ .json
              </button>
              <button
                onClick={handleDownloadTemplateTxt}
                className="px-2 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan text-cyberGreen font-mono cursor-pointer whitespace-nowrap"
                title="Exportar plantilla como texto plano para compartir"
              >
                ⬇ .txt
              </button>
            </div>
          )}

          {activeTool === 'ingest' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                onClick={() => setIngestModalOpen(true)}
                className="neon-btn-cyan px-3 py-0.5 rounded font-extrabold cursor-pointer whitespace-nowrap"
              >
                📂 Escanear medios
              </button>
              <button
                onClick={() => focusPanel('mediainfo')}
                className="px-2.5 py-0.5 rounded bg-void border border-cyberCyan/50 hover:border-cyberCyan text-cyberCyan font-bold cursor-pointer whitespace-nowrap"
              >
                📊 Ver MediaInfo
              </button>
              <button
                onClick={() => onOpenSettings('paths')}
                className="px-2.5 py-0.5 rounded bg-void border border-cyberBorder hover:border-cyberCyan text-slate-200 cursor-pointer whitespace-nowrap"
              >
                📁 Vincular Carpeta de Medios
              </button>
            </div>
          )}

          {activeTool === 'artgallery' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setArtSidebarOpen((v) => !v)}
                className="neon-btn-cyan px-3 py-0.5 rounded font-extrabold cursor-pointer whitespace-nowrap"
              >
                {artSidebarOpen ? '◧ Ocultar Galería Lateral' : '🎨 Abrir Selección Visual de Arte'}
              </button>
              <button
                type="button"
                onClick={handleFetchAllVisualArt}
                disabled={fetchingFanart}
                className="px-2.5 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {fetchingFanart ? '⏳ Buscando...' : '🔄 TMDB + OMDb + Fanart'}
              </button>
              <span className="font-mono text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                {visualArtItems.length} artes disponibles
              </span>
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          <input
            type="text"
            value={apiSearchQuery}
            onChange={(e) => setApiSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRunApiSearch();
            }}
            placeholder="Buscar en API..."
            className="bg-void text-slate-100 font-mono text-[11px] rounded px-2 py-0.5 border border-cyberBorder w-32 lg:w-36 focus:outline-none focus:border-cyberCyan"
          />
          <button
            onClick={handleRunApiSearch}
            disabled={runningApi}
            className="px-2.5 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            {runningApi ? '⏳ Consultando...' : `⚡ ${activeApiObj?.name.split(' ')[0] || 'API'}`}
          </button>
          <button
            type="button"
            onClick={() => setIdentifyModalOpen(true)}
            title="Identificar contenido manualmente mediante ID del proveedor"
            className="px-2 py-0.5 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
          >
            🎯 Identificar
          </button>
          <button
            type="button"
            onClick={() => handleRefreshMetadata()}
            disabled={refreshingMetadata}
            title="Volver a buscar metadatos y sinopsis en todos los proveedores"
            className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            {refreshingMetadata ? '⏳...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* 3. CUERPO CENTRAL */}
      <div className="flex-1 min-h-0 flex w-full overflow-hidden relative">
        {/* CAJA DE HERRAMIENTAS IZQUIERDA */}
        <aside
          data-ps-toolbox-root
          className="w-11 bg-elevated border-r border-cyberBorder py-2 flex flex-col items-center justify-between shrink-0 z-20"
        >
          <div className="flex flex-col items-center gap-1.5">
            {(
              [
                ['covers', '1. Covers e Imágenes', '🖼️'],
                ['text', '2. Texto y Tipografía BBCode', 'T'],
                ['align', '3. Alineación y Estructura', '≡'],
                ['media', '4. Multimedia y Capturas', '▶'],
                ['links', '5. Spoiler Links y JDownloader', '🔗'],
                ['vars', '6. Variables y APIs', '{ }'],
                ['templates', '7. Gestor de Plantillas', '▦'],
                ['ingest', '8. Escanear medios', '📂'],
                ['artgallery', '9. Selección Visual de Arte (TMDB · OMDb · Fanart.tv)', '🎨'],
              ] as const
            ).map(([key, title, glyph]) => {
              const isArtBtn = key === 'artgallery';
              const isSelected = isArtBtn ? artSidebarOpen || activeTool === key : activeTool === key;
              return (
                <button
                  key={key}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (key === 'artgallery') {
                      setActiveTool('artgallery');
                      setFlyoutTool(null);
                      setArtSidebarOpen((prev) => !prev);
                      return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    setActiveTool(key);
                    setFlyoutPos({ left: r.right + 6, top: Math.min(window.innerHeight - 240, r.top) });
                    setFlyoutTool(flyoutTool === key ? null : key);
                  }}
                  data-tooltip-title={title}
                  data-tooltip-desc={
                    isArtBtn
                      ? `Galería visual TMDB, OMDb y Fanart.tv (${visualArtItems.length} artes disponibles)`
                      : `Seleccionar herramienta ${TOOL_NAMES[key]}`
                  }
                  className={`ps-tool-btn ${
                    isSelected ? 'active' : ''
                  } relative w-8 h-8 rounded-md bg-void border border-cyberBorder hover:border-cyberCyan flex items-center justify-center text-slate-200 cursor-pointer text-xs font-mono font-bold`}
                >
                  <span>{glyph}</span>
                  {isArtBtn && visualArtItems.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-cyberGreen text-void font-mono text-[9px] font-extrabold leading-[14px] text-center tabular-nums">
                      {visualArtItems.length}
                    </span>
                  )}
                  <span className="ps-flyout-triangle" />
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-1.5 pt-2 border-t border-cyberBorder/70">
            <div className="relative w-8 h-8">
              <input
                type="color"
                value={bgColor}
                onMouseDown={() => syncEditorSelection()}
                onChange={(e) => {
                  setBgColor(e.target.value);
                  applyBbColorToSelection(e.target.value, { restoreFocus: false });
                }}
                title="Color BBCode secundario (reemplaza color existente en selección)"
                className="absolute bottom-0 right-0 w-5 h-5 rounded border border-white/50 cursor-pointer bg-transparent p-0"
              />
              <input
                type="color"
                value={fgColor}
                onMouseDown={() => syncEditorSelection()}
                onChange={(e) => {
                  setFgColor(e.target.value);
                  applyBbColorToSelection(e.target.value, { restoreFocus: false });
                }}
                title="Color BBCode principal (reemplaza color existente en selección)"
                className="absolute top-0 left-0 w-5 h-5 rounded border-2 border-white cursor-pointer bg-transparent p-0 z-10"
              />
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const next = bgColor;
                  setFgColor(bgColor);
                  setBgColor(fgColor);
                  applyBbColorToSelection(next, { restoreFocus: true });
                }}
                title="Intercambiar y aplicar color"
                className="hover:text-cyberCyan cursor-pointer"
              >
                ⇄
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setFgColor('#00f0ff');
                  setBgColor('#ff0055');
                }}
                title="Restaurar colores neón"
                className="hover:text-cyberCyan cursor-pointer"
              >
                ◩
              </button>
            </div>
          </div>
        </aside>

        {/* FLYOUT SUB-HERRAMIENTAS */}
        {flyoutTool && (
          <div
            data-ps-toolbox-root
            style={{ left: flyoutPos.left, top: flyoutPos.top }}
            className="fixed z-50 w-64 bg-panel/98 border border-cyberCyan/70 rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.92)] p-1.5 backdrop-blur-md"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono text-cyberCyan uppercase border-b border-cyberBorder mb-1 font-bold">
              {TOOL_NAMES[flyoutTool]}
            </div>
            {flyoutItems[flyoutTool].map((st, idx) => (
              <button
                key={`${st.label}-${idx}`}
                onClick={() => {
                  setFlyoutTool(null);
                  st.action();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-elevated flex items-center justify-between gap-2 text-xs text-slate-200 hover:text-cyberCyan cursor-pointer"
              >
                <span className="truncate">{st.label}</span>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{st.hint}</span>
              </button>
            ))}
          </div>
        )}

        {/* BARRA LATERAL: SELECCIÓN VISUAL DE ARTE (TMDB · OMDB/IMDB · FANART.TV) */}
        {artSidebarOpen && (() => {
          const getItemSource = (item: FanartArtworkItem): 'tmdb' | 'omdb' | 'fanart' =>
            item.source || 'fanart';

          const tmdbCount = visualArtItems.filter((i) => getItemSource(i) === 'tmdb').length;
          const omdbCount = visualArtItems.filter((i) => getItemSource(i) === 'omdb').length;
          const fanartCount = visualArtItems.filter((i) => getItemSource(i) === 'fanart').length;

          const itemsBySource =
            artSourceFilter === 'all'
              ? visualArtItems
              : visualArtItems.filter((i) => getItemSource(i) === artSourceFilter);

          const postersCount = itemsBySource.filter((i) => i.kind === 'poster').length;
          const logosCount = itemsBySource.filter((i) => i.kind === 'logo').length;
          const bannersCount = itemsBySource.filter((i) => i.kind === 'banner').length;
          const clearartsCount = itemsBySource.filter((i) => i.kind === 'clearart').length;
          const backgroundsCount = itemsBySource.filter((i) => i.kind === 'background').length;

          const filteredVisualItems =
            artSidebarFilter === 'all'
              ? itemsBySource
              : itemsBySource.filter((i) => i.kind === artSidebarFilter);

          const slotByKind: Record<
            'poster' | 'logo' | 'banner' | 'clearart' | 'background',
            'poster_url' | 'logo_url' | 'banner_url' | 'clearart_url' | 'background_url'
          > = {
            poster: 'poster_url',
            logo: 'logo_url',
            banner: 'banner_url',
            clearart: 'clearart_url',
            background: 'background_url',
          };

          const handleRefreshVisualArt = () => {
            if (artSourceFilter === 'tmdb') {
              void handleFetchTmdbVisualArt();
              return;
            }
            if (artSourceFilter === 'omdb') {
              void handleFetchOmdbVisualArt();
              return;
            }
            if (artSourceFilter === 'fanart') {
              if (artSidebarFilter === 'banner') void handleFetchFanartBySlot('banner_url');
              else if (artSidebarFilter === 'logo') void handleFetchFanartBySlot('logo_url');
              else if (artSidebarFilter === 'clearart') void handleFetchFanartBySlot('clearart_url');
              else void handleFetchFanartForDoc();
              return;
            }
            void handleFetchAllVisualArt();
          };

          return (
            <aside className="w-72 sm:w-80 bg-panel border-r border-cyberBorder flex flex-col shrink-0 z-10 overflow-hidden">
              <div className="px-3 py-2.5 bg-elevated/90 border-b border-cyberBorder flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-white flex items-center gap-1.5 truncate">
                    <span>🎨</span>
                    <span className="truncate">Selección Visual de Arte</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 truncate">
                    TMDB · OMDb/IMDb · Fanart.tv · Clic para elegir
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIdentifyModalOpen(true)}
                    title="Identificar contenido mediante ID del proveedor (TMDB, IMDb, TVDB, MBID...)"
                    className="px-2 py-1 rounded bg-cyberMagenta/15 hover:bg-cyberMagenta/25 border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer"
                  >
                    🎯
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshVisualArt}
                    disabled={fetchingFanart}
                    title={
                      artSourceFilter === 'tmdb'
                        ? 'Buscar portadas, logos y fondos en TMDB'
                        : artSourceFilter === 'omdb'
                        ? 'Buscar portadas en OMDb / IMDb'
                        : artSourceFilter === 'fanart'
                        ? 'Buscar banners, logos y cleararts en Fanart.tv'
                        : 'Buscar artes en TMDB, OMDb y Fanart.tv'
                    }
                    className="px-2 py-1 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {fetchingFanart ? '⏳' : '🔄'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setArtSidebarOpen(false)}
                    title="Cerrar barra lateral de arte"
                    className="w-6 h-6 rounded bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center text-[11px] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Pestañas de proveedor (Todos / TMDB / OMDb / Fanart.tv) */}
              <div className="px-2 py-1.5 bg-panel border-b border-cyberBorder grid grid-cols-4 gap-1 shrink-0">
                {(
                  [
                    ['all', 'Todos', visualArtItems.length, 'text-white border-cyberCyan'],
                    ['tmdb', 'TMDB', tmdbCount, 'text-cyberCyan border-cyberCyan'],
                    ['omdb', 'OMDb', omdbCount, 'text-amber-300 border-amber-400'],
                    ['fanart', 'Fanart', fanartCount, 'text-cyberGreen border-cyberGreen'],
                  ] as const
                ).map(([srcKey, label, count, activeCls]) => (
                  <button
                    key={srcKey}
                    type="button"
                    onClick={() => setArtSourceFilter(srcKey)}
                    className={`px-1.5 py-1 rounded text-[10px] font-mono cursor-pointer whitespace-nowrap tabular-nums border text-center transition-colors ${
                      artSourceFilter === srcKey
                        ? `bg-void font-bold ${activeCls}`
                        : 'bg-void/40 border-transparent text-slate-400 hover:text-slate-200 hover:bg-void/80'
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              {/* Botones rápidos de descarga por proveedor */}
              <div className="px-2 py-1.5 bg-void/60 border-b border-cyberBorder flex items-center gap-1 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={handleFetchTmdbVisualArt}
                  disabled={fetchingFanart}
                  className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberCyan/40 text-cyberCyan font-mono text-[9px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  🎬 +TMDB
                </button>
                <button
                  type="button"
                  onClick={handleFetchOmdbVisualArt}
                  disabled={fetchingFanart}
                  className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-amber-400/40 text-amber-300 font-mono text-[9px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  🎞️ +OMDb
                </button>
                <button
                  type="button"
                  onClick={handleFetchFanartForDoc}
                  disabled={fetchingFanart}
                  className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberGreen/40 text-cyberGreen font-mono text-[9px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  🎨 +Fanart
                </button>
              </div>

              {/* Pestañas de tipo de arte */}
              <div className="px-2.5 py-1.5 bg-void/70 border-b border-cyberBorder flex items-center gap-1 overflow-x-auto shrink-0">
                {(
                  [
                    ['all', 'Todo', itemsBySource.length],
                    ['poster', 'Portadas', postersCount],
                    ['logo', 'Logos', logosCount],
                    ['banner', 'Banners', bannersCount],
                    ['clearart', 'ClearArt', clearartsCount],
                    ['background', 'Fondos', backgroundsCount],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setArtSidebarFilter(key)}
                    className={`px-2 py-1 rounded text-[10px] font-mono cursor-pointer whitespace-nowrap tabular-nums border transition-colors ${
                      artSidebarFilter === key
                        ? 'bg-panel border-cyberCyan text-cyberCyan font-bold'
                        : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-panel/50'
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
                {filteredVisualItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-cyberBorder bg-void/70 p-4 text-center space-y-2.5">
                    <div className="text-xl">🎨</div>
                    <div className="text-xs font-bold text-slate-200">
                      {visualArtItems.length === 0
                        ? 'Sin artworks cargados aún'
                        : `Sin resultados para ${artSourceFilter.toUpperCase()} · ${artSidebarFilter}`}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Descarga portadas, logos HD, banners, cleararts y fondos desde TMDB, OMDb/IMDb y Fanart.tv para{' '}
                      <strong className="text-slate-200">
                        {activeDoc.context.titulo || 'tu título actual'}
                      </strong>{' '}
                      y cámbialos con un clic.
                    </p>
                    <div className="flex flex-col gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={handleRefreshVisualArt}
                        disabled={fetchingFanart}
                        className="w-full py-1.5 px-3 rounded-lg bg-cyberGreen/20 hover:bg-cyberGreen/30 border border-cyberGreen/60 text-cyberGreen font-mono text-[11px] font-bold cursor-pointer disabled:opacity-50"
                      >
                        {fetchingFanart
                          ? '⏳ Consultando proveedores...'
                          : artSourceFilter === 'tmdb'
                          ? '🎬 Descargar Artes de TMDB'
                          : artSourceFilter === 'omdb'
                          ? '🎞️ Descargar Portadas OMDb'
                          : artSourceFilter === 'fanart'
                          ? '🎨 Descargar Artes Fanart.tv'
                          : '🔄 Descargar TMDB + OMDb + Fanart'}
                      </button>
                      {!config.tmdbApiKey.trim() &&
                        !config.omdbApiKey.trim() &&
                        !config.fanartApiKey.trim() && (
                          <button
                            type="button"
                            onClick={() => onOpenSettings('paths')}
                            className="w-full py-1.5 px-3 rounded-lg bg-panel hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer"
                          >
                            ⚙ Configurar API Keys (TMDB / OMDb / Fanart)
                          </button>
                        )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredVisualItems.map((item) => {
                      const kindKey = item.kind as
                        | 'poster'
                        | 'logo'
                        | 'banner'
                        | 'clearart'
                        | 'background';
                      const targetSlot = slotByKind[kindKey];
                      const isActiveInPost = activeDoc.context[targetSlot] === item.url;
                      const src = getItemSource(item);
                      const srcBadge =
                        src === 'tmdb' ? 'TMDB' : src === 'omdb' ? 'OMDb' : 'Fanart.tv';
                      const srcBadgeCls =
                        src === 'tmdb'
                          ? 'text-cyberCyan border-cyberCyan/50 bg-cyberCyan/10'
                          : src === 'omdb'
                          ? 'text-amber-300 border-amber-400/50 bg-amber-400/10'
                          : 'text-cyberGreen border-cyberGreen/50 bg-cyberGreen/10';
                      const kindBadge =
                        kindKey === 'poster'
                          ? 'PORTADA'
                          : kindKey === 'banner'
                          ? 'BANNER'
                          : kindKey === 'logo'
                          ? 'LOGO HD'
                          : kindKey === 'clearart'
                          ? 'CLEARART'
                          : 'FONDO';
                      const badgeTone =
                        kindKey === 'poster'
                          ? 'text-sky-300 border-sky-400/40 bg-sky-400/10'
                          : kindKey === 'banner'
                          ? 'text-cyberCyan border-cyberCyan/40 bg-cyberCyan/10'
                          : kindKey === 'logo'
                          ? 'text-cyberGreen border-cyberGreen/40 bg-cyberGreen/10'
                          : kindKey === 'clearart'
                          ? 'text-cyberMagenta border-cyberMagenta/40 bg-cyberMagenta/10'
                          : 'text-purple-300 border-purple-400/40 bg-purple-400/10';

                      return (
                        <div
                          key={item.id}
                          className={`rounded-xl border transition-colors overflow-hidden bg-void/90 ${
                            isActiveInPost
                              ? 'border-cyberGreen shadow-[0_0_12px_rgba(0,255,157,0.25)]'
                              : 'border-cyberBorder hover:border-cyberCyan/70'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleInsertVisualArt(item, false)}
                            title={`Clic para aplicar este ${kindBadge} de ${srcBadge} en {{${targetSlot}}}`}
                            className="w-full text-left cursor-pointer group block"
                          >
                            <div className="relative bg-[#070a10] p-2 flex items-center justify-center min-h-[76px] border-b border-cyberBorder/60">
                              <img
                                src={item.previewUrl || item.url}
                                alt={`${srcBadge} ${kindBadge} ${item.lang || ''}`}
                                referrerPolicy="no-referrer"
                                className="max-h-24 w-full object-contain transition-transform duration-150 group-hover:scale-[1.02]"
                              />
                              <span
                                className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded border font-mono text-[8px] font-extrabold ${srcBadgeCls}`}
                              >
                                {srcBadge}
                              </span>
                              {isActiveInPost && (
                                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-cyberGreen text-void font-mono text-[9px] font-extrabold">
                                  ✔ En post
                                </span>
                              )}
                            </div>
                          </button>
                          <div className="px-2 py-1.5 flex items-center justify-between gap-1.5 bg-panel/70">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded border font-mono text-[9px] font-bold shrink-0 ${badgeTone}`}
                              >
                                {kindBadge}
                              </span>
                              <span className="font-mono text-[10px] text-slate-300 tabular-nums truncate">
                                {item.lang || '00'}
                                {item.likes > 0 ? ` · ♥ ${item.likes}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleInsertVisualArt(item, false)}
                                className="px-2 py-0.5 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[9px] font-bold cursor-pointer"
                                title={`Aplicar en {{${targetSlot}}}`}
                              >
                                Aplicar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleInsertVisualArt(item, true)}
                                className="px-1.5 py-0.5 rounded bg-void hover:bg-elevated border border-cyberBorder hover:border-cyberGreen text-slate-200 font-mono text-[9px] cursor-pointer"
                                title="Insertar etiqueta [img] directamente en el editor"
                              >
                                +[img]
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>
          );
        })()}

        {/* ÁREA PRINCIPAL */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          {/* PESTAÑAS DE DOCUMENTOS */}
          <div className="h-8 bg-canvasbg border-b border-cyberBorder px-2 flex items-center gap-1 overflow-x-auto shrink-0">
            {openDocuments.map((doc) => {
              const isActive = doc.id === activeDoc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => onSwitchDocument(doc.id)}
                  className={`px-3 py-1 rounded-t-md text-[11px] font-mono flex items-center gap-2 shrink-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-panel text-white border-t border-x border-cyberBorder font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-panel/40'
                  }`}
                >
                  <span className="truncate max-w-[190px]">{doc.name}</span>
                  {openDocuments.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseDocument(doc.id);
                      }}
                      className="text-slate-500 hover:text-red-400 ml-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => {
                onCreateDocument();
                setIngestModalOpen(true);
              }}
              title="Nuevo documento BBCode"
              className="px-2.5 py-1 rounded text-xs font-mono text-cyberCyan hover:bg-panel cursor-pointer shrink-0"
            >
              +
            </button>
            <div data-recent-projects-root className="ml-auto shrink-0 flex items-center">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (recentMenuPos) {
                    setRecentMenuPos(null);
                  } else {
                    const r = e.currentTarget.getBoundingClientRect();
                    setRecentMenuPos({
                      left: Math.max(12, Math.min(window.innerWidth - 360, r.right - 344)),
                      top: r.bottom + 4,
                    });
                  }
                }}
                title="Historial de archivos analizados con MediaInfo"
                className={`px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer whitespace-nowrap tabular-nums flex items-center gap-1 transition-colors ${
                  recentMenuPos
                    ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan font-bold'
                    : 'bg-panel/80 hover:bg-panel border-cyberBorder hover:border-cyberCyan/60 text-slate-200'
                }`}
              >
                <span>🕒 Recientes</span>
                <span className="text-cyberCyan font-bold">({recentProjects.length})</span>
              </button>
            </div>
          </div>

          {/* POPOVER PROYECTOS RECIENTES */}
          {recentMenuPos && (
            <div
              data-recent-projects-root
              style={{ left: recentMenuPos.left, top: recentMenuPos.top }}
              className="fixed z-50 w-[344px] max-w-[92vw] bg-panel/98 border border-cyberCyan/65 rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.92)] p-2.5 backdrop-blur-md space-y-2"
            >
              <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-cyberBorder">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white">
                    🕒 Proyectos Recientes (MediaInfo)
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Reabre metadatos guardados sin re-analizar el archivo físico
                  </div>
                </div>
                {recentProjects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearRecentProjects();
                      onToast('Historial de proyectos recientes limpiado.', 'info');
                    }}
                    className="text-[10px] font-mono text-slate-400 hover:text-red-300 cursor-pointer shrink-0"
                  >
                    Limpiar
                  </button>
                )}
              </div>

              {recentProjects.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-slate-400">
                  Aún no hay archivos MediaInfo analizados en el historial.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
                  {recentProjects.map((proj) => {
                    const pmi = proj.mediainfoDetails;
                    return (
                      <div
                        key={proj.id}
                        className="rounded-lg bg-void/90 border border-cyberBorder hover:border-cyberCyan/60 p-2 flex items-center justify-between gap-2"
                      >
                        <button
                          type="button"
                          onClick={() => openRecentProjectInWorkspace(proj, 'new-tab')}
                          className="min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[11px] font-bold text-white truncate">
                              {pmi.fileName}
                            </span>
                            <span className="px-1 py-0.2 rounded bg-panel border border-cyberCyan/40 text-[9px] font-mono text-cyberCyan shrink-0">
                              {pmi.container}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate tabular-nums mt-0.5">
                            {formatRecentTechSummary(pmi)}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openRecentProjectInWorkspace(proj, 'new-tab')}
                            className="px-2 py-1 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer"
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveRecentProject(proj.id)}
                            title="Quitar del historial"
                            className="px-1.5 py-1 rounded bg-void hover:bg-red-950/40 border border-cyberBorder hover:border-red-500/60 text-slate-400 hover:text-red-300 font-mono text-[10px] cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* DOCK WORKSPACE ROOT */}
          <div ref={dockRootRef} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden relative">
            {/* DOCK DROP OVERLAY */}
            {draggingPanel && (
              <div className="absolute inset-0 z-40 pointer-events-none p-2">
                <div className="w-full h-full flex flex-col gap-2">
                  <div className="flex-1 min-h-0 flex gap-2">
                    <div className="w-[36%] h-full flex flex-col gap-2">
                      <div
                        data-drop-zone="left-top"
                        className={`dock-drop-overlay flex-1 rounded-xl flex flex-col items-center justify-center text-center p-2 ${
                          draggingPanel.matchedZone === 'left-top' ? 'hovered' : ''
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-cyberCyan uppercase">
                          ◧ ZONA IZQUIERDA (SUPERIOR)
                        </span>
                      </div>
                      <div
                        data-drop-zone="left-bottom"
                        className={`dock-drop-overlay flex-1 rounded-xl flex flex-col items-center justify-center text-center p-2 ${
                          draggingPanel.matchedZone === 'left-bottom' ? 'hovered' : ''
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-cyberCyan uppercase">
                          ◧ ZONA IZQUIERDA (INFERIOR)
                        </span>
                      </div>
                    </div>

                    <div
                      data-drop-zone="center-main"
                      className={`dock-drop-overlay w-[28%] h-full rounded-xl flex flex-col items-center justify-center text-center p-2 ${
                        draggingPanel.matchedZone === 'center-main' ? 'hovered' : ''
                      }`}
                    >
                      <span className="text-xs font-mono font-bold text-cyberPurple uppercase">
                        ▣ ZONA CENTRAL
                      </span>
                    </div>

                    <div className="w-[36%] h-full flex flex-col gap-2">
                      <div
                        data-drop-zone="right-top"
                        className={`dock-drop-overlay flex-1 rounded-xl flex flex-col items-center justify-center text-center p-2 ${
                          draggingPanel.matchedZone === 'right-top' ? 'hovered' : ''
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-cyberMagenta uppercase">
                          ◨ ZONA DERECHA (SUPERIOR)
                        </span>
                      </div>
                      <div
                        data-drop-zone="right-bottom"
                        className={`dock-drop-overlay flex-1 rounded-xl flex flex-col items-center justify-center text-center p-2 ${
                          draggingPanel.matchedZone === 'right-bottom' ? 'hovered' : ''
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-cyberMagenta uppercase">
                          ◨ ZONA DERECHA (INFERIOR)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    data-drop-zone="bottom-main"
                    className={`dock-drop-overlay h-14 rounded-xl flex items-center justify-center gap-2 text-center px-4 shrink-0 ${
                      draggingPanel.matchedZone === 'bottom-main' ? 'hovered' : ''
                    }`}
                  >
                    <span className="text-xs font-mono font-bold text-cyberGreen uppercase">
                      ⬓ DOCK INFERIOR
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* COLUMNAS PRINCIPALES */}
            <div
              ref={columnsContainerRef}
              className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row overflow-hidden relative"
            >
              {hasLeft && (
                <div
                  ref={leftColRef}
                  style={{ flex: hasCenter || hasRight ? `0 0 ${splitRatios.leftColPct}%` : '1 1 100%' }}
                  className="min-w-0 min-h-0 flex flex-col overflow-hidden relative"
                >
                  {renderSlot(
                    'left-top',
                    hasLeftBottom ? { height: `${splitRatios.leftTopPct}%`, flex: 'none' } : { flex: '1 1 100%' }
                  )}
                  {hasLeftTop && hasLeftBottom && (
                    <div
                      onPointerDown={(e) =>
                        startHorizontalSplit(e, 'leftTopPct', leftColRef.current, splitRatios.leftTopPct)
                      }
                      className="splitter-h"
                    />
                  )}
                  {renderSlot('left-bottom', { flex: '1 1 0%' })}
                </div>
              )}

              {hasLeft && (hasCenter || hasRight) && (
                <div
                  onPointerDown={(e) => startVerticalSplit(e, 'leftColPct', leftColRef.current)}
                  className="hidden md:block splitter-v"
                />
              )}

              {hasCenter && (
                <div
                  ref={centerColRef}
                  style={{ flex: hasRight ? `0 0 ${splitRatios.centerColPct}%` : '1 1 0%' }}
                  className="min-w-0 min-h-0 flex flex-col overflow-hidden relative"
                >
                  {renderSlot('center-main', { flex: '1 1 100%' })}
                </div>
              )}

              {hasCenter && hasRight && (
                <div
                  onPointerDown={(e) => startVerticalSplit(e, 'centerColPct', centerColRef.current)}
                  className="hidden md:block splitter-v"
                />
              )}

              {hasRight && (
                <div
                  ref={rightColRef}
                  style={{ flex: '1 1 0%' }}
                  className="min-w-0 min-h-0 flex flex-col overflow-hidden relative"
                >
                  {renderSlot(
                    'right-top',
                    hasRightBottom ? { height: `${splitRatios.rightTopPct}%`, flex: 'none' } : { flex: '1 1 100%' }
                  )}
                  {hasRightTop && hasRightBottom && (
                    <div
                      onPointerDown={(e) =>
                        startHorizontalSplit(e, 'rightTopPct', rightColRef.current, splitRatios.rightTopPct)
                      }
                      className="splitter-h"
                    />
                  )}
                  {renderSlot('right-bottom', { flex: '1 1 0%' })}
                </div>
              )}
              {!hasLeft && !hasCenter && !hasRight && (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-void/60">
                  <div className="max-w-md w-full rounded-2xl border border-cyberBorder bg-panel/95 p-6 shadow-2xl space-y-4">
                    <div className="text-3xl">🪟</div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-white">
                        {dockState.floating.length > 0 && !hasBottom
                          ? 'Todos los paneles acoplados han sido eliminados'
                          : 'No hay paneles visibles en el área principal'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Puedes activar paneles individuales desde el menú <span className="text-cyberCyan font-semibold">Ventana</span> o restaurar tu distribución ahora mismo.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {ALL_PANEL_IDS.map((panelId) => {
                        const meta = PANEL_META[panelId];
                        const isVisible = getPanelLocation(panelId).kind !== 'hidden';
                        if (isVisible) return null;
                        return (
                          <button
                            key={panelId}
                            type="button"
                            onClick={() => handleRestorePanel(panelId)}
                            className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-void border border-cyberBorder hover:border-cyberCyan text-[11px] font-semibold text-slate-200 hover:text-cyberCyan cursor-pointer flex items-center gap-1.5"
                          >
                            <span>+</span>
                            <span>{meta.icon}</span>
                            <span>{meta.title}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="pt-2 border-t border-cyberBorder flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handleRestoreAllPanels}
                        className="neon-btn-cyan px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        ↺ Restaurar Todos los Paneles
                      </button>
                      {hasCustomSavedWorkspace && (
                        <button
                          type="button"
                          onClick={() => onApplyWorkspacePreset('custom')}
                          className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-void border border-cyberGreen/60 text-cyberGreen text-xs font-bold cursor-pointer"
                        >
                          ⭐ Cargar Mi Espacio Guardado
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {hasBottom && (
              <>
                <div onPointerDown={startBottomDockSplit} className="splitter-h" />
                <div
                  style={{ height: `${splitRatios.bottomDockPct}%` }}
                  className="min-h-[130px] min-w-0 flex flex-col overflow-hidden relative bg-panel"
                >
                  {renderSlot('bottom-main', { flex: '1 1 100%' })}
                </div>
              </>
            )}
          </div>

          {/* PANELES FLOTANTES */}
          <div className="pointer-events-none fixed inset-0 z-30">
            {dockState.floating.map((fp) => {
              const meta = PANEL_META[fp.id];
              return (
                <div
                  key={fp.id}
                  style={{ left: fp.x, top: fp.y, width: fp.w, height: fp.h }}
                  className="pointer-events-auto fixed bg-panel border-2 border-cyberCyan/80 rounded-xl shadow-[0_24px_64px_rgba(0,0,0,0.92)] flex flex-col overflow-hidden resize"
                >
                  <div
                    onPointerDown={(e) => startFloatingDrag(e, fp.id, fp.x, fp.y)}
                    className="h-8 bg-elevated border-b border-cyberBorder px-2.5 flex items-center justify-between gap-1.5 cursor-move select-none shrink-0"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-cyberCyan font-mono text-xs">≡</span>
                      <span className="text-xs">{meta.icon}</span>
                      <span className="text-xs font-bold text-white truncate">{meta.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => dockPanelToSlot(fp.id, 'left-bottom')}
                        title="Acoplar a la Izquierda"
                        className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer"
                      >
                        ◧ Izq
                      </button>
                      <button
                        type="button"
                        onClick={() => dockPanelToSlot(fp.id, 'right-bottom')}
                        title="Acoplar a la Derecha"
                        className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberMagenta/60 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer"
                      >
                        ◨ Der
                      </button>
                      <button
                        type="button"
                        onClick={() => dockPanelToSlot(fp.id, meta.defaultSlot)}
                        title="Acoplar en su zona por defecto"
                        className="px-1.5 py-0.5 rounded bg-void hover:bg-panel border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer"
                      >
                        ⚓
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePanel(fp.id)}
                        title={`Eliminar "${meta.title}" (reactivable en Ventana)`}
                        aria-label={`Eliminar panel ${meta.title}`}
                        className="px-1.5 py-0.5 rounded bg-void hover:bg-rose-500/15 border border-cyberBorder hover:border-rose-400/70 text-slate-400 hover:text-rose-400 font-mono text-[10px] font-bold cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {renderPanelContent(fp.id)}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* 4. BARRA DE STATUS INFERIOR */}
      <footer className="h-6 bg-elevated border-t border-cyberBorder px-3 flex items-center justify-between gap-4 text-[10px] font-mono text-slate-400 shrink-0 z-20">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <button
            onClick={onOpenAbout}
            className="text-cyberCyan hover:underline font-bold cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
          >
            {APP_INFO.name} v{APP_INFO.version}
          </button>
          <span aria-hidden="true" className="shrink-0">·</span>
          <span className="text-slate-300 whitespace-nowrap shrink-0">
            Creador: {APP_INFO.creator}
          </span>
          <span aria-hidden="true" className="hidden sm:inline shrink-0">·</span>
          <span className="hidden sm:inline truncate">Herramienta: {TOOL_NAMES[activeTool]}</span>
          <span aria-hidden="true" className="hidden md:inline shrink-0">·</span>
          <span
            className={`hidden md:inline truncate ${
              connectedApis.length > 0 ? 'text-cyberGreen' : 'text-amber-300'
            }`}
          >
            {connectedApis.length > 0
              ? `API: ${
                  activeApiObj && isApiProviderConnected(activeApiObj, config)
                    ? activeApiObj.name
                    : connectedApis[0].name
                }`
              : 'APIs: Solo incrustados'}
          </span>
          <span aria-hidden="true" className="hidden xl:inline shrink-0">·</span>
          <span className="hidden xl:inline text-slate-300 whitespace-nowrap shrink-0">
            Host: {config.imgHostProvider.toUpperCase()} {config.imgHostKey ? '✔' : '(Sin Key)'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 tabular-nums whitespace-nowrap">
          <button
            type="button"
            onClick={() => onOpenSettings('backups')}
            data-tooltip-title="Copias de Seguridad Incrementales"
            data-tooltip-desc={
              config.autoBackupEnabled
                ? `Auto-backup cada ${config.autoBackupIntervalMinutes || 10}m activo${
                    nextBackupAt
                      ? ` · Próximo a las ${new Date(nextBackupAt).toLocaleTimeString('es-ES', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`
                      : ''
                  }`
                : 'Auto-backup pausado — haz clic para configurar o restaurar puntos'
            }
            className="px-2 py-0.5 rounded bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan/60 text-slate-200 font-mono cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            {backupRunning
              ? '⏳ Backup...'
              : !config.autoBackupEnabled
              ? `💾 Backup: Pausado (${backupCount})`
              : lastBackupAt
              ? `💾 Backup ${config.autoBackupIntervalMinutes || 10}m ✔ ${new Date(
                  lastBackupAt
                ).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
              : `💾 Backup ${config.autoBackupIntervalMinutes || 10}m (${backupCount})`}
          </button>
          <span className="text-cyberGreen">Auto-guardado ✔ {savedTimeLabel}</span>
          <span className="text-slate-300">
            {isWorkspaceLocked ? '🔒 Bloqueada' : '🔓 Desbloqueada'}
          </span>
          <button
            type="button"
            onClick={() => setShortcutsModalOpen(true)}
            data-tooltip-title="Guía rápida de atajos de teclado"
            data-tooltip-desc="Consulta los atajos de edición BBCode y flujo rápido (Ctrl+/ o ?)"
            className="px-2 py-0.5 rounded bg-void hover:bg-panel border border-cyberCyan/45 hover:border-cyberCyan text-cyberCyan font-bold cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
          >
            <span>⌨</span>
            <span>Atajos</span>
            <span className="text-[9px] text-slate-400 hidden sm:inline">(?)</span>
          </button>
        </div>
      </footer>

      <MediaIngestModal
        open={ingestModalOpen}
        config={config}
        apiProviders={apiProviders}
        recentProjects={recentProjects}
        analyzing={analyzingFile}
        statusMessage={ingestStatusMsg}
        onFilesDroppedOrPicked={handleFilesIngest}
        onBrowseFiles={handleBrowseMediaFiles}
        onBrowseFolder={handleBrowseAndAnalyzeFolder}
        onOpenRecentProject={(project) => openRecentProjectInWorkspace(project, 'new-tab')}
        onOpenConnectApi={onOpenConnectApi}
        onOpenSettings={onOpenSettings}
        onSkip={() => setIngestModalOpen(false)}
      />

      <ShortcutsModal
        open={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      <WatermarkPromptModal
        open={Boolean(watermarkPrompt?.open)}
        previewDataUrl={watermarkPrompt?.previewDataUrl || ''}
        imageCount={watermarkPrompt?.imageCount || 1}
        hostLabel={config.imgHostProvider.toUpperCase()}
        contextLabel={watermarkPrompt?.contextLabel || 'Imágenes'}
        config={config}
        onSaveDefaults={onUpdateConfig}
        onConfirmWatermark={(settings) => {
          const resolveFn = watermarkPrompt?.resolve;
          setWatermarkPrompt(null);
          resolveFn?.({ action: 'watermark', settings });
        }}
        onConfirmClean={() => {
          const resolveFn = watermarkPrompt?.resolve;
          setWatermarkPrompt(null);
          resolveFn?.({ action: 'clean' });
        }}
        onCancel={() => {
          const resolveFn = watermarkPrompt?.resolve;
          setWatermarkPrompt(null);
          resolveFn?.({ action: 'cancel' });
        }}
      />

      <IdentifyMediaModal
        open={identifyModalOpen}
        initialValues={{
          mediaType:
            activeDoc.context.media_type === 'tv' || activeDoc.context.media_type === 'music'
              ? activeDoc.context.media_type
              : 'movie',
          tmdbId: activeDoc.context.tmdb_id || '',
          imdbId: activeDoc.context.imdb_id || '',
          tvdbId: activeDoc.context.tvdb_id || '',
          mbidId: activeDoc.context.mbid_id || '',
          anilistId: activeDoc.context.anilist_id || '',
          tvmazeId: activeDoc.context.tvmaze_id || '',
          title: activeDoc.context.titulo || '',
          year: activeDoc.context.anio || '',
          artist: activeDoc.context.artista || '',
        }}
        activeProviderId={activeApiProviderId}
        syncing={refreshingMetadata}
        onClose={() => setIdentifyModalOpen(false)}
        onSaveOnly={handleSaveIdentifyIds}
        onIdentifyAndSync={handleIdentifyAndSync}
      />

      <PasswordManagerModal
        open={passwordModalOpen}
        savedPasswords={savedPasswordsList}
        currentPostPassword={activeDoc.context.password || ''}
        currentPostBody={rawBody}
        onClose={() => setPasswordModalOpen(false)}
        onUpdateSavedPasswords={handleUpdateSavedPasswords}
        onApplyPasswordToPost={handleApplyPasswordToPost}
        onInsertAtCursor={(txt) => insertBbTag(txt, '')}
        onEnsureVariableBelowHeading={handleEnsurePasswordVarInPost}
      />

      <TemplateExportModal
        open={templateExportModalOpen}
        template={activeTemplate}
        onClose={() => setTemplateExportModalOpen(false)}
        onToast={onToast}
      />
    </div>
  );
};
