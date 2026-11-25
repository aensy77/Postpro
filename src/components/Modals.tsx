import React, { useEffect, useState } from 'react';
import type {
  ApiPingStatus,
  ApiProviderConfig,
  ApiVerificationResult,
  BbTemplate,
  FloatingToolItem,
  FunctionalPlugin,
  ImageHostProvider,
  IncrementalBackupRecord,
  RecentMediaProject,
  SavedPasswordEntry,
  SpoilerLinkRow,
  ThemePlugin,
  UserConfig,
  WatermarkPosition,
  WatermarkSettings,
} from '../types';
import {
  executeApiProvider,
  getConnectedMetadataProviders,
  isApiProviderConnected,
  pingApiProvider,
  verifyImageHost,
} from '../utils/apiClient';
import {
  buildHostersSummaryAndIdentiLinks,
  computePostTemplateChecksum,
  computeThemeChecksum,
  DEFAULT_CUSTOM_LINK_TEMPLATE,
  detectHosterFromUrl,
  detectPasswordHeadingInfo,
  HosterSvgIcon,
  validateAndParseThemeFile,
} from '../utils/bbcode';
import { formatBytes, pickLocalDirectory, pickSingleLocalFile } from '../utils/filePicker';
import {
  applyWatermarkToDataUrl,
  formatWatermarkLabel,
  WATERMARK_POSITION_LABELS,
} from '../utils/watermark';
import { APP_INFO, PostProLogo } from './PostProLogo';

/* ============================================================================
   MODAL 1: CONFIGURACIÓN GENERAL + RUTAS + KEYS + HOST IMÁGENES + BACKUP
   ============================================================================ */
interface SettingsModalProps {
  open: boolean;
  initialTab: 'paths' | 'imghost' | 'minimenu' | 'backups';
  config: UserConfig;
  apiProviders: ApiProviderConfig[];
  apiPingStatuses: Record<string, ApiPingStatus>;
  miniMenuTools: FloatingToolItem[];
  incrementalBackups: IncrementalBackupRecord[];
  backupsLoading: boolean;
  backupRunning: boolean;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  backupFolderHandleReady: boolean;
  onClose: () => void;
  onUpdateConfig: (patch: Partial<UserConfig>) => void;
  onUpdatePingStatuses: React.Dispatch<React.SetStateAction<Record<string, ApiPingStatus>>>;
  onImportTemplatesFromFolder: (templates: BbTemplate[]) => void;
  onUpdateMiniMenu: (items: FloatingToolItem[]) => void;
  onTriggerIncrementalBackup: (forceFull?: boolean) => Promise<void>;
  onRestoreIncrementalBackup: (backupId: string) => Promise<void>;
  onDownloadIncrementalBackup: (backupId: string) => Promise<void>;
  onDeleteIncrementalBackup: (backupId: string) => Promise<void>;
  onClearIncrementalBackups: () => Promise<void>;
  onLinkLocalBackupFolder: () => Promise<void>;
  onUnlinkLocalBackupFolder: () => Promise<void>;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onResetAll: () => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  initialTab,
  config,
  apiProviders,
  apiPingStatuses,
  miniMenuTools,
  incrementalBackups,
  backupsLoading,
  backupRunning,
  lastBackupAt,
  nextBackupAt,
  backupFolderHandleReady,
  onClose,
  onUpdateConfig,
  onUpdatePingStatuses,
  onImportTemplatesFromFolder,
  onUpdateMiniMenu,
  onTriggerIncrementalBackup,
  onRestoreIncrementalBackup,
  onDownloadIncrementalBackup,
  onDeleteIncrementalBackup,
  onClearIncrementalBackups,
  onLinkLocalBackupFolder,
  onUnlinkLocalBackupFolder,
  onExportBackup,
  onImportBackup,
  onResetAll,
  onToast,
}) => {
  const [tab, setTab] = useState<'paths' | 'imghost' | 'minimenu' | 'backups'>(initialTab);
  const [verifyingHost, setVerifyingHost] = useState(false);
  const [hostVerifyMsg, setHostVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [verifyingKeys, setVerifyingKeys] = useState<'tmdb' | 'omdb' | 'fanart' | null>(null);
  const [keyVerifyMsg, setKeyVerifyMsg] = useState<string | null>(null);
  const [pingingBatch, setPingingBatch] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());

  const [newLabel, setNewLabel] = useState('');
  const [newOpen, setNewOpen] = useState('');
  const [newClose, setNewClose] = useState('');

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || tab !== 'backups') return;
    setCountdownNow(Date.now());
    const id = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleBrowseBinary = async (which: 'ffmpeg' | 'mediainfo') => {
    const picked = await pickSingleLocalFile(which === 'ffmpeg' ? '.exe,.bin,.wasm,*/*' : '.exe,.dll,.so,*/*');
    if (!picked) return;
    const p = picked.meta.relativePath || picked.meta.name;
    if (which === 'ffmpeg') {
      onUpdateConfig({ ffmpegPath: p, ffmpegLinkedFile: picked.meta });
    } else {
      onUpdateConfig({ mediainfoPath: p, mediainfoLinkedFile: picked.meta });
    }
    onToast(`Archivo vinculado: ${picked.meta.name} (${formatBytes(picked.meta.sizeBytes)})`, 'success');
  };

  const handleBrowseFolder = async (which: 'templates' | 'media') => {
    const res = await pickLocalDirectory({ parseTemplates: which === 'templates' });
    if (!res) return;
    if (which === 'templates') {
      if (res.importedTemplates.length > 0) onImportTemplatesFromFolder(res.importedTemplates);
      onUpdateConfig({
        templatesPath: res.folderName,
        templatesLinkedFolder: res.folderName,
        templatesCountFound: res.importedTemplates.length,
      });
      onToast(
        `Carpeta "${res.folderName}" leída (${res.importedTemplates.length} plantillas JSON)`,
        'success'
      );
    } else {
      const mediaOnly = res.metas.filter((m) =>
        /\.(mkv|mp4|webm|mov|avi|flac|mp3|wav|ogg|m4a|nfo|jpg|png|webp)$/i.test(m.name)
      );
      onUpdateConfig({ mediaFolderLinked: res.folderName, mediaFilesIndex: mediaOnly });
      onToast(`Carpeta de medios "${res.folderName}" indexada (${mediaOnly.length} archivos)`, 'success');
    }
  };

  const handleVerifyKey = async (which: 'tmdb' | 'omdb' | 'fanart') => {
    setVerifyingKeys(which);
    setKeyVerifyMsg(null);
    const provId =
      which === 'tmdb' ? 'prov-tmdb' : which === 'omdb' ? 'prov-omdb' : 'prov-fanart';
    onUpdatePingStatuses((prev) => ({
      ...prev,
      [provId]: { state: 'checking' },
    }));

    const targetProv = apiProviders.find((p) => p.id === provId) || {
      id: provId,
      name: which === 'fanart' ? 'Fanart.tv' : which.toUpperCase(),
      category: which === 'fanart' ? 'Artwork' : 'Video',
      method: 'GET' as const,
      url:
        which === 'tmdb'
          ? 'https://api.themoviedb.org/3/configuration?api_key={{tmdbKey}}'
          : which === 'omdb'
          ? 'https://www.omdbapi.com/?apikey={{omdbKey}}&t=Dune'
          : 'https://webservice.fanart.tv/v3.2/movies/550?api_key={{fanartKey}}&client_key={{fanartClientKey}}',
      headers: { Accept: 'application/json' },
      body: '',
      mappings: { titulo: '', poster_url: '', sinopsis: '', rating: '', generos: '', anio: '' },
      requiresKey: which,
    };

    const res = await pingApiProvider(targetProv, config);
    setVerifyingKeys(null);

    onUpdatePingStatuses((prev) => ({
      ...prev,
      [provId]: {
        state: res.ok ? 'connected' : 'disconnected',
        status: res.status,
        latencyMs: res.latencyMs,
        detail: res.detail,
        checkedAt: Date.now(),
      },
    }));

    if (res.ok) {
      const msg = `✔ ${which.toUpperCase()} conectado (${res.detail})`;
      setKeyVerifyMsg(msg);
      onToast(msg, 'success');
    } else {
      const msg = `✕ ${which.toUpperCase()} desconectado: ${res.detail}`;
      setKeyVerifyMsg(msg);
      onToast(msg, 'error');
    }
  };

  const handlePingSingleProvider = async (prov: ApiProviderConfig) => {
    onUpdatePingStatuses((prev) => ({
      ...prev,
      [prov.id]: { state: 'checking' },
    }));
    const res = await pingApiProvider(prov, config);
    onUpdatePingStatuses((prev) => ({
      ...prev,
      [prov.id]: {
        state: res.ok ? 'connected' : 'disconnected',
        status: res.status,
        latencyMs: res.latencyMs,
        detail: res.detail,
        checkedAt: Date.now(),
      },
    }));
    if (res.ok) {
      onToast(`${prov.name}: Conectado (${res.detail})`, 'success');
    } else {
      onToast(`${prov.name}: Desconectado (${res.detail})`, 'warning');
    }
  };

  const handleVerifyConfiguredConnections = async (pingAll = false) => {
    const configured = apiProviders.filter((p) => isApiProviderConnected(p, config));
    const targets = pingAll || configured.length === 0 ? apiProviders : configured;
    if (targets.length === 0) return;

    setPingingBatch(true);
    onUpdatePingStatuses((prev) => {
      const next = { ...prev };
      for (const p of targets) {
        next[p.id] = { state: 'checking' };
      }
      return next;
    });

    let okCount = 0;
    let failCount = 0;

    await Promise.all(
      targets.map(async (prov) => {
        const res = await pingApiProvider(prov, config);
        if (res.ok) okCount += 1;
        else failCount += 1;
        onUpdatePingStatuses((prev) => ({
          ...prev,
          [prov.id]: {
            state: res.ok ? 'connected' : 'disconnected',
            status: res.status,
            latencyMs: res.latencyMs,
            detail: res.detail,
            checkedAt: Date.now(),
          },
        }));
      })
    );

    setPingingBatch(false);
    onToast(
      `Verificación completada: ${okCount} conectado(s), ${failCount} desconectado(s)`,
      failCount === 0 ? 'success' : okCount > 0 ? 'warning' : 'error'
    );
  };

  const handleVerifyImgHost = async () => {
    setVerifyingHost(true);
    setHostVerifyMsg(null);
    const res = await verifyImageHost({
      provider: config.imgHostProvider,
      apiKey: config.imgHostKey,
      endpoint: config.imgHostEndpoint,
    });
    setVerifyingHost(false);
    if (res.ok) {
      const msg = `✔ HTTP ${res.status} (${res.latencyMs} ms) · ${res.details || 'Conectado'}`;
      setHostVerifyMsg({ ok: true, text: msg });
      onToast(`Host de imágenes verificado (${res.latencyMs} ms)`, 'success');
    } else {
      const msg = `✕ ${res.error || 'Error de verificación'}`;
      setHostVerifyMsg({ ok: false, text: msg });
      onToast(res.error || 'Error al verificar host de imágenes', 'error');
    }
  };

  const handleAddMiniBtn = () => {
    if (!newLabel.trim() || !newOpen.trim()) return;
    onUpdateMiniMenu([...miniMenuTools, { label: newLabel.trim(), open: newOpen.trim(), close: newClose.trim() }]);
    setNewLabel('');
    setNewOpen('');
    setNewClose('');
    onToast(`Botón "${newLabel.trim()}" añadido y guardado`, 'success');
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="anim-enter bg-panel border border-cyberCyan/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/60 flex items-center justify-center text-cyberCyan font-bold text-sm">
              ⚙
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">Configuración General de PostPro Studio</h3>
              <p className="text-[11px] text-slate-400">
                Guardado automático en tu navegador · Navegador de archivos · Verificación HTTP
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex bg-void border-b border-cyberBorder px-5 pt-2 gap-1.5 text-xs font-semibold shrink-0 overflow-x-auto">
          <button
            onClick={() => setTab('paths')}
            className={`px-3.5 py-2 rounded-t-lg cursor-pointer shrink-0 ${
              tab === 'paths'
                ? 'bg-panel text-cyberCyan border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🛠 Rutas, APIs & Keys
          </button>
          <button
            onClick={() => setTab('imghost')}
            className={`px-3.5 py-2 rounded-t-lg cursor-pointer shrink-0 ${
              tab === 'imghost'
                ? 'bg-panel text-cyberCyan border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🖼️ Host de Imágenes
          </button>
          <button
            onClick={() => setTab('minimenu')}
            className={`px-3.5 py-2 rounded-t-lg cursor-pointer shrink-0 whitespace-nowrap ${
              tab === 'minimenu'
                ? 'bg-panel text-cyberCyan border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ✎ Mini Menú Flotante
          </button>
          <button
            onClick={() => setTab('backups')}
            className={`px-3.5 py-2 rounded-t-lg cursor-pointer shrink-0 whitespace-nowrap tabular-nums ${
              tab === 'backups'
                ? 'bg-panel text-cyberCyan border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            💾 Backups ({incrementalBackups.length})
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {tab === 'paths' && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  CARPETA DE MEDIOS LOCALES ({config.mediaFilesIndex?.length || 0} archivos indexados):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.mediaFolderLinked || ''}
                    onChange={(e) => onUpdateConfig({ mediaFolderLinked: e.target.value })}
                    placeholder="Selecciona tu carpeta de películas/música..."
                    className="flex-1 bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                  />
                  <button
                    onClick={() => handleBrowseFolder('media')}
                    className="px-3 py-2 rounded-lg bg-elevated hover:bg-void border border-cyberCyan/50 text-cyberCyan font-bold cursor-pointer shrink-0"
                  >
                    📂 Examinar...
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  CARPETA DE PLANTILLAS BBCODE (.JSON):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.templatesPath}
                    onChange={(e) => onUpdateConfig({ templatesPath: e.target.value })}
                    placeholder="Carpeta con archivos .json..."
                    className="flex-1 bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                  />
                  <button
                    onClick={() => handleBrowseFolder('templates')}
                    className="px-3 py-2 rounded-lg bg-elevated hover:bg-void border border-cyberBorder text-slate-200 font-semibold cursor-pointer shrink-0"
                  >
                    📂 Examinar...
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">BINARIO FFMPEG:</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={config.ffmpegPath}
                      onChange={(e) => onUpdateConfig({ ffmpegPath: e.target.value })}
                      placeholder="ffmpeg.exe"
                      className="flex-1 min-w-0 bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                    />
                    <button
                      onClick={() => handleBrowseBinary('ffmpeg')}
                      className="px-2.5 py-2 rounded-lg bg-elevated border border-cyberBorder text-slate-200 cursor-pointer shrink-0"
                    >
                      📁
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">BINARIO MEDIAINFO:</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={config.mediainfoPath}
                      onChange={(e) => onUpdateConfig({ mediainfoPath: e.target.value })}
                      placeholder="MediaInfo.exe"
                      className="flex-1 min-w-0 bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                    />
                    <button
                      onClick={() => handleBrowseBinary('mediainfo')}
                      className="px-2.5 py-2 rounded-lg bg-elevated border border-cyberBorder text-slate-200 cursor-pointer shrink-0"
                    >
                      📁
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-void/80 border border-cyberBorder rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold text-slate-100">
                      ↩ Historial de Deshacer (Ctrl+Z)
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Número máximo de pasos almacenados para deshacer cambios en documentos (predeterminado: 10).
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={config.undoHistoryLimit ?? 10}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const clamped = Number.isNaN(raw)
                          ? 10
                          : Math.max(1, Math.min(100, Math.round(raw)));
                        onUpdateConfig({ undoHistoryLimit: clamped });
                      }}
                      className="w-16 bg-panel text-cyberCyan font-mono text-xs font-bold text-center rounded-lg px-2 py-1 border border-cyberBorder focus:outline-none focus:border-cyberCyan tabular-nums"
                    />
                    <span className="text-[10px] font-mono text-slate-400">pasos</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {[5, 10, 20, 30, 50].map((preset) => {
                    const active = (config.undoHistoryLimit ?? 10) === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onUpdateConfig({ undoHistoryLimit: preset })}
                        className={`px-2 py-0.5 rounded font-mono text-[10px] cursor-pointer border transition-colors ${
                          active
                            ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan font-bold'
                            : 'bg-panel border-cyberBorder text-slate-300 hover:border-cyberCyan/60'
                        }`}
                      >
                        {preset === 10 ? '10 ★' : preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">TMDB API KEY (V3):</label>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={config.tmdbApiKey}
                      onChange={(e) => onUpdateConfig({ tmdbApiKey: e.target.value })}
                      placeholder="Tu API Key de TMDB..."
                      className="flex-1 min-w-0 bg-void text-cyberCyan font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                    />
                    <button
                      onClick={() => handleVerifyKey('tmdb')}
                      disabled={verifyingKeys === 'tmdb'}
                      className="px-2.5 py-2 rounded-lg bg-void hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer shrink-0"
                    >
                      {verifyingKeys === 'tmdb' ? '...' : 'Verificar'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">OMDB / IMDB API KEY:</label>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={config.omdbApiKey}
                      onChange={(e) => onUpdateConfig({ omdbApiKey: e.target.value })}
                      placeholder="Tu API Key de OMDb..."
                      className="flex-1 min-w-0 bg-void text-cyberMagenta font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                    />
                    <button
                      onClick={() => handleVerifyKey('omdb')}
                      disabled={verifyingKeys === 'omdb'}
                      className="px-2.5 py-2 rounded-lg bg-void hover:bg-elevated border border-cyberMagenta/50 text-cyberMagenta font-mono text-[10px] font-bold cursor-pointer shrink-0"
                    >
                      {verifyingKeys === 'omdb' ? '...' : 'Verificar'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    FANART.TV API KEY (V3.2 · Logos/Banners/ClearArt):
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={config.fanartApiKey}
                      onChange={(e) => onUpdateConfig({ fanartApiKey: e.target.value })}
                      placeholder="Project API Key de Fanart.tv..."
                      className="flex-1 min-w-0 bg-void text-cyberGreen font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                    />
                    <button
                      onClick={() => handleVerifyKey('fanart')}
                      disabled={verifyingKeys === 'fanart'}
                      className="px-2.5 py-2 rounded-lg bg-void hover:bg-elevated border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer shrink-0"
                    >
                      {verifyingKeys === 'fanart' ? '...' : 'Verificar'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    FANART.TV CLIENT KEY (Opcional · Personal):
                  </label>
                  <input
                    type="password"
                    value={config.fanartClientKey}
                    onChange={(e) => onUpdateConfig({ fanartClientKey: e.target.value })}
                    placeholder="Client Key personal de Fanart.tv..."
                    className="w-full bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  YOUTUBE DATA API V3 KEY (Opcional · El buscador de trailers también funciona sin clave):
                </label>
                <input
                  type="password"
                  value={config.youtubeApiKey || ''}
                  onChange={(e) => onUpdateConfig({ youtubeApiKey: e.target.value })}
                  placeholder="AIza... (Opcional para cuota dedicada)"
                  className="w-full bg-void text-red-300 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                />
              </div>

              {keyVerifyMsg && (
                <div className="bg-void border border-cyberBorder rounded-lg px-3 py-2 font-mono text-[11px] text-slate-200">
                  {keyVerifyMsg}
                </div>
              )}

              <div className="bg-void/90 border border-cyberBorder rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                  <div>
                    <div className="font-bold text-white flex items-center gap-2">
                      <span>Proveedores de APIs y Verificación de Conexión</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Realiza llamadas de prueba (ping) a tus proveedores configurados para comprobar si están conectados o desconectados.
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200 font-mono text-[11px] shrink-0">
                    <input
                      type="checkbox"
                      checked={config.autoEnrichOnDrop}
                      onChange={(e) => onUpdateConfig({ autoEnrichOnDrop: e.target.checked })}
                      className="accent-cyan-400 w-4 h-4 rounded"
                    />
                    <span>Automatizar al soltar</span>
                  </label>
                </div>

                {/* Barra de Verificación de Conexión (Ping) */}
                {(() => {
                  const connectedCount = apiProviders.filter(
                    (p) => apiPingStatuses[p.id]?.state === 'connected'
                  ).length;
                  const disconnectedCount = apiProviders.filter(
                    (p) => apiPingStatuses[p.id]?.state === 'disconnected'
                  ).length;
                  const configuredCount = apiProviders.filter((p) =>
                    isApiProviderConnected(p, config)
                  ).length;

                  return (
                    <div className="bg-panel border border-cyberBorder rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums">
                        <span className="text-slate-300">
                          Configurados: <strong className="text-white">{configuredCount}/{apiProviders.length}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-cyberGreen">
                          <span className="w-2 h-2 rounded-full bg-cyberGreen" />
                          <span>{connectedCount} Conectado{connectedCount === 1 ? '' : 's'}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-red-400">
                          <span className="w-2 h-2 rounded-full bg-red-500" />
                          <span>{disconnectedCount} Desconectado{disconnectedCount === 1 ? '' : 's'}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleVerifyConfiguredConnections(false)}
                          disabled={pingingBatch}
                          className="neon-btn-cyan px-3 py-1 rounded-lg font-extrabold text-[11px] cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          {pingingBatch
                            ? '⏳ Haciendo ping...'
                            : configuredCount > 0
                            ? '⚡ Verificar Conexión'
                            : '⚡ Verificar Conexión (Todos)'}
                        </button>
                        {configuredCount > 0 && configuredCount < apiProviders.length && (
                          <button
                            type="button"
                            onClick={() => handleVerifyConfiguredConnections(true)}
                            disabled={pingingBatch}
                            className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                          >
                            📡 Ping a Todos
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                  {apiProviders.map((prov) => {
                    const connected = isApiProviderConnected(prov, config);
                    const needsKey =
                      prov.requiresKey === 'tmdb' ||
                      prov.requiresKey === 'omdb' ||
                      prov.requiresKey === 'fanart';
                    const ping = apiPingStatuses[prov.id];

                    return (
                      <div
                        key={prov.id}
                        className="bg-panel border border-cyberBorder rounded-lg p-2.5 flex flex-col gap-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold text-slate-100 truncate">
                              {prov.name}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 truncate">
                              {prov.category} · {needsKey ? 'Requiere Key arriba' : 'Pública'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handlePingSingleProvider(prov)}
                              disabled={ping?.state === 'checking' || pingingBatch}
                              title="Enviar llamada de prueba (Ping) a este proveedor"
                              className="px-2 py-0.5 rounded bg-void hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              {ping?.state === 'checking' ? '⏳' : 'Ping'}
                            </button>
                            {needsKey ? (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                  connected
                                    ? 'bg-cyberGreen/10 border-cyberGreen/40 text-cyberGreen'
                                    : 'bg-void border-cyberBorder text-slate-500'
                                }`}
                              >
                                {connected ? 'Key OK' : 'Sin Key'}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const current = config.connectedApiIds || [];
                                  const next = connected
                                    ? current.filter((id) => id !== prov.id)
                                    : [...current, prov.id];
                                  onUpdateConfig({ connectedApiIds: next });
                                }}
                                className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold cursor-pointer border ${
                                  connected
                                    ? 'bg-cyberGreen/15 border-cyberGreen text-cyberGreen'
                                    : 'bg-void border-cyberBorder text-slate-300 hover:border-cyberCyan'
                                }`}
                              >
                                {connected ? '✔ Activa' : 'Activar'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Indicador visual de estado (Conectado / Desconectado) */}
                        <div className="pt-1 border-t border-cyberBorder/50 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                          {ping?.state === 'checking' ? (
                            <span className="inline-flex items-center gap-1.5 text-cyberCyan font-bold">
                              <span className="w-2 h-2 rounded-full bg-cyberCyan animate-pulse shrink-0" />
                              <span>Haciendo ping...</span>
                            </span>
                          ) : ping?.state === 'connected' ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-cyberGreen font-bold shrink-0">
                                <span className="w-2 h-2 rounded-full bg-cyberGreen shadow-[0_0_6px_#00ff9d] shrink-0" />
                                <span>Conectado</span>
                              </span>
                              <span className="text-slate-300 truncate">{ping.detail}</span>
                            </>
                          ) : ping?.state === 'disconnected' ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 text-red-400 font-bold shrink-0">
                                <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_#ef4444] shrink-0" />
                                <span>Desconectado</span>
                              </span>
                              <span className="text-red-300/90 truncate" title={ping.detail}>
                                {ping.detail}
                              </span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-slate-500">
                              <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                              <span>Sin verificar (pulsa Ping)</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={onExportBackup}
                    className="px-3 py-1.5 rounded-lg bg-void hover:bg-elevated border border-cyberBorder text-slate-200 font-mono text-[11px] cursor-pointer"
                  >
                    ⬇ Exportar Config (.json)
                  </button>
                  <label className="px-3 py-1.5 rounded-lg bg-void hover:bg-elevated border border-cyberBorder text-slate-200 font-mono text-[11px] cursor-pointer">
                    ⬆ Importar Config (.json)
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        if (f) onImportBackup(f);
                      }}
                    />
                  </label>
                </div>
                <button
                  onClick={onResetAll}
                  className="px-3 py-1.5 rounded-lg bg-void hover:bg-red-950/60 border border-red-500/40 text-red-400 font-mono text-[11px] cursor-pointer"
                >
                  ↺ Restablecer Todo
                </button>
              </div>
            </div>
          )}

          {tab === 'imghost' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-void border border-cyberBorder rounded-xl p-3">
                <div>
                  <div className="font-bold text-white">Servidor Activo de Alojamiento de Imágenes</div>
                  <div className="text-[11px] text-slate-400">
                    Verificación y subida directa desde el backend de PostPro.
                  </div>
                </div>
                {verifyingHost ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-cyberCyan">
                    <span className="w-2 h-2 rounded-full bg-cyberCyan animate-pulse" />
                    <span>Haciendo ping...</span>
                  </span>
                ) : hostVerifyMsg ? (
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-bold tabular-nums ${
                      hostVerifyMsg.ok ? 'text-cyberGreen' : 'text-red-400'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        hostVerifyMsg.ok
                          ? 'bg-cyberGreen shadow-[0_0_6px_#00ff9d]'
                          : 'bg-red-500 shadow-[0_0_6px_#ef4444]'
                      }`}
                    />
                    <span>{hostVerifyMsg.ok ? 'Conectado' : 'Desconectado'} · {hostVerifyMsg.text}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
                    <span className="w-2 h-2 rounded-full bg-slate-600" />
                    <span>Sin verificar</span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">PROVEEDOR DE HOST:</label>
                  <select
                    value={config.imgHostProvider}
                    onChange={(e) => {
                      setHostVerifyMsg(null);
                      onUpdateConfig({ imgHostProvider: e.target.value as ImageHostProvider });
                    }}
                    className="w-full bg-void text-cyberCyan font-semibold rounded-lg px-3 py-2 border border-cyberBorder cursor-pointer"
                  >
                    <option value="imgbb">ImgBB API v1</option>
                    <option value="freeimage">Freeimage.host API</option>
                    <option value="imgur">Imgur API v3 (Client-ID)</option>
                    <option value="postimages">Postimages API</option>
                    <option value="chevereto">Servidor Chevereto / Custom API</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">API KEY / CLIENT ID:</label>
                  <input
                    type="password"
                    value={config.imgHostKey}
                    onChange={(e) => {
                      setHostVerifyMsg(null);
                      onUpdateConfig({ imgHostKey: e.target.value });
                    }}
                    placeholder="Pega tu API Key..."
                    className="w-full bg-void text-slate-100 font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    FORMATO DE INSERCIÓN BBCODE:
                  </label>
                  <select
                    value={config.imgHostFormat}
                    onChange={(e) =>
                      onUpdateConfig({ imgHostFormat: e.target.value as 'direct' | 'thumb' })
                    }
                    className="w-full bg-void text-slate-200 font-mono rounded-lg px-3 py-2 border border-cyberBorder cursor-pointer"
                  >
                    <option value="direct">[img]URL directa[/img]</option>
                    <option value="thumb">[url=full][img]thumb[/img][/url]</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">EXPIRACIÓN AUTOMÁTICA:</label>
                  <select
                    value={config.imgHostExpire}
                    onChange={(e) =>
                      onUpdateConfig({ imgHostExpire: e.target.value as UserConfig['imgHostExpire'] })
                    }
                    className="w-full bg-void text-slate-200 font-mono rounded-lg px-3 py-2 border border-cyberBorder cursor-pointer"
                  >
                    <option value="never">Sin expiración (Permanente)</option>
                    <option value="24h">24 horas</option>
                    <option value="7d">7 días</option>
                    <option value="30d">30 días</option>
                  </select>
                </div>
              </div>

              {config.imgHostProvider === 'chevereto' && (
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    ENDPOINT URL (CHEVERETO / CUSTOM API):
                  </label>
                  <input
                    type="text"
                    value={config.imgHostEndpoint}
                    onChange={(e) => onUpdateConfig({ imgHostEndpoint: e.target.value })}
                    placeholder="https://tu-servidor-chevereto.com/api/1/upload"
                    className="w-full bg-void text-cyberMagenta font-mono rounded-lg px-3 py-2 border border-cyberBorder"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={config.autoUploadCovers}
                    onChange={(e) => onUpdateConfig({ autoUploadCovers: e.target.checked })}
                    className="accent-cyan-400 w-4 h-4 rounded"
                  />
                  <span>Subir automáticamente covers y capturas al soltar archivos</span>
                </label>
                <button
                  onClick={handleVerifyImgHost}
                  disabled={verifyingHost}
                  className="px-4 py-2 rounded-xl bg-void hover:bg-elevated border border-cyberGreen/60 text-cyberGreen font-extrabold text-xs cursor-pointer disabled:opacity-50"
                >
                  {verifyingHost ? '⏳ Verificando HTTP...' : '⚡ Verificar Conexión'}
                </button>
              </div>

              <div className="bg-void border border-cyberBorder rounded-xl p-3.5 space-y-3 mt-2">
                <div>
                  <div className="font-bold text-white text-xs">
                    Marca de Agua predeterminada (Usuario o Lugar de Posteo)
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Estos valores aparecerán pre-rellenados cada vez que PostPro te pregunte si deseas aplicar marca de agua antes de subir imágenes al host.
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">USUARIO / NICK:</label>
                    <input
                      type="text"
                      value={config.watermarkUser}
                      onChange={(e) => onUpdateConfig({ watermarkUser: e.target.value })}
                      placeholder="Ej. @Aensy77"
                      className="w-full bg-panel text-slate-100 font-mono rounded-lg px-3 py-1.5 border border-cyberBorder"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">LUGAR DE POSTEO:</label>
                    <input
                      type="text"
                      value={config.watermarkPlace}
                      onChange={(e) => onUpdateConfig({ watermarkPlace: e.target.value })}
                      placeholder="Ej. MiForo.net / BlogHD"
                      className="w-full bg-panel text-slate-100 font-mono rounded-lg px-3 py-1.5 border border-cyberBorder"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">POSICIÓN:</label>
                    <select
                      value={config.watermarkPosition}
                      onChange={(e) =>
                        onUpdateConfig({ watermarkPosition: e.target.value as WatermarkPosition })
                      }
                      className="w-full bg-panel text-slate-200 font-mono rounded-lg px-3 py-1.5 border border-cyberBorder cursor-pointer"
                    >
                      {(Object.keys(WATERMARK_POSITION_LABELS) as WatermarkPosition[]).map((pos) => (
                        <option key={pos} value={pos}>
                          {WATERMARK_POSITION_LABELS[pos]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        OPACIDAD ({Math.round(config.watermarkOpacity * 100)}%):
                      </label>
                      <input
                        type="range"
                        min={0.15}
                        max={1}
                        step={0.05}
                        value={config.watermarkOpacity}
                        onChange={(e) =>
                          onUpdateConfig({ watermarkOpacity: parseFloat(e.target.value) })
                        }
                        className="w-full accent-cyan-400 cursor-pointer mt-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">COLOR Y TAMAÑO:</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={config.watermarkColor}
                          onChange={(e) => onUpdateConfig({ watermarkColor: e.target.value })}
                          className="w-8 h-8 rounded bg-panel border border-cyberBorder cursor-pointer p-0.5 shrink-0"
                        />
                        <select
                          value={config.watermarkScale}
                          onChange={(e) =>
                            onUpdateConfig({
                              watermarkScale: e.target.value as UserConfig['watermarkScale'],
                            })
                          }
                          className="flex-1 bg-panel text-slate-200 font-mono text-[11px] rounded-lg px-2 py-1.5 border border-cyberBorder cursor-pointer"
                        >
                          <option value="sm">Pequeño</option>
                          <option value="md">Medio</option>
                          <option value="lg">Grande</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-void border border-cyberCyan/40 rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-white text-xs">
                      ⚡ Optimizador de Capturas
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Configura cuántas capturas se extraen a resolución nativa de video y el porcentaje de compresión aplicado al generar o reemplazar el BBCode de capturas.
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-panel border border-cyberBorder font-mono text-[10px] text-cyberCyan font-bold tabular-nums shrink-0">
                    {config.captureCount || 6} capturas · {config.captureCompressionPercent ?? 25}% comp.
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-cyberBorder/60">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-mono text-slate-400">
                      NÚMERO DE CAPTURAS A EXTRAER (POR DEFECTO 6):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={config.captureCount ?? 6}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const clamped = Number.isFinite(parsed)
                            ? Math.max(1, Math.min(16, Math.round(parsed)))
                            : 6;
                          onUpdateConfig({ captureCount: clamped });
                        }}
                        className="w-20 bg-panel text-cyberCyan font-mono font-bold text-xs rounded-lg px-2.5 py-1.5 border border-cyberBorder tabular-nums"
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        {[4, 6, 8, 10, 12].map((preset) => {
                          const isActive = (config.captureCount ?? 6) === preset;
                          return (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => onUpdateConfig({ captureCount: preset })}
                              className={`px-2 py-1 rounded font-mono text-[10px] font-bold border cursor-pointer tabular-nums ${
                                isActive
                                  ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan'
                                  : 'bg-panel border-cyberBorder text-slate-300 hover:border-cyberCyan/60'
                              }`}
                            >
                              {preset}
                              {preset === 6 ? ' ★' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-[10px] font-mono text-slate-400">
                        PORCENTAJE DE COMPRESIÓN (REEMPLAZO Y BBCODE):
                      </label>
                      <span className="font-mono text-[10px] font-bold text-cyberGreen tabular-nums">
                        {config.captureCompressionPercent ?? 25}% (Calidad{' '}
                        {100 - (config.captureCompressionPercent ?? 25)}%)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={75}
                      step={5}
                      value={config.captureCompressionPercent ?? 25}
                      onChange={(e) =>
                        onUpdateConfig({ captureCompressionPercent: Number(e.target.value) })
                      }
                      className="w-full accent-cyan-400 cursor-pointer mt-1"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-slate-500 tabular-nums">
                      <span>5% (Máx. calidad)</span>
                      <span>25% (Recomendado)</span>
                      <span>75% (Máx. ahorro)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'minimenu' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-void border border-cyberBorder rounded-xl p-3">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Etiqueta (ej. H1)"
                  className="bg-panel text-white rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                />
                <input
                  type="text"
                  value={newOpen}
                  onChange={(e) => setNewOpen(e.target.value)}
                  placeholder="Apertura (ej. [size=22][b])"
                  className="bg-panel text-cyberCyan font-mono rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                />
                <input
                  type="text"
                  value={newClose}
                  onChange={(e) => setNewClose(e.target.value)}
                  placeholder="Cierre (ej. [/b][/size])"
                  className="bg-panel text-cyberMagenta font-mono rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                />
                <button onClick={handleAddMiniBtn} className="neon-btn-cyan rounded-lg font-extrabold py-1.5 cursor-pointer">
                  + Añadir Botón
                </button>
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {miniMenuTools.map((t, idx) => (
                  <div
                    key={`${t.label}-${idx}`}
                    className="flex items-center justify-between bg-void border border-cyberBorder rounded-lg px-2.5 py-1.5"
                  >
                    <div className="font-mono text-[11px]">
                      <span className="font-bold text-white">{t.label}</span>
                      <span className="text-slate-500 ml-2">
                        {t.open === '__MODAL_SPOILER_LINKS__' ? '[Ventana Spoiler Links]' : `${t.open}...${t.close}`}
                      </span>
                    </div>
                    <button
                      onClick={() => onUpdateMiniMenu(miniMenuTools.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-300 text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'backups' && (() => {
            const fullCount = incrementalBackups.filter((b) => b.kind === 'full').length;
            const deltaCount = incrementalBackups.filter((b) => b.kind === 'delta').length;
            const storedBytes = incrementalBackups.reduce((acc, b) => acc + b.deltaBytes, 0);
            const equivalentFullBytes = incrementalBackups.reduce((acc, b) => acc + b.fullBytes, 0);
            const savedPct =
              equivalentFullBytes > 0 && storedBytes < equivalentFullBytes
                ? Math.round(((equivalentFullBytes - storedBytes) / equivalentFullBytes) * 100)
                : 0;

            const remainingMs =
              config.autoBackupEnabled && nextBackupAt ? Math.max(0, nextBackupAt - countdownNow) : 0;
            const remMins = Math.floor(remainingMs / 60000);
            const remSecs = Math.floor((remainingMs % 60000) / 1000);
            const countdownLabel = config.autoBackupEnabled
              ? `${String(remMins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`
              : 'Pausado';

            return (
              <div className="space-y-3">
                {/* Panel de programación automática */}
                <div className="bg-void border border-cyberBorder rounded-xl p-3.5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-white text-xs">
                        Copia de Seguridad Incremental Automática (cada {config.autoBackupIntervalMinutes || 10} min)
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Guarda únicamente los documentos y secciones modificados entre intervalos en tu bóveda local IndexedDB, y opcionalmente en carpeta de disco o endpoint remoto.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer font-mono text-[11px] text-slate-200 shrink-0">
                      <input
                        type="checkbox"
                        checked={config.autoBackupEnabled}
                        onChange={(e) => onUpdateConfig({ autoBackupEnabled: e.target.checked })}
                        className="accent-cyan-400 w-4 h-4 rounded"
                      />
                      <span>{config.autoBackupEnabled ? 'Activo' : 'Desactivado'}</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 border-t border-cyberBorder/60">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        INTERVALO AUTOMÁTICO:
                      </label>
                      <select
                        value={config.autoBackupIntervalMinutes || 10}
                        onChange={(e) =>
                          onUpdateConfig({ autoBackupIntervalMinutes: Number(e.target.value) || 10 })
                        }
                        className="w-full bg-panel text-cyberCyan font-mono text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder cursor-pointer"
                      >
                        <option value={5}>Cada 5 minutos</option>
                        <option value={10}>Cada 10 minutos (Recomendado)</option>
                        <option value={15}>Cada 15 minutos</option>
                        <option value={30}>Cada 30 minutos</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        CARPETA LOCAL EN DISCO (OPCIONAL):
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={onLinkLocalBackupFolder}
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-left font-mono text-[11px] text-slate-200 truncate cursor-pointer"
                        >
                          {backupFolderHandleReady
                            ? `📂 ${config.autoBackupFolderName || 'Carpeta vinculada'}`
                            : '📂 Vincular carpeta local...'}
                        </button>
                        {backupFolderHandleReady && (
                          <button
                            type="button"
                            onClick={onUnlinkLocalBackupFolder}
                            title="Desvincular carpeta local"
                            className="px-2 py-1.5 rounded-lg bg-panel hover:bg-red-950/40 border border-cyberBorder hover:border-red-500/60 text-slate-400 hover:text-red-300 font-mono text-[11px] cursor-pointer shrink-0"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        ENDPOINT NUBE / WEBHOOK (OPCIONAL):
                      </label>
                      <input
                        type="url"
                        value={config.autoBackupCloudUrl || ''}
                        onChange={(e) => onUpdateConfig({ autoBackupCloudUrl: e.target.value })}
                        placeholder="https://tu-nube.com/api/backups"
                        className="w-full bg-panel text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                      />
                    </div>
                  </div>

                  {/* Métricas con tabular-nums */}
                  <div className="bg-panel border border-cyberBorder rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                    <div className="flex flex-wrap items-center gap-3 text-slate-300">
                      <span>
                        Próxima copia: <strong className="text-cyberCyan">{countdownLabel}</strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Última:{' '}
                        <strong className="text-white">
                          {lastBackupAt
                            ? new Date(lastBackupAt).toLocaleTimeString('es-ES', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : 'Ninguna'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Cadena: <strong className="text-white">{fullCount}</strong> base /{' '}
                        <strong className="text-cyberGreen">{deltaCount}</strong> inc.
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Uso: <strong className="text-white">{formatBytes(storedBytes)}</strong>
                        {savedPct > 0 ? ` (${savedPct}% ahorro)` : ''}
                      </span>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onTriggerIncrementalBackup(false)}
                        disabled={backupRunning}
                        className="neon-btn-cyan px-3 py-1.5 rounded-lg font-extrabold text-[11px] cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        {backupRunning ? '⏳ Guardando...' : '💾 Crear Copia Incremental'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTriggerIncrementalBackup(true)}
                        disabled={backupRunning}
                        className="px-3 py-1.5 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        🧱 Punto Base Completo
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onExportBackup}
                        className="px-2.5 py-1.5 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder text-slate-200 font-mono text-[11px] cursor-pointer whitespace-nowrap"
                      >
                        ⬇ Exportar (.json)
                      </button>
                      <label className="px-2.5 py-1.5 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder text-slate-200 font-mono text-[11px] cursor-pointer whitespace-nowrap">
                        ⬆ Importar (.json)
                        <input
                          type="file"
                          accept=".json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';
                            if (f) onImportBackup(f);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Historial de copias incrementales */}
                <div className="bg-void border border-cyberBorder rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-panel/80 border-b border-cyberBorder flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-white">
                      Historial de Puntos de Restauración Incremental
                    </span>
                    {incrementalBackups.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearIncrementalBackups}
                        className="text-[10px] font-mono text-slate-400 hover:text-red-300 cursor-pointer whitespace-nowrap"
                      >
                        🗑 Vaciar historial
                      </button>
                    )}
                  </div>

                  {backupsLoading ? (
                    <div className="p-4 space-y-2">
                      <div className="h-9 rounded bg-panel/60 animate-pulse" />
                      <div className="h-9 rounded bg-panel/40 animate-pulse" />
                    </div>
                  ) : incrementalBackups.length === 0 ? (
                    <div className="p-6 text-center space-y-2">
                      <div className="text-xs font-bold text-slate-200">
                        Aún no hay copias incrementales registradas
                      </div>
                      <p className="text-[11px] text-slate-400">
                        El sistema creará automáticamente una copia incremental cada {config.autoBackupIntervalMinutes || 10} minutos mientras editas, o puedes generar la primera ahora.
                      </p>
                      <button
                        type="button"
                        onClick={() => onTriggerIncrementalBackup(true)}
                        disabled={backupRunning}
                        className="neon-btn-cyan px-3.5 py-1.5 rounded-lg font-extrabold text-[11px] cursor-pointer"
                      >
                        💾 Guardar Primer Respaldo Ahora
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto divide-y divide-cyberBorder/60">
                      {incrementalBackups.map((bkp) => {
                        const isFull = bkp.kind === 'full';
                        const reduction =
                          !isFull && bkp.fullBytes > 0
                            ? Math.max(0, Math.round((1 - bkp.deltaBytes / bkp.fullBytes) * 100))
                            : 0;
                        return (
                          <div
                            key={bkp.id}
                            className="px-3.5 py-2 hover:bg-panel/50 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                                <span
                                  className={`font-bold ${
                                    isFull ? 'text-cyberCyan' : 'text-cyberGreen'
                                  }`}
                                >
                                  {isFull ? 'Base Completa' : `Incremental #${bkp.sequence}`}
                                </span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-200">
                                  {new Date(bkp.createdAt).toLocaleString('es-ES', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-400">
                                  {bkp.trigger === 'auto-10m' ? 'Auto 10m' : 'Manual'}
                                </span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-300">
                                  {formatBytes(bkp.deltaBytes)}
                                  {reduction > 0 ? ` (-${reduction}%)` : ''}
                                </span>
                                {bkp.syncedFolderFile && (
                                  <>
                                    <span className="text-slate-500">·</span>
                                    <span className="text-cyberCyan truncate max-w-[160px]" title={bkp.syncedFolderFile}>
                                      Disco ✔
                                    </span>
                                  </>
                                )}
                                {bkp.syncedCloudOk && (
                                  <>
                                    <span className="text-slate-500">·</span>
                                    <span className="text-cyberGreen">Nube ✔</span>
                                  </>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                {bkp.summary}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => onRestoreIncrementalBackup(bkp.id)}
                                className="px-2.5 py-1 rounded bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer whitespace-nowrap"
                              >
                                ↺ Restaurar
                              </button>
                              <button
                                type="button"
                                onClick={() => onDownloadIncrementalBackup(bkp.id)}
                                title="Descargar copia completa reconstruida (.json)"
                                className="px-2 py-1 rounded bg-panel hover:bg-elevated border border-cyberBorder text-slate-200 font-mono text-[10px] cursor-pointer whitespace-nowrap"
                              >
                                ⬇ .json
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteIncrementalBackup(bkp.id)}
                                title="Eliminar punto de restauración"
                                className="px-1.5 py-1 rounded bg-panel hover:bg-red-950/40 border border-cyberBorder hover:border-red-500/60 text-slate-400 hover:text-red-300 font-mono text-[10px] cursor-pointer"
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
              </div>
            );
          })()}
        </div>

        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex items-center justify-between shrink-0">
          <span className="text-[11px] font-mono text-cyberGreen">
            ✔ Guardado automático activo · {APP_INFO.name} v{APP_INFO.version} · {APP_INFO.creator}
          </span>
          <button onClick={onClose} className="neon-btn-cyan px-5 py-2 rounded-xl font-extrabold text-xs cursor-pointer">
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 2: CONECTAR Y PROBAR REALMENTE APIS DE METADATOS
   ============================================================================ */
interface ConnectApiModalProps {
  open: boolean;
  config: UserConfig;
  defaultQuery: string;
  onClose: () => void;
  onUpdateConfig: (patch: Partial<UserConfig>) => void;
  onSaveProvider: (provider: ApiProviderConfig, extracted?: Record<string, string>) => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const API_MODAL_PRESETS: Record<string, Omit<ApiProviderConfig, 'id'>> = {
  anilist: {
    name: 'AniList GraphQL (Anime)',
    category: 'Anime',
    method: 'POST',
    url: 'https://graphql.anilist.co',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(
      {
        query:
          'query($s:String){Media(search:$s,type:ANIME){title{romaji}description(asHtml:false) coverImage{extraLarge} bannerImage averageScore genres seasonYear}}',
        variables: { s: '{{query}}' },
      },
      null,
      2
    ),
    mappings: {
      titulo: '$.data.Media.title.romaji',
      poster_url: '$.data.Media.coverImage.extraLarge',
      banner_url: '$.data.Media.bannerImage',
      sinopsis: '$.data.Media.description',
      rating: '$.data.Media.averageScore',
      generos: '$.data.Media.genres[*]',
      anio: '$.data.Media.seasonYear',
    },
    requiresKey: null,
  },
  tvmaze: {
    name: 'TVMaze API (Series)',
    category: 'Video',
    method: 'GET',
    url: 'https://api.tvmaze.com/singlesearch/shows?q={{query}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.name',
      poster_url: '$.image.original',
      sinopsis: '$.summary',
      rating: '$.rating.average',
      generos: '$.genres[*]',
      anio: '$.premiered',
    },
    requiresKey: null,
  },
  itunes: {
    name: 'iTunes Search API (Música)',
    category: 'Música',
    method: 'GET',
    url: 'https://itunes.apple.com/search?term={{query}}&entity=album&limit=1',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.results[0].collectionName',
      poster_url: '$.results[0].artworkUrl100',
      sinopsis: '$.results[0].copyright',
      rating: '$.results[0].trackCount',
      generos: '$.results[0].primaryGenreName',
      anio: '$.results[0].releaseDate',
    },
    requiresKey: null,
  },
  discogs: {
    name: 'Discogs API (Música)',
    category: 'Música',
    method: 'GET',
    url: 'https://api.discogs.com/database/search?q={{query}}&type=release',
    headers: { Authorization: 'Discogs token=TU_TOKEN_AQUI', 'User-Agent': 'PostProStudio/1.1' },
    body: '',
    mappings: {
      titulo: '$.results[0].title',
      poster_url: '$.results[0].cover_image',
      sinopsis: '$.results[0].label[0]',
      rating: '$.results[0].community.have',
      generos: '$.results[0].genre[*]',
      anio: '$.results[0].year',
    },
    requiresKey: 'custom',
  },
  rawg: {
    name: 'RAWG API (Juegos)',
    category: 'Juegos',
    method: 'GET',
    url: 'https://api.rawg.io/api/games?key=TU_API_KEY&search={{query}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.results[0].name',
      poster_url: '$.results[0].background_image',
      sinopsis: '$.results[0].slug',
      rating: '$.results[0].metacritic',
      generos: '$.results[0].genres[*].name',
      anio: '$.results[0].released',
    },
    requiresKey: 'custom',
  },
  fanart: {
    name: 'Fanart.tv v3.2 (Movies / TV / Music)',
    category: 'Artwork',
    method: 'GET',
    url: 'https://webservice.fanart.tv/v3.2/movies/{{query}}?api_key={{fanartKey}}&client_key={{fanartClientKey}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.name',
      logo_url: '$.hdmovielogo[0].url',
      banner_url: '$.moviebanner[0].url',
      clearart_url: '$.hdmovieclearart[0].url',
      background_url: '$.moviebackground[0].url',
      poster_url: '$.movieposter[0].url',
      rating: '',
      generos: '',
      anio: '',
      sinopsis: '',
    },
    requiresKey: 'fanart',
  },
};

export const ConnectApiModal: React.FC<ConnectApiModalProps> = ({
  open,
  config,
  defaultQuery,
  onClose,
  onUpdateConfig,
  onSaveProvider,
  onToast,
}) => {
  const [name, setName] = useState(API_MODAL_PRESETS.anilist.name);
  const [category, setCategory] = useState(API_MODAL_PRESETS.anilist.category);
  const [method, setMethod] = useState<'GET' | 'POST'>(API_MODAL_PRESETS.anilist.method);
  const [url, setUrl] = useState(API_MODAL_PRESETS.anilist.url);
  const [headersStr, setHeadersStr] = useState(JSON.stringify(API_MODAL_PRESETS.anilist.headers, null, 2));
  const [bodyStr, setBodyStr] = useState(API_MODAL_PRESETS.anilist.body);
  const [mappings, setMappings] = useState(API_MODAL_PRESETS.anilist.mappings);
  const [requiresKey, setRequiresKey] = useState<ApiProviderConfig['requiresKey']>(
    API_MODAL_PRESETS.anilist.requiresKey ?? null
  );
  const [testQuery, setTestQuery] = useState(defaultQuery || 'Frieren');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiVerificationResult | null>(null);
  const [fanartKeyDraft, setFanartKeyDraft] = useState(config.fanartApiKey || '');
  const [fanartClientKeyDraft, setFanartClientKeyDraft] = useState(config.fanartClientKey || '');
  const [showFanartKeys, setShowFanartKeys] = useState(false);
  const [testingFanart, setTestingFanart] = useState(false);
  const [fanartStatusMsg, setFanartStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (open) {
      setTestResult(null);
      setFanartStatusMsg(null);
      setFanartKeyDraft(config.fanartApiKey || '');
      setFanartClientKeyDraft(config.fanartClientKey || '');
      if (defaultQuery) setTestQuery(defaultQuery);
    }
  }, [open, defaultQuery, config.fanartApiKey, config.fanartClientKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const applyPreset = (key: string) => {
    const p = API_MODAL_PRESETS[key];
    if (!p) return;
    setName(p.name);
    setCategory(p.category);
    setMethod(p.method);
    setUrl(p.url);
    setHeadersStr(JSON.stringify(p.headers, null, 2));
    setBodyStr(p.body);
    setMappings(p.mappings);
    setRequiresKey(p.requiresKey ?? null);
    setTestResult(null);
    if (key === 'anilist') setTestQuery('Frieren');
    else if (key === 'tvmaze') setTestQuery('Severance');
    else if (key === 'itunes' || key === 'discogs') setTestQuery('Daft Punk Random Access Memories');
    else if (key === 'fanart') setTestQuery('1311031');
  };

  const buildCurrentConfig = (): ApiProviderConfig | null => {
    let parsedHeaders: Record<string, string> = {};
    try {
      parsedHeaders = headersStr.trim() ? JSON.parse(headersStr) : {};
    } catch {
      onToast('El campo Headers JSON tiene un error de sintaxis.', 'error');
      return null;
    }
    return {
      id: `prov-${Date.now()}`,
      name: name.trim() || 'API Custom',
      category,
      method,
      url: url.trim(),
      headers: parsedHeaders,
      body: bodyStr,
      mappings,
      requiresKey,
    };
  };

  const getEffectiveConfigWithFanart = (): UserConfig => ({
    ...config,
    fanartApiKey: fanartKeyDraft.trim(),
    fanartClientKey: fanartClientKeyDraft.trim(),
  });

  const handleFanartProjectKeyChange = (val: string) => {
    setFanartKeyDraft(val);
    setFanartStatusMsg(null);
    onUpdateConfig({ fanartApiKey: val });
  };

  const handleFanartPersonalKeyChange = (val: string) => {
    setFanartClientKeyDraft(val);
    setFanartStatusMsg(null);
    onUpdateConfig({ fanartClientKey: val });
  };

  const handleVerifyAndSaveFanart = async () => {
    const cleanApi = fanartKeyDraft.trim();
    const cleanPersonal = fanartClientKeyDraft.trim();
    onUpdateConfig({ fanartApiKey: cleanApi, fanartClientKey: cleanPersonal });
    if (!cleanApi && !cleanPersonal) {
      setFanartStatusMsg({ ok: false, text: 'Ingresa tu API Key de Fanart.tv o Client Key personal.' });
      onToast('Ingresa al menos una API Key de Fanart.tv para verificar.', 'warning');
      return;
    }
    setTestingFanart(true);
    setFanartStatusMsg(null);
    const effective = { ...config, fanartApiKey: cleanApi, fanartClientKey: cleanPersonal };
    const ping = await pingApiProvider(
      {
        id: 'prov-fanart',
        name: 'Fanart.tv v3.2',
        category: 'Artwork',
        method: 'GET',
        url: API_MODAL_PRESETS.fanart.url,
        headers: { Accept: 'application/json' },
        body: '',
        mappings: API_MODAL_PRESETS.fanart.mappings,
        requiresKey: 'fanart',
      },
      effective
    );
    setTestingFanart(false);
    if (ping.ok) {
      setFanartStatusMsg({ ok: true, text: `✔ Conectado y guardado (${ping.detail})` });
      onToast(`Fanart.tv verificado y guardado en configuración global (${ping.detail})`, 'success');
    } else {
      setFanartStatusMsg({ ok: false, text: `✕ ${ping.detail}` });
      onToast(`Fanart.tv: ${ping.detail}`, 'error');
    }
  };

  const handleTestRealApi = async () => {
    const prov = buildCurrentConfig();
    if (!prov) return;
    const effectiveConfig = getEffectiveConfigWithFanart();
    onUpdateConfig({
      fanartApiKey: effectiveConfig.fanartApiKey,
      fanartClientKey: effectiveConfig.fanartClientKey,
    });
    setTesting(true);
    setTestResult(null);
    const res = await executeApiProvider(prov, { query: testQuery }, effectiveConfig, true);
    setTesting(false);
    setTestResult(res);
    if (res.ok) {
      onToast(`API respondió HTTP ${res.status} en ${res.latencyMs} ms`, 'success');
    } else {
      onToast(`Error API (${res.status || 'Red'}): ${res.error}`, 'error');
    }
  };

  const handleSave = () => {
    const prov = buildCurrentConfig();
    if (!prov) return;
    onUpdateConfig({
      fanartApiKey: fanartKeyDraft.trim(),
      fanartClientKey: fanartClientKeyDraft.trim(),
    });
    onSaveProvider(prov, testResult?.ok ? testResult.extracted : undefined);
    onClose();
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="anim-enter bg-panel border border-cyberCyan/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/60 flex items-center justify-center text-cyberCyan font-bold text-sm">
              🔌
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">
                Conectar y Probar API de Metadatos (REST / GraphQL + JSONPath)
              </h3>
              <p className="text-[11px] text-slate-400">
                Ejecuta peticiones HTTP a través del proxy del servidor y extrae campos JSONPath en vivo.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          <div>
            <span className="block text-[10px] font-mono text-slate-400 uppercase mb-1.5">
              PRESETS (1 CLIC):
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => applyPreset('anilist')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono font-bold cursor-pointer"
              >
                🌸 AniList GraphQL (Sin Key)
              </button>
              <button
                onClick={() => applyPreset('tvmaze')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberMagenta/50 text-cyberMagenta font-mono font-bold cursor-pointer"
              >
                📺 TVMaze Series (Sin Key)
              </button>
              <button
                onClick={() => applyPreset('itunes')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberGreen/50 text-cyberGreen font-mono font-bold cursor-pointer"
              >
                🎵 iTunes Álbumes (Sin Key)
              </button>
              <button
                onClick={() => applyPreset('discogs')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberBorder text-slate-200 font-mono cursor-pointer"
              >
                💿 Discogs API
              </button>
              <button
                onClick={() => applyPreset('rawg')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberPurple/50 text-cyberPurple font-mono cursor-pointer"
              >
                🎮 RAWG Juegos
              </button>
              <button
                onClick={() => applyPreset('fanart')}
                className="px-2.5 py-1 rounded-lg bg-void hover:bg-elevated border border-cyberGreen/50 text-cyberGreen font-mono font-bold cursor-pointer"
              >
                🎨 Fanart.tv v3.2 (Artworks)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-5">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">NOMBRE DEL PROVEEDOR:</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-void text-white font-semibold rounded-lg px-3 py-2 border border-cyberBorder"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">CATEGORÍA:</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-void text-slate-200 font-semibold rounded-lg px-2.5 py-2 border border-cyberBorder cursor-pointer"
              >
                <option value="Anime">Anime</option>
                <option value="Video">Video (Películas / Series)</option>
                <option value="Música">Música (Álbumes / FLAC)</option>
                <option value="Artwork">Artwork (Fanart.tv)</option>
                <option value="Juegos">Juegos</option>
                <option value="Todos">Todos</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">MÉTODO HTTP:</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                className="w-full bg-void text-cyberCyan font-mono font-bold rounded-lg px-2.5 py-2 border border-cyberBorder cursor-pointer"
              >
                <option value="POST">POST (GraphQL/JSON)</option>
                <option value="GET">GET (REST API)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-8">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                URL DEL ENDPOINT (Variables: {'{{query}}'}, {'{{tmdbKey}}'}, {'{{omdbKey}}'}, {'{{fanartKey}}'}, {'{{fanartClientKey}}'}):
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-void text-cyberCyan font-mono rounded-lg px-3 py-2 border border-cyberBorder"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">TÉRMINO DE PRUEBA ({'{{query}}'}):</label>
              <input
                type="text"
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="Ej. Frieren, Dune, Severance..."
                className="w-full bg-void text-cyberGreen font-mono rounded-lg px-3 py-2 border border-cyberGreen/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">HEADERS (JSON):</label>
              <textarea
                rows={4}
                spellCheck={false}
                value={headersStr}
                onChange={(e) => setHeadersStr(e.target.value)}
                className="w-full bg-void text-slate-200 font-mono text-[11px] rounded-lg p-2.5 border border-cyberBorder"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">BODY JSON / GRAPHQL (POST):</label>
              <textarea
                rows={4}
                spellCheck={false}
                value={bodyStr}
                onChange={(e) => setBodyStr(e.target.value)}
                className="w-full bg-void text-cyberMagenta font-mono text-[11px] rounded-lg p-2.5 border border-cyberBorder"
              />
            </div>
          </div>

          <div className="bg-void/90 border border-cyberGreen/40 rounded-xl p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono text-cyberGreen uppercase font-bold">
                  🎨 API KEY DE FANART.TV (V3.2 · BANNERS, LOGOS Y CLEARARTS)
                </div>
                <p className="text-[10px] text-slate-400">
                  Se guarda en la configuración global y se encadena tras TMDB/OMDb/TVMaze/MusicBrainz para banners, logos y cleararts HD.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowFanartKeys((v) => !v)}
                  className="px-2 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberBorder text-slate-300 font-mono text-[10px] cursor-pointer"
                  title="Mostrar u ocultar claves Fanart.tv"
                >
                  {showFanartKeys ? '🙈 Ocultar' : '👁 Ver'}
                </button>
                <button
                  type="button"
                  onClick={handleVerifyAndSaveFanart}
                  disabled={testingFanart}
                  className="px-2.5 py-0.5 rounded bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {testingFanart ? '⏳...' : '⚡ Verificar y Guardar'}
                </button>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                    fanartKeyDraft.trim() || fanartClientKeyDraft.trim()
                      ? 'bg-cyberGreen/10 border-cyberGreen/40 text-cyberGreen'
                      : 'bg-panel border-cyberBorder text-slate-400'
                  }`}
                >
                  {fanartKeyDraft.trim() || fanartClientKeyDraft.trim()
                    ? 'Guardada en Global'
                    : 'Sin Key'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  API KEY DE PROYECTO FANART.TV ({'{{fanartKey}}'}):
                </label>
                <input
                  type={showFanartKeys ? 'text' : 'password'}
                  value={fanartKeyDraft}
                  onChange={(e) => handleFanartProjectKeyChange(e.target.value)}
                  placeholder="Pega tu Project API Key de Fanart.tv..."
                  className="w-full bg-panel text-cyberGreen font-mono text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberGreen"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  API KEY PERSONAL FANART.TV · CLIENT KEY ({'{{fanartClientKey}}'}):
                </label>
                <input
                  type={showFanartKeys ? 'text' : 'password'}
                  value={fanartClientKeyDraft}
                  onChange={(e) => handleFanartPersonalKeyChange(e.target.value)}
                  placeholder="Pega tu API Key personal (Client Key) de Fanart.tv..."
                  className="w-full bg-panel text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
            </div>
            {fanartStatusMsg && (
              <div
                className={`text-[10px] font-mono px-2.5 py-1 rounded border ${
                  fanartStatusMsg.ok
                    ? 'bg-cyberGreen/10 border-cyberGreen/40 text-cyberGreen'
                    : 'bg-red-500/10 border-red-500/40 text-red-400'
                }`}
              >
                {fanartStatusMsg.text}
              </div>
            )}
          </div>

          <div className="bg-void border border-cyberBorder rounded-xl p-3">
            <div className="text-[10px] font-mono text-cyberGreen uppercase font-bold mb-2">
              MAPEO JSONPATH → VARIABLES POSTPRO:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  ['titulo', '{{titulo}}'],
                  ['poster_url', '{{poster_url}}'],
                  ['logo_url', '{{logo_url}}'],
                  ['banner_url', '{{banner_url}}'],
                  ['clearart_url', '{{clearart_url}}'],
                  ['background_url', '{{background_url}}'],
                  ['sinopsis', '{{sinopsis}}'],
                  ['rating', '{{tmdb_rating}}'],
                  ['generos', '{{generos}}'],
                  ['anio', '{{anio}}'],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="w-28 font-mono text-[11px] text-cyberCyan shrink-0">{label}</span>
                  <input
                    type="text"
                    value={mappings[field] || ''}
                    onChange={(e) => setMappings({ ...mappings, [field]: e.target.value })}
                    className="flex-1 min-w-0 bg-panel text-slate-100 font-mono text-[11px] rounded px-2 py-1 border border-cyberBorder"
                  />
                </div>
              ))}
            </div>
          </div>

          {testResult && (
            <div
              className={`bg-void border ${
                testResult.ok ? 'border-cyberGreen/60' : 'border-red-500/60'
              } rounded-xl p-3 space-y-2`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[10px] font-mono font-bold uppercase ${
                    testResult.ok ? 'text-cyberGreen' : 'text-red-400'
                  }`}
                >
                  {testResult.ok
                    ? `✔ RESPUESTA REAL HTTP ${testResult.status} ${testResult.statusText || ''}`
                    : `✕ FALLO HTTP ${testResult.status} — ${testResult.error}`}
                </span>
                <span className="text-[10px] font-mono text-slate-400">{testResult.latencyMs} ms</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <pre className="bg-panel border border-cyberBorder rounded-lg p-2 font-mono text-[10px] text-slate-300 overflow-x-auto max-h-36">
                  {testResult.rawJson
                    ? JSON.stringify(testResult.rawJson, null, 2)
                    : testResult.rawText || testResult.error}
                </pre>
                <div className="bg-panel border border-cyberBorder rounded-lg p-2 font-mono text-[10px] text-cyberCyan space-y-1 overflow-y-auto max-h-36">
                  {Object.keys(testResult.extracted).length > 0 ? (
                    Object.entries(testResult.extracted).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-cyberMagenta font-bold">{`{{${k}}}`}:</span>{' '}
                        <span className="text-slate-200 break-words">{v}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500">Sin campos extraídos para este JSONPath.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-elevated border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestRealApi}
              disabled={testing}
              className="px-4 py-2 rounded-xl bg-void hover:bg-panel border border-cyberGreen/60 text-cyberGreen font-extrabold text-xs cursor-pointer disabled:opacity-50"
            >
              {testing ? '⏳ Haciendo ping...' : '⚡ Verificar Conexión (Ping)'}
            </button>
            {testing ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-cyberCyan">
                <span className="w-2 h-2 rounded-full bg-cyberCyan animate-pulse" />
                <span>Verificando...</span>
              </span>
            ) : testResult ? (
              <span
                className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-bold tabular-nums ${
                  testResult.ok ? 'text-cyberGreen' : 'text-red-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    testResult.ok
                      ? 'bg-cyberGreen shadow-[0_0_6px_#00ff9d]'
                      : 'bg-red-500 shadow-[0_0_6px_#ef4444]'
                  }`}
                />
                <span>
                  {testResult.ok
                    ? `Conectado · HTTP ${testResult.status} (${testResult.latencyMs} ms)`
                    : `Desconectado · HTTP ${testResult.status || 'Red'}`}
                </span>
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-void border border-cyberBorder text-slate-300 text-xs cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="neon-btn-cyan px-5 py-2 rounded-xl font-extrabold text-xs cursor-pointer"
            >
              💾 Guardar Proveedor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 3: PLUGINS & TEMAS
   ============================================================================ */
interface PluginsModalProps {
  open: boolean;
  initialTab: 'installed' | 'import';
  themes: ThemePlugin[];
  activeThemeId: string;
  functionalPlugins: FunctionalPlugin[];
  onClose: () => void;
  onToggleFunctionalPlugin: (id: string) => void;
  onApplyTheme: (id: string) => void;
  onInstallCustomTheme: (theme: ThemePlugin) => void;
  onInstallCustomExtension: (ext: FunctionalPlugin) => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const PluginsModal: React.FC<PluginsModalProps> = ({
  open,
  initialTab,
  themes,
  activeThemeId,
  functionalPlugins,
  onClose,
  onToggleFunctionalPlugin,
  onApplyTheme,
  onInstallCustomTheme,
  onInstallCustomExtension,
  onToast,
}) => {
  const [tab, setTab] = useState<'installed' | 'import'>(initialTab);
  const [manifestText, setManifestText] = useState(
    JSON.stringify(
      {
        id: 'ghostrunner-gold',
        type: 'theme',
        name: 'Ghostrunner Cyber Gold',
        author: 'Usuario PostPro',
        version: '1.0.0',
        description: 'Paleta táctico-dorada #ffd60a con acentos cian láser.',
        vars: {
          '--bg-void': '#09090b',
          '--bg-panel': '#121216',
          '--bg-elevated': '#1b1b22',
          '--bg-canvas': '#050507',
          '--border-color': '#2e2c24',
          '--accent-cyan': '#ffd60a',
          '--accent-magenta': '#00f0ff',
          '--accent-green': '#00ff9d',
          '--accent-purple': '#f59e0b',
          '--grid-line': 'rgba(255, 214, 10, 0.045)',
        },
      },
      null,
      2
    )
  );

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const installFromText = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.name) throw new Error('Falta la propiedad "name".');
      if (parsed.type === 'theme' && parsed.vars) {
        const themeObj: ThemePlugin = {
          id: parsed.id || `theme-${Date.now()}`,
          name: parsed.name,
          author: parsed.author || 'Custom',
          desc: parsed.description || 'Tema personalizado importado.',
          vars: parsed.vars,
        };
        onInstallCustomTheme(themeObj);
        setTab('installed');
      } else {
        onInstallCustomExtension({
          id: parsed.id || `ext-${Date.now()}`,
          name: parsed.name,
          version: parsed.version || 'v1.0.0',
          desc: parsed.description || 'Extensión importada.',
          enabled: true,
        });
        setTab('installed');
      }
    } catch (err) {
      onToast(`Error en JSON: ${err instanceof Error ? err.message : 'Formato inválido'}`, 'error');
    }
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    setManifestText(text);
    installFromText(text);
  };

  const handleImportThemesFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = validateAndParseThemeFile(text);
      if (!res.ok || !res.theme) {
        onToast(`❌ Archivo .Themes rechazado por seguridad: ${res.error}`, 'error');
        return;
      }
      onInstallCustomTheme(res.theme);
      onToast(`✔ Tema "${res.theme.name}" (.Themes) importado, verificado y aplicado con éxito.`, 'success');
      setTab('installed');
    } catch (err: any) {
      onToast(`Error al leer archivo .Themes: ${err?.message}`, 'error');
    }
  };

  const handleExportTheme = (tp: ThemePlugin) => {
    const checksum = computeThemeChecksum(tp);
    const payload = {
      magicHeader: 'POSTPRO_STUDIO_THEME_FILE_V1',
      format: 'postpro-studio-theme',
      createdAt: Date.now(),
      authorship: {
        author: tp.author || 'PostPro Studio User',
        version: '1.0.0',
      },
      theme: tp,
      checksum,
    };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = tp.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safeName}.Themes`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onToast(`Tema exportado exitosamente como "${safeName}.Themes"`, 'success');
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="anim-enter bg-panel border border-cyberMagenta/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-void border border-cyberMagenta/60 flex items-center justify-center text-cyberMagenta font-bold text-sm">
              🧩
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">Gestor de Plugins & Temas Cyberpunk</h3>
              <p className="text-[11px] text-slate-400">
                Activa extensiones, cambia paletas de color o importa archivos .psplugin / .json.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="flex bg-void border-b border-cyberBorder px-5 pt-2 gap-1.5 text-xs font-semibold shrink-0">
          <button
            onClick={() => setTab('installed')}
            className={`px-4 py-2 rounded-t-lg cursor-pointer ${
              tab === 'installed'
                ? 'bg-panel text-cyberMagenta border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚡ Plugins Instalados & Temas
          </button>
          <button
            onClick={() => setTab('import')}
            className={`px-4 py-2 rounded-t-lg cursor-pointer ${
              tab === 'import'
                ? 'bg-panel text-cyberMagenta border-t border-x border-cyberBorder'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ➕ Importar Plugin
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs flex-1">
          {tab === 'installed' ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-cyberCyan uppercase font-bold tracking-wider">
                    EXTENSIONES FUNCIONALES:
                  </span>
                  <span className="text-[10px] font-mono text-cyberGreen">
                    {functionalPlugins.filter((f) => f.enabled).length} de {functionalPlugins.length} activos
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {functionalPlugins.map((ext) => (
                    <div
                      key={ext.id}
                      className={`bg-void border ${
                        ext.enabled ? 'border-cyberGreen/50' : 'border-cyberBorder'
                      } rounded-xl p-3 flex items-start justify-between gap-2.5`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white text-xs truncate">{ext.name}</span>
                          <span className="text-[9px] font-mono text-slate-400 shrink-0">{ext.version}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">{ext.desc}</p>
                      </div>
                      <button
                        onClick={() => onToggleFunctionalPlugin(ext.id)}
                        className={`px-2.5 py-1 rounded-lg font-mono text-[10px] font-extrabold shrink-0 cursor-pointer ${
                          ext.enabled
                            ? 'bg-cyberGreen/20 border border-cyberGreen text-cyberGreen'
                            : 'bg-panel border border-cyberBorder text-slate-400 hover:text-white'
                        }`}
                      >
                        {ext.enabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono text-cyberMagenta uppercase font-bold tracking-wider">
                    TEMAS VISUALES & ARCHIVOS .THEMES:
                  </span>
                  <label className="px-2.5 py-1 rounded-lg bg-cyberMagenta/20 hover:bg-cyberMagenta/30 border border-cyberMagenta/60 text-cyberMagenta font-mono font-bold text-[10px] cursor-pointer inline-flex items-center gap-1">
                    <span>➕ Importar .Themes</span>
                    <input type="file" accept=".themes,.Themes,application/json" onChange={handleImportThemesFile} className="hidden" />
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {themes.map((tp) => {
                    const active = tp.id === activeThemeId;
                    return (
                      <div
                        key={tp.id}
                        className={`bg-void border ${
                          active ? 'border-cyberCyan shadow-[0_0_16px_rgba(0,240,255,0.2)]' : 'border-cyberBorder'
                        } rounded-xl p-3 flex flex-col justify-between gap-2.5`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-bold text-white text-xs">{tp.name}</span>
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1 shrink-0">
                                <span className="w-3 h-3 rounded-full" style={{ background: tp.vars['--accent-cyan'] }} />
                                <span className="w-3 h-3 rounded-full" style={{ background: tp.vars['--accent-magenta'] }} />
                                <span className="w-3 h-3 rounded-full" style={{ background: tp.vars['--accent-green'] }} />
                              </div>
                              <button
                                type="button"
                                onClick={() => handleExportTheme(tp)}
                                className="px-1.5 py-0.5 rounded bg-panel hover:bg-elevated border border-cyberBorder text-slate-300 hover:text-cyberCyan text-[10px] font-mono cursor-pointer"
                                title="Exportar tema a archivo .Themes"
                              >
                                📥
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">{tp.desc}</p>
                          {tp.fontFamily && (
                            <div className="text-[10px] font-mono text-cyberCyan mt-1">Tipografía: {tp.fontFamily}</div>
                          )}
                        </div>
                        <button
                          onClick={() => onApplyTheme(tp.id)}
                          className={`${
                            active
                              ? 'bg-cyberGreen/20 border border-cyberGreen text-cyberGreen'
                              : 'neon-btn-cyan'
                          } w-full py-1.5 rounded-lg font-extrabold text-[11px] cursor-pointer`}
                        >
                          {active ? '✔ Tema Activo' : 'Activar Tema'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer?.files?.[0];
                  if (f) handleImportFile(f);
                }}
                className="border-2 border-dashed border-cyberBorder hover:border-cyberMagenta rounded-xl bg-void/85 p-5 flex flex-col items-center justify-center text-center cursor-pointer"
              >
                <span className="text-2xl mb-1">📦</span>
                <span className="font-extrabold text-xs text-white">
                  Arrastra aquí tu archivo <code className="text-cyberMagenta">.psplugin</code> o{' '}
                  <code className="text-cyberCyan">.json</code>
                </span>
                <input
                  type="file"
                  accept=".json,.psplugin"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (f) handleImportFile(f);
                  }}
                />
              </label>
              <textarea
                rows={9}
                spellCheck={false}
                value={manifestText}
                onChange={(e) => setManifestText(e.target.value)}
                className="w-full bg-void text-slate-100 font-mono text-[11px] rounded-lg p-3 border border-cyberBorder"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => installFromText(manifestText)}
                  className="neon-btn-cyan px-4 py-2 rounded-xl font-extrabold text-xs cursor-pointer"
                >
                  ⚡ Instalar y Activar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 4: GENERADOR DE SPOILER DE ENLACES
   ============================================================================ */
interface SpoilerLinksModalProps {
  open: boolean;
  initialRawSpoiler: string;
  initialCustomLinkTemplate?: string;
  activeSite?: 'zinfinal' | 'identi' | 'custom';
  onClose: () => void;
  onEmbed: (title: string, rows: SpoilerLinkRow[], customLinkTemplate: string) => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function extractAnchorTextFromLinkTemplate(template: string): string {
  const m = (template || '').match(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/i);
  return m ? m[1].trim() : '';
}

export const SpoilerLinksModal: React.FC<SpoilerLinksModalProps> = ({
  open,
  initialRawSpoiler,
  initialCustomLinkTemplate,
  activeSite = 'zinfinal',
  onClose,
  onEmbed,
  onToast,
}) => {
  const [title, setTitle] = useState('Enlaces de Descarga Directa');
  const [customLinkTemplate, setCustomLinkTemplate] = useState(
    initialCustomLinkTemplate || DEFAULT_CUSTOM_LINK_TEMPLATE
  );
  const [rows, setRows] = useState<SpoilerLinkRow[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [verifyingAll, setVerifyingAll] = useState(false);

  const verifySingleLink = async (idx: number) => {
    const row = rows[idx];
    if (!row || !row.url.trim() || !row.url.startsWith('http')) {
      onToast('URL vacía o inválida para verificar', 'warning');
      return;
    }

    const next = [...rows];
    next[idx] = { ...next[idx], status: 'checking' };
    setRows(next);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      await fetch(row.url.trim(), {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const updated = [...rows];
      updated[idx] = { ...updated[idx], status: 'active', statusMessage: 'En línea / Activo' };
      setRows(updated);
      onToast(`Enlace #${idx + 1} verificado: Activo`, 'success');
    } catch (err: any) {
      const updated = [...rows];
      updated[idx] = {
        ...updated[idx],
        status: 'dead',
        statusMessage: err?.name === 'AbortError' ? 'Tiempo de espera agotado' : 'Sin conexión / Caído',
      };
      setRows(updated);
      onToast(`Enlace #${idx + 1} verificado: Inactivo o inaccesible`, 'warning');
    }
  };

  const verifyAllLinks = async () => {
    setVerifyingAll(true);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].url.trim().startsWith('http')) {
        await verifySingleLink(i);
      }
    }
    setVerifyingAll(false);
    onToast('Verificación masiva de enlaces finalizada', 'success');
  };


  useEffect(() => {
    if (!open) return;
    const activeTpl =
      (initialCustomLinkTemplate || DEFAULT_CUSTOM_LINK_TEMPLATE).trim() ||
      DEFAULT_CUSTOM_LINK_TEMPLATE;
    setCustomLinkTemplate(activeTpl);
    const templateDefaultAnchor = extractAnchorTextFromLinkTemplate(activeTpl);

    const parsed: SpoilerLinkRow[] = [];
    (initialRawSpoiler || '').split(/\r?\n/).forEach((line) => {
      const m = line.match(/\[url=([^\]]+)\](.*?)\[\/url\]/i);
      if (m) {
        const url = m[1].trim();
        const anchorText = m[2].trim();
        const isLegacyHostIcon = /\[hosticon=/i.test(line);
        let label = '';
        if (isLegacyHostIcon && anchorText.includes('—')) {
          const parts = anchorText.split('—');
          label = parts.slice(1).join('—').trim();
        } else if (
          anchorText &&
          (!templateDefaultAnchor ||
            anchorText.toLowerCase() !== templateDefaultAnchor.toLowerCase())
        ) {
          label = anchorText;
        }
        parsed.push({ url, label });
      }
    });
    setRows(
      parsed.length > 0
        ? parsed
        : [{ url: 'https://drive.google.com/file/d/ejemplo', label: '' }]
    );
  }, [open, initialRawSpoiler, initialCustomLinkTemplate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const templateHasSpoiler = /\[spoiler/i.test(customLinkTemplate);
  const previewCompiled = buildHostersSummaryAndIdentiLinks(rows, customLinkTemplate);

  const importBulk = () => {
    const urls = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http') || l.startsWith('magnet:'));
    if (urls.length === 0) {
      onToast('Pega al menos una URL válida (http://, https:// o magnet:?)', 'warning');
      return;
    }
    const added = urls.map((url) => ({ url, label: '' }));
    setRows([...rows.filter((r) => r.url.trim().length > 0), ...added]);
    setBulkText('');
    setShowBulk(false);
    onToast(`${urls.length} enlaces detectados y añadidos`, 'success');
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="anim-enter bg-panel border border-cyberCyan/70 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/60 flex items-center justify-center text-cyberCyan font-bold text-sm">
              🔗
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white">
                Insertador de Enlaces ({activeSite === 'identi' ? 'Identi' : activeSite === 'zinfinal' ? 'Zinfinal Aensy Style' : 'Personalizado'})
              </h3>
              <p className="text-[11px] text-slate-400">
                Aplica tu Link personalizado sustituyendo &quot;link&quot; por cada URL y genera bloques desde [center] hasta [/center].
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3.5 text-xs flex-1">
          {/* Formato / Plantilla de Link Personalizado */}
          <div className="bg-void/90 border border-cyberCyan/45 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[10px] font-mono font-bold text-cyberCyan uppercase">
                LINK PERSONALIZADO (SE APLICA A CADA URL):
              </label>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCustomLinkTemplate(DEFAULT_CUSTOM_LINK_TEMPLATE)}
                  className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer ${
                    customLinkTemplate.trim() === DEFAULT_CUSTOM_LINK_TEMPLATE
                      ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan font-bold'
                      : 'bg-panel border-cyberBorder text-slate-300 hover:border-cyberCyan'
                  }`}
                >
                  GDrive ([center][spoiler])
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCustomLinkTemplate('[center][spoiler][url=link]{host}[/url][/spoiler][/center]')
                  }
                  className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer ${
                    customLinkTemplate.trim() === '[center][spoiler][url=link]{host}[/url][/spoiler][/center]'
                      ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan font-bold'
                      : 'bg-panel border-cyberBorder text-slate-300 hover:border-cyberCyan'
                  }`}
                >
                  Auto-Hoster ({'{host}'})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCustomLinkTemplate('[hosticon={id}] [url=link]{host} — {label}[/url]')
                  }
                  className={`px-2 py-0.5 rounded border font-mono text-[10px] cursor-pointer ${
                    customLinkTemplate.includes('[hosticon=')
                      ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan font-bold'
                      : 'bg-panel border-cyberBorder text-slate-300 hover:border-cyberCyan'
                  }`}
                >
                  HostIcon Clásico
                </button>
              </div>
            </div>
            <input
              type="text"
              value={customLinkTemplate}
              onChange={(e) => setCustomLinkTemplate(e.target.value)}
              placeholder="[center][spoiler][url=link]GDrive[/url][/spoiler][/center]"
              className="w-full bg-panel text-cyberGreen font-mono text-[11px] rounded-lg px-3 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
            />
            <div className="text-[10px] font-mono text-slate-400 leading-snug">
              La palabra <span className="text-cyberCyan font-bold">link</span> se reemplaza automáticamente por el URL. Si añades más de un enlace, se genera un bloque completo desde <span className="text-slate-200">[center]</span> hasta <span className="text-slate-200">[/center]</span> por cada link.
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            {!templateHasSpoiler ? (
              <div className="flex-1">
                <label className="block text-[10px] font-mono text-slate-400 mb-1">TÍTULO DEL SPOILER CONTENEDOR:</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-void text-cyberCyan font-bold rounded-lg px-3 py-1.5 border border-cyberBorder"
                />
              </div>
            ) : (
              <div className="flex-1 text-[11px] font-mono text-slate-400">
                Cada enlace genera su propio <span className="text-cyberCyan">[center][spoiler]</span> individual listo para insertar.
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11px] text-cyberGreen font-bold">
                {rows.length} enlace{rows.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={verifyAllLinks}
                disabled={verifyingAll}
                className="px-2.5 py-1.5 rounded-lg bg-void hover:bg-elevated border border-cyberCyan/60 text-cyberCyan font-bold text-[11px] cursor-pointer disabled:opacity-50"
                title="Verifica el estado activo de todos los enlaces ingresados"
              >
                {verifyingAll ? '⏳ Verificando...' : '🔍 Verificar Todos'}
              </button>
              <button
                type="button"
                onClick={() => setShowBulk(!showBulk)}
                className="px-3 py-1.5 rounded-lg bg-void hover:bg-elevated border border-cyberMagenta/60 text-cyberMagenta font-bold cursor-pointer"
              >
                📋 Pegar Lista Masiva
              </button>
            </div>
          </div>

          {showBulk && (
            <div className="bg-void border border-cyberMagenta/50 rounded-xl p-3 space-y-2">
              <textarea
                rows={3}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder="Pega una URL por línea..."
                className="w-full bg-panel text-slate-100 font-mono text-[11px] rounded-lg p-2 border border-cyberBorder"
              />
              <div className="flex justify-end">
                <button
                  onClick={importBulk}
                  className="px-3 py-1 rounded-lg bg-cyberMagenta text-white font-bold text-[11px] cursor-pointer"
                >
                  Detectar y Añadir URLs
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {rows.map((row, idx) => {
              const hoster = detectHosterFromUrl(row.url);
              return (
                <div
                  key={idx}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-void border border-cyberBorder rounded-xl p-2"
                >
                  <div
                    style={{ borderColor: hoster.accentVar }}
                    className="sm:w-36 px-2.5 py-1.5 rounded-lg bg-elevated border flex items-center justify-between gap-2 shrink-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <HosterSvgIcon hosterId={hoster.id} size={16} />
                      <span className="font-mono font-bold text-[11px] truncate" style={{ color: hoster.accentVar }}>
                        {hoster.name}
                      </span>
                    </div>
                    <div className="shrink-0" title={row.statusMessage || row.status || 'Sin verificar'}>
                      {row.status === 'checking' && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping inline-block" />}
                      {row.status === 'active' && <span className="w-2.5 h-2.5 rounded-full bg-cyberGreen inline-block shadow-[0_0_8px_rgba(0,255,157,0.8)]" />}
                      {row.status === 'dead' && <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
                      {(!row.status || row.status === 'idle') && <span className="w-2.5 h-2.5 rounded-full bg-slate-600 inline-block" />}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={row.url}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...next[idx], url: e.target.value, status: 'idle' };
                      setRows(next);
                    }}
                    placeholder="https://drive.google.com/... | https://mega.nz/..."
                    className="flex-1 min-w-0 bg-panel text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                  />
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...next[idx], label: e.target.value };
                      setRows(next);
                    }}
                    placeholder="Texto opcional"
                    className="sm:w-36 bg-panel text-slate-200 text-[11px] rounded-lg px-2.5 py-1.5 border border-cyberBorder"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => verifySingleLink(idx)}
                      disabled={row.status === 'checking'}
                      className="px-2 py-1.5 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder text-cyberCyan font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50"
                      title="Probar estado del enlace"
                    >
                      {row.status === 'checking' ? '⏳' : '🔍 Test'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setRows(rows.length <= 1 ? [{ url: '', label: '' }] : rows.filter((_, i) => i !== idx))
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-elevated hover:bg-red-600 text-slate-400 hover:text-white font-bold text-xs cursor-pointer"
                      title="Eliminar fila"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setRows([...rows, { url: '', label: '' }])}
            className="w-full py-2 rounded-xl border-2 border-dashed border-cyberCyan/50 hover:border-cyberCyan bg-void/60 hover:bg-elevated text-cyberCyan font-extrabold text-xs cursor-pointer"
          >
            + Añadir otro link
          </button>

          {/* Vista previa exacta del BBCode generado */}
          <div className="bg-void border border-cyberBorder rounded-xl p-2.5 space-y-1">
            <div className="text-[10px] font-mono text-slate-400 uppercase">
              Vista previa BBCode generada ({rows.filter((r) => r.url.trim()).length} link(s)):
            </div>
            <pre className="font-mono text-[11px] text-cyberGreen whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
              {previewCompiled.enlacesSpoiler || '(Agrega al menos una URL para previsualizar el BBCode)'}
            </pre>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-elevated border-t border-cyberBorder flex items-center justify-between gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-void border border-cyberBorder text-slate-300 text-xs cursor-pointer"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              const valid = rows.filter((r) => r.url.trim().length > 0);
              if (valid.length === 0) {
                onToast('Ingresa al menos una URL válida.', 'warning');
                return;
              }
              onEmbed(
                title.trim() || 'Enlaces de Descarga Directa',
                valid,
                customLinkTemplate.trim() || DEFAULT_CUSTOM_LINK_TEMPLATE
              );
              onClose();
            }}
            className="neon-btn-cyan px-5 py-2 rounded-xl font-extrabold text-xs cursor-pointer"
          >
            ⚡ Insertar Enlaces en el Post
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 5: ACERCA DE POSTPRO (VERSIÓN Y CREADOR)
   ============================================================================ */
interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="anim-enter w-full max-w-md bg-panel border border-cyberCyan/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] overflow-hidden"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between">
          <span className="text-xs font-mono font-bold text-slate-300">
            Acerca de {APP_INFO.fullName}
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-void border border-cyberBorder text-slate-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-6 flex flex-col items-center text-center">
          <div className="mb-4 drop-shadow-[0_0_20px_rgba(0,240,255,0.28)]">
            <PostProLogo size={68} />
          </div>

          <h3 className="text-2xl font-black tracking-tight text-white">
            {APP_INFO.fullName}
          </h3>

          <div className="mt-1.5 font-mono text-xs text-slate-300 tabular-nums">
            Versión <span className="text-cyberCyan font-bold">{APP_INFO.version}</span>{' '}
            <span aria-hidden="true">·</span> Creador:{' '}
            <span className="text-cyberMagenta font-bold">{APP_INFO.creator}</span>
          </div>

          <p className="mt-4 text-xs text-slate-400 leading-relaxed">
            Estudio profesional BBCode y multimedia con lector binario local (FLAC, MP3, MKV/WebM, MP4,
            capturas de fotogramas y espectrogramas), navegador de archivos y carpetas,
            verificación y conexión con APIs de metadatos y hosts de imágenes.
          </p>

          <div className="mt-5 w-full bg-void border border-cyberBorder rounded-xl p-3 text-left font-mono text-[11px] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Aplicación</span>
              <span className="text-white font-bold">{APP_INFO.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Versión</span>
              <span className="text-cyberCyan font-bold tabular-nums">{APP_INFO.version}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Creador</span>
              <span className="text-cyberMagenta font-bold">{APP_INFO.creator}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex justify-end">
          <button
            onClick={onClose}
            className="neon-btn-cyan px-5 py-1.5 rounded-xl font-extrabold text-xs cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 6: ASISTENTE AL ABRIR MESA DE TRABAJO / NUEVO POST (DROP & ANALIZAR)
   ============================================================================ */
interface MediaIngestModalProps {
  open: boolean;
  config: UserConfig;
  apiProviders: ApiProviderConfig[];
  recentProjects?: RecentMediaProject[];
  analyzing: boolean;
  statusMessage?: string | null;
  onFilesDroppedOrPicked: (files: File[]) => Promise<void>;
  onBrowseFiles: () => Promise<void>;
  onBrowseFolder: () => Promise<void>;
  onOpenRecentProject?: (project: RecentMediaProject) => void;
  onOpenConnectApi: () => void;
  onOpenSettings: (tab?: 'paths' | 'imghost' | 'minimenu') => void;
  onSkip: () => void;
}

export const MediaIngestModal: React.FC<MediaIngestModalProps> = ({
  open,
  config,
  apiProviders,
  recentProjects = [],
  analyzing,
  statusMessage,
  onFilesDroppedOrPicked,
  onBrowseFiles,
  onBrowseFolder,
  onOpenRecentProject,
  onOpenConnectApi,
  onOpenSettings,
  onSkip,
}) => {
  const [dragActive, setDragActive] = useState(false);

  if (!open) return null;

  const connectedApis = getConnectedMetadataProviders(apiProviders, config);
  const hasApiAutomation = config.autoEnrichOnDrop && connectedApis.length > 0;
  const hasImgHost = Boolean(config.imgHostKey.trim() || config.imgHostProvider === 'chevereto' && config.imgHostEndpoint.trim());

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !analyzing) onSkip();
      }}
      className="fixed inset-0 z-[65] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="anim-enter w-full max-w-2xl bg-panel border border-cyberCyan/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <PostProLogo size={28} className="shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-white truncate">
                Escanear medios e iniciar post
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Suelta o abre tu archivo multimedia para extraer metadatos incrustados y capturas
              </p>
            </div>
          </div>
          {!analyzing && (
            <button
              onClick={onSkip}
              className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
              title="Cerrar y editar manualmente"
            >
              ✕
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!analyzing) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (!analyzing && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                onFilesDroppedOrPicked(Array.from(e.dataTransfer.files));
              }
            }}
            className={`rounded-2xl border-2 border-dashed p-7 text-center transition-all ${
              dragActive
                ? 'border-cyberCyan bg-cyberCyan/10 scale-[1.01]'
                : 'border-cyberBorder hover:border-cyberCyan/70 bg-void/80'
            }`}
          >
            <div className="text-3xl mb-2">{analyzing ? '⚙️' : '📂'}</div>
            <div className="text-sm font-extrabold text-white">
              {analyzing
                ? 'Procesando archivo y generando post...'
                : 'Arrastra y suelta aquí tu Video, Audio, Imagen o NFO'}
            </div>
            <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
              {analyzing
                ? statusMessage || 'Extrayendo metadatos incrustados, capturas y comprobando APIs...'
                : 'Compatible con MKV, MP4, WebM, FLAC, MP3, M4A, NFO, CUE e imágenes.'}
            </p>

            {!analyzing && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  onClick={onBrowseFiles}
                  className="neon-btn-cyan px-5 py-2.5 rounded-xl font-extrabold text-xs cursor-pointer whitespace-nowrap"
                >
                  📂 Abrir Archivo(s)
                </button>
                <button
                  onClick={onBrowseFolder}
                  className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-slate-200 font-semibold text-xs cursor-pointer whitespace-nowrap"
                >
                  📁 Escanear Carpeta
                </button>
              </div>
            )}
          </div>

          {!analyzing && recentProjects.length > 0 && onOpenRecentProject && (
            <div className="bg-void border border-cyberBorder rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono font-bold text-cyberCyan uppercase tracking-wider">
                  🕒 Proyectos Recientes (sin re-analizar)
                </span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                  {recentProjects.length} guardado{recentProjects.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {recentProjects.slice(0, 4).map((proj) => {
                  const mi = proj.mediainfoDetails;
                  const vt = mi.videoTracks[0];
                  const at = mi.audioTracks[0];
                  const techHint = vt
                    ? [
                        vt.width && vt.height ? `${vt.width}×${vt.height}` : vt.resolutionLabel,
                        vt.codec,
                        vt.fps,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : at
                    ? [at.codec, at.bitrate || mi.overallBitrate].filter(Boolean).join(' · ')
                    : mi.fileSize;
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => onOpenRecentProject(proj)}
                      className="text-left bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-white truncate">{mi.fileName}</div>
                        <div className="text-[10px] font-mono text-slate-400 truncate tabular-nums">
                          {mi.container} · {techHint}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-cyberCyan shrink-0">
                        Abrir →
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pipeline behavior summary */}
          <div className="bg-void border border-cyberBorder rounded-xl p-3.5 space-y-2.5 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100">1. Análisis técnico MediaInfo y metadatos incrustados</div>
                <div className="text-[11px] text-slate-400">
                  Extrae bitrate, códecs, resolución, FPS, canales de audio, subtítulos y etiquetas en el panel MediaInfo Técnico.
                </div>
              </div>
              <span className="font-mono text-[10px] font-bold text-cyberGreen shrink-0">✔ Activo</span>
            </div>

            <div className="border-t border-cyberBorder/60 pt-2.5 flex items-start justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100">2. Proceso de capturas automáticas</div>
                <div className="text-[11px] text-slate-400">
                  {hasImgHost && config.autoUploadCovers
                    ? `Extrae fotogramas/espectrogramas y los sube automáticamente a ${config.imgHostProvider.toUpperCase()}.`
                    : 'Extrae fotogramas de video y espectrograma de audio para insertarlos en el post.'}
                </div>
              </div>
              <span className="font-mono text-[10px] font-bold text-cyberCyan shrink-0">✔ Activo</span>
            </div>

            <div className="border-t border-cyberBorder/60 pt-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-slate-100">3. Automatización con APIs de metadatos</div>
                {hasApiAutomation ? (
                  <div className="text-[11px] text-cyberGreen">
                    Conectadas: {connectedApis.map((p) => p.name).join(', ')}. Al soltar el archivo se buscarán
                    sinopsis, portada y puntuación automáticamente.
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Sin APIs conectadas: no se buscará en TMDB, IMDb ni otros proveedores; se añadirán únicamente
                    los metadatos incrustados y capturas del archivo.
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => {
                    onSkip();
                    onOpenSettings('paths');
                  }}
                  className="px-2.5 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-[10px] font-mono text-slate-200 cursor-pointer whitespace-nowrap"
                >
                  ⚙ APIs
                </button>
                <button
                  onClick={() => {
                    onSkip();
                    onOpenConnectApi();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-[10px] font-mono font-bold text-cyberCyan cursor-pointer whitespace-nowrap"
                >
                  + Conectar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] font-mono text-slate-400 truncate">
            {APP_INFO.name} v{APP_INFO.version} · {APP_INFO.creator}
          </span>
          {!analyzing && (
            <button
              onClick={onSkip}
              className="px-4 py-1.5 rounded-xl bg-void hover:bg-panel border border-cyberBorder text-slate-200 font-semibold text-xs cursor-pointer whitespace-nowrap"
            >
              Continuar al Editor sin archivo →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 7: GUÍA RÁPIDA DE ATAJOS DE TECLADO
   ============================================================================ */
interface ShortcutItem {
  keys: string[];
  label: string;
  detail: string;
}

interface ShortcutGroup {
  title: string;
  subtitle: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Atajos Globales (useHotkeys)',
    subtitle: 'Disponibles en cualquier panel de la mesa de trabajo',
    items: [
      { keys: ['Ctrl', 'N'], label: 'Nuevo documento', detail: 'Crea una nueva pestaña BBCode' },
      { keys: ['Ctrl', 'S'], label: 'Guardar estado', detail: 'Guarda documento y configuración local' },
      { keys: ['Ctrl', 'K'], label: 'Cambiar estilo de sitio', detail: 'Alterna entre Zinfinal Aensy e Identi' },
      { keys: ['Ctrl', 'Z'], label: 'Deshacer cambio', detail: 'Revierte hasta N pasos configurables (10 por defecto)' },
    ],
  },
  {
    title: 'Edición BBCode (Editor activo)',
    subtitle: 'Aplica etiquetas envolviendo el texto seleccionado o en la posición del cursor',
    items: [
      { keys: ['Ctrl', 'B'], label: 'Negrita', detail: '[b]...[/b]' },
      { keys: ['Ctrl', 'I'], label: 'Cursiva', detail: '[i]...[/i]' },
      { keys: ['Ctrl', 'U'], label: 'Subrayado', detail: '[u]...[/u]' },
      { keys: ['Ctrl', 'Shift', 'K'], label: 'Enlace URL', detail: '[url=https://]...[/url]' },
      { keys: ['Ctrl', 'E'], label: 'Centrar bloque', detail: '[center]...[/center]' },
      { keys: ['Ctrl', 'Shift', 'C'], label: 'Bloque Código / MediaInfo', detail: '[code]...[/code]' },
      { keys: ['Ctrl', 'Shift', 'Q'], label: 'Cita / Sinopsis', detail: '[quote]...[/quote]' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Spoiler desplegable', detail: '[spoiler=...]...[/spoiler]' },
    ],
  },
  {
    title: 'Mesa de trabajo y Flujo rápido',
    subtitle: 'Navegación instantánea y acciones frecuentes sin soltar el teclado',
    items: [
      { keys: ['Alt', 'C'], label: 'Copiar BBCode compilado', detail: 'Portapapeles listo para publicar' },
      { keys: ['Alt', 'O'], label: 'Escanear medios', detail: 'Abre el asistente de lectura e ingesta' },
      { keys: ['Alt', 'N'], label: 'Nuevo post BBCode', detail: 'Crea pestaña nueva y solicita archivo' },
      { keys: ['Alt', 'A'], label: 'Consultar API activa', detail: 'Busca metadatos por título actual' },
      { keys: ['Alt', 'L'], label: 'Bloquear / Desbloquear mesa', detail: 'Alterna candado de paneles y divisores' },
      { keys: ['Alt', '1 - 8'], label: 'Cambiar herramienta lateral', detail: 'Covers, Texto, Alineación, Medios, Links, APIs...' },
      { keys: ['Ctrl', '/'], label: 'Abrir o cerrar esta guía', detail: 'También funciona con ? fuera de campos' },
      { keys: ['Esc'], label: 'Cerrar menús / modal', detail: 'Descarta menús flotantes o diálogos activos' },
    ],
  },
];

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ open, onClose }) => {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  if (!open) return null;

  const query = filter.trim().toLowerCase();
  const filteredGroups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !query ||
        item.label.toLowerCase().includes(query) ||
        item.detail.toLowerCase().includes(query) ||
        item.keys.join(' ').toLowerCase().includes(query)
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        className="anim-enter w-full max-w-3xl bg-panel border border-cyberCyan/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 id="shortcuts-modal-title" className="text-sm font-extrabold text-white truncate">
              Guía Rápida de Atajos de Teclado
            </h3>
            <p className="text-[11px] text-slate-400 truncate">
              Edita BBCode y controla la mesa de trabajo con mayor velocidad (en macOS usa Cmd en lugar de Ctrl)
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar guía de atajos"
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 border border-cyberBorder text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-4 pb-2 shrink-0">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar atajo o acción (ej. negrita, spoiler, copiar, Alt)..."
            autoFocus
            className="w-full bg-void text-slate-100 font-mono text-xs rounded-xl px-3.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
          />
        </div>

        <div className="p-5 pt-2 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <section key={group.title} className="space-y-2.5">
                <div className="pb-1.5 border-b border-cyberBorder/80">
                  <h4 className="text-xs font-extrabold text-cyberCyan tracking-wide">
                    {group.title}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{group.subtitle}</p>
                </div>

                <div className="divide-y divide-cyberBorder/50">
                  {group.items.map((item) => (
                    <div
                      key={item.label}
                      className="py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">{item.label}</div>
                        <div className="font-mono text-[10px] text-slate-400 truncate">
                          {item.detail}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k, idx) => (
                          <React.Fragment key={`${item.label}-${k}-${idx}`}>
                            {idx > 0 && <span className="text-[10px] text-slate-500">+</span>}
                            <kbd className="px-2 py-0.5 rounded-md bg-void border border-cyberBorder text-[10px] font-mono font-bold text-slate-100 shadow-inner whitespace-nowrap">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="md:col-span-2 py-8 text-center text-xs text-slate-400 font-mono">
              No hay atajos que coincidan con "{filter}".
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex items-center justify-between gap-2 shrink-0 text-[11px] font-mono text-slate-400">
          <span>Pulsa Ctrl + / o ? para abrir esta guía en cualquier momento</span>
          <button
            onClick={onClose}
            className="neon-btn-cyan px-4 py-1.5 rounded-xl font-extrabold text-xs cursor-pointer whitespace-nowrap"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL 8: CONFIRMACIÓN DE MARCA DE AGUA ANTES DE SUBIR AL HOST DE IMÁGENES
   ============================================================================ */
interface WatermarkPromptModalProps {
  open: boolean;
  previewDataUrl: string;
  imageCount: number;
  hostLabel: string;
  contextLabel: string;
  config: UserConfig;
  onSaveDefaults: (patch: Partial<UserConfig>) => void;
  onConfirmWatermark: (settings: WatermarkSettings) => void;
  onConfirmClean: () => void;
  onCancel: () => void;
}

export const WatermarkPromptModal: React.FC<WatermarkPromptModalProps> = ({
  open,
  previewDataUrl,
  imageCount,
  hostLabel,
  contextLabel,
  config,
  onSaveDefaults,
  onConfirmWatermark,
  onConfirmClean,
  onCancel,
}) => {
  const [userText, setUserText] = useState(config.watermarkUser || '');
  const [placeText, setPlaceText] = useState(config.watermarkPlace || '');
  const [position, setPosition] = useState<WatermarkPosition>(config.watermarkPosition || 'bottom-right');
  const [opacity, setOpacity] = useState<number>(config.watermarkOpacity ?? 0.82);
  const [color, setColor] = useState<string>(config.watermarkColor || '#ffffff');
  const [scale, setScale] = useState<'sm' | 'md' | 'lg'>(config.watermarkScale || 'md');
  const [renderedPreview, setRenderedPreview] = useState(previewDataUrl);

  useEffect(() => {
    if (open) {
      setUserText(config.watermarkUser || '');
      setPlaceText(config.watermarkPlace || '');
      setPosition(config.watermarkPosition || 'bottom-right');
      setOpacity(config.watermarkOpacity ?? 0.82);
      setColor(config.watermarkColor || '#ffffff');
      setScale(config.watermarkScale || 'md');
      setRenderedPreview(previewDataUrl);
    }
  }, [
    open,
    previewDataUrl,
    config.watermarkUser,
    config.watermarkPlace,
    config.watermarkPosition,
    config.watermarkOpacity,
    config.watermarkColor,
    config.watermarkScale,
  ]);

  useEffect(() => {
    if (!open || !previewDataUrl) return;
    let cancelled = false;
    const label = formatWatermarkLabel(userText, placeText);
    if (!label) {
      setRenderedPreview(previewDataUrl);
      return;
    }
    applyWatermarkToDataUrl(previewDataUrl, {
      userText,
      placeText,
      position,
      opacity,
      color,
      scale,
    })
      .then((res) => {
        if (!cancelled) setRenderedPreview(res);
      })
      .catch(() => {
        if (!cancelled) setRenderedPreview(previewDataUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [open, previewDataUrl, userText, placeText, position, opacity, color, scale]);

  if (!open) return null;

  const watermarkText = formatWatermarkLabel(userText, placeText);

  const persistWatermarkPrefs = () => {
    onSaveDefaults({
      watermarkUser: userText,
      watermarkPlace: placeText,
      watermarkPosition: position,
      watermarkOpacity: opacity,
      watermarkColor: color,
      watermarkScale: scale,
    });
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="watermark-modal-title"
        className="anim-enter w-full max-w-3xl bg-panel border border-cyberCyan/70 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 id="watermark-modal-title" className="text-sm font-extrabold text-white truncate">
              ¿Añadir marca de agua antes de subir a {hostLabel}?
            </h3>
            <p className="text-[11px] text-slate-400 truncate">
              {contextLabel} · {imageCount} {imageCount === 1 ? 'imagen lista' : 'imágenes listas'} para subir
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancelar subida"
            className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 border border-cyberBorder text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-5">
          <div className="md:col-span-6 flex flex-col gap-2">
            <div className="text-[10px] font-mono text-cyberCyan uppercase font-bold">
              Vista previa en tiempo real
            </div>
            <div className="flex-1 min-h-[210px] rounded-xl bg-void border border-cyberBorder flex items-center justify-center p-2 overflow-hidden">
              {renderedPreview ? (
                <img
                  src={renderedPreview}
                  alt="Vista previa con marca de agua"
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-[280px] object-contain rounded-lg"
                />
              ) : (
                <span className="text-xs font-mono text-slate-500">Sin vista previa</span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400 truncate">
              Texto resultante:{' '}
              <span className={watermarkText ? 'text-cyberGreen font-bold' : 'text-amber-300'}>
                {watermarkText || '(Escribe tu Usuario o Lugar de Posteo)'}
              </span>
            </div>
          </div>

          <div className="md:col-span-6 space-y-3 text-xs">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                USUARIO / NICK (OPCIONAL SI USAS LUGAR):
              </label>
              <input
                type="text"
                value={userText}
                onChange={(e) => setUserText(e.target.value)}
                placeholder="Ej. @Aensy77 o PostProUser"
                autoFocus
                className="w-full bg-void text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                LUGAR DE POSTEO (FORO, BLOG, WEB):
              </label>
              <input
                type="text"
                value={placeText}
                onChange={(e) => setPlaceText(e.target.value)}
                placeholder="Ej. ForoClubHD.com o Telegram @Canal"
                className="w-full bg-void text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">POSICIÓN:</label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as WatermarkPosition)}
                  className="w-full bg-void text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-2 border border-cyberBorder cursor-pointer"
                >
                  {(Object.keys(WATERMARK_POSITION_LABELS) as WatermarkPosition[]).map((pos) => (
                    <option key={pos} value={pos}>
                      {WATERMARK_POSITION_LABELS[pos]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">TAMAÑO:</label>
                <select
                  value={scale}
                  onChange={(e) => setScale(e.target.value as 'sm' | 'md' | 'lg')}
                  className="w-full bg-void text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-2 border border-cyberBorder cursor-pointer"
                >
                  <option value="sm">Pequeño</option>
                  <option value="md">Medio</option>
                  <option value="lg">Grande</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 items-center">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  OPACIDAD ({Math.round(opacity * 100)}%):
                </label>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">COLOR DEL TEXTO:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-9 h-8 rounded bg-void border border-cyberBorder cursor-pointer p-0.5 shrink-0"
                  />
                  <span className="font-mono text-[11px] text-slate-300 uppercase">{color}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-elevated border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-xl bg-void hover:bg-panel border border-cyberBorder text-slate-300 font-semibold text-xs cursor-pointer"
          >
            Cancelar subida
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                persistWatermarkPrefs();
                onConfirmClean();
              }}
              className="px-4 py-2 rounded-xl bg-void hover:bg-panel border border-cyberBorder hover:border-slate-400 text-slate-200 font-bold text-xs cursor-pointer whitespace-nowrap"
            >
              Subir SIN marca de agua
            </button>
            <button
              type="button"
              disabled={!watermarkText}
              onClick={() => {
                persistWatermarkPrefs();
                onConfirmWatermark({
                  userText,
                  placeText,
                  position,
                  opacity,
                  color,
                  scale,
                });
              }}
              title={
                watermarkText
                  ? 'Estampar Usuario / Lugar de Posteo y subir'
                  : 'Escribe primero tu Usuario o Lugar de Posteo'
              }
              className="neon-btn-cyan px-4 py-2 rounded-xl font-extrabold text-xs cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed"
            >
              💧 Añadir marca de agua y subir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL: IDENTIFICAR CONTENIDO POR ID DE PROVEEDOR
   ============================================================================ */
export interface IdentifyMediaPayload {
  mediaType: 'movie' | 'tv' | 'music';
  tmdbId: string;
  imdbId: string;
  tvdbId: string;
  mbidId: string;
  anilistId: string;
  tvmazeId: string;
  title: string;
  year: string;
  artist: string;
}

interface IdentifyMediaModalProps {
  open: boolean;
  initialValues: IdentifyMediaPayload;
  activeProviderId: string;
  syncing?: boolean;
  onClose: () => void;
  onSaveOnly: (payload: IdentifyMediaPayload) => void;
  onIdentifyAndSync: (payload: IdentifyMediaPayload) => Promise<void>;
}

export const IdentifyMediaModal: React.FC<IdentifyMediaModalProps> = ({
  open,
  initialValues,
  activeProviderId,
  syncing = false,
  onClose,
  onSaveOnly,
  onIdentifyAndSync,
}) => {
  const [providerTab, setProviderTab] = useState<'tmdb' | 'omdb' | 'fanart' | 'anime_tv'>('tmdb');
  const [mediaType, setMediaType] = useState<'movie' | 'tv' | 'music'>(initialValues.mediaType);
  const [tmdbId, setTmdbId] = useState(initialValues.tmdbId);
  const [imdbId, setImdbId] = useState(initialValues.imdbId);
  const [tvdbId, setTvdbId] = useState(initialValues.tvdbId);
  const [mbidId, setMbidId] = useState(initialValues.mbidId);
  const [anilistId, setAnilistId] = useState(initialValues.anilistId);
  const [tvmazeId, setTvmazeId] = useState(initialValues.tvmazeId);
  const [title, setTitle] = useState(initialValues.title);
  const [year, setYear] = useState(initialValues.year);
  const [artist, setArtist] = useState(initialValues.artist);

  useEffect(() => {
    if (!open) return;
    setMediaType(initialValues.mediaType);
    setTmdbId(initialValues.tmdbId);
    setImdbId(initialValues.imdbId);
    setTvdbId(initialValues.tvdbId);
    setMbidId(initialValues.mbidId);
    setAnilistId(initialValues.anilistId);
    setTvmazeId(initialValues.tvmazeId);
    setTitle(initialValues.title);
    setYear(initialValues.year);
    setArtist(initialValues.artist);
    if (activeProviderId === 'prov-omdb') setProviderTab('omdb');
    else if (activeProviderId === 'prov-fanart' || activeProviderId === 'prov-musicbrainz') setProviderTab('fanart');
    else if (activeProviderId === 'prov-anilist' || activeProviderId === 'prov-tvmaze') setProviderTab('anime_tv');
    else setProviderTab('tmdb');
  }, [open, initialValues, activeProviderId]);

  if (!open) return null;

  const buildPayload = (): IdentifyMediaPayload => ({
    mediaType,
    tmdbId: tmdbId.trim(),
    imdbId: imdbId.trim(),
    tvdbId: tvdbId.trim(),
    mbidId: mbidId.trim(),
    anilistId: anilistId.trim(),
    tvmazeId: tvmazeId.trim(),
    title: title.trim(),
    year: year.trim(),
    artist: artist.trim(),
  });

  const handleClearIds = () => {
    setTmdbId('');
    setImdbId('');
    setTvdbId('');
    setMbidId('');
    setAnilistId('');
    setTvmazeId('');
  };

  return (
    <div className="fixed inset-0 z-[72] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-panel border-2 border-cyberCyan/60 rounded-2xl shadow-[0_24px_72px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
              <span>🎯</span>
              <span>Identificar Contenido por ID de Proveedor</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Inserta el ID o enlace directo según el proveedor para sincronizar sinopsis, título, rating y artes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Tipo de medio */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-mono text-cyberCyan uppercase font-bold">
              Tipo de Contenido:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['movie', '🎬 Película'],
                  ['tv', '📺 Serie / Anime'],
                  ['music', '🎵 Música / Álbum'],
                ] as const
              ).map(([typeKey, label]) => (
                <button
                  key={typeKey}
                  type="button"
                  onClick={() => setMediaType(typeKey)}
                  className={`px-3 py-2 rounded-xl border font-bold text-xs cursor-pointer transition-colors ${
                    mediaType === typeKey
                      ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan'
                      : 'bg-void border-cyberBorder text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Selector de proveedor */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-void p-1 rounded-xl border border-cyberBorder">
              {(
                [
                  ['tmdb', '🎬 TMDB', 'text-cyberCyan'],
                  ['omdb', '🎞️ OMDb / IMDb', 'text-amber-300'],
                  ['fanart', '🎨 Fanart.tv', 'text-cyberGreen'],
                  ['anime_tv', '⛩️ AniList / TVMaze', 'text-cyberMagenta'],
                ] as const
              ).map(([tabKey, label, activeTxt]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setProviderTab(tabKey)}
                  className={`px-2 py-1.5 rounded-lg font-mono text-[11px] font-bold cursor-pointer transition-colors ${
                    providerTab === tabKey
                      ? `bg-elevated border border-cyberBorder ${activeTxt}`
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-void/80 border border-cyberBorder p-3.5 space-y-3">
              {providerTab === 'tmdb' && (
                <>
                  <div className="text-[11px] text-slate-300">
                    <span className="font-bold text-cyberCyan">TMDB:</span> Usa un ID numérico (ej. <span className="font-mono text-white">1311031</span>) o pega directamente la URL de TheMovieDB (<span className="font-mono text-slate-400">themoviedb.org/movie/...</span> o <span className="font-mono text-slate-400">/tv/...</span>).
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      TMDB ID o URL:
                    </label>
                    <input
                      type="text"
                      value={tmdbId}
                      onChange={(e) => setTmdbId(e.target.value)}
                      placeholder="Ej. 1311031 o https://www.themoviedb.org/movie/1311031"
                      className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                    />
                  </div>
                </>
              )}

              {providerTab === 'omdb' && (
                <>
                  <div className="text-[11px] text-slate-300">
                    <span className="font-bold text-amber-300">OMDb / IMDb:</span> Usa el código IMDb (ej. <span className="font-mono text-white">tt32820897</span>) o pega la URL de IMDb. Si también tienes TMDB conectado, resolverá ambos.
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      IMDb ID o URL:
                    </label>
                    <input
                      type="text"
                      value={imdbId}
                      onChange={(e) => setImdbId(e.target.value)}
                      placeholder="Ej. tt32820897 o https://www.imdb.com/title/tt32820897/"
                      className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </>
              )}

              {providerTab === 'fanart' && (
                <>
                  <div className="text-[11px] text-slate-300">
                    <span className="font-bold text-cyberGreen">Fanart.tv:</span> Para <span className="text-white font-semibold">Películas</span> usa el <span className="font-mono">TMDB/IMDb ID</span>; para <span className="text-white font-semibold">Series/Anime</span> usa <span className="font-mono">TVDB ID</span> (o TMDB ID); para <span className="text-white font-semibold">Música</span> usa <span className="font-mono">MusicBrainz MBID</span>.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        TVDB ID (Series / Anime):
                      </label>
                      <input
                        type="text"
                        value={tvdbId}
                        onChange={(e) => setTvdbId(e.target.value)}
                        placeholder="Ej. 348545"
                        className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberGreen"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        MusicBrainz MBID (Música):
                      </label>
                      <input
                        type="text"
                        value={mbidId}
                        onChange={(e) => setMbidId(e.target.value)}
                        placeholder="UUID Artista o Álbum"
                        className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberGreen"
                      />
                    </div>
                  </div>
                </>
              )}

              {providerTab === 'anime_tv' && (
                <>
                  <div className="text-[11px] text-slate-300">
                    <span className="font-bold text-cyberMagenta">AniList / TVMaze:</span> Útil cuando el título de anime o serie no coincide por nombre y deseas forzar su ID exacto.
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        AniList ID (Anime):
                      </label>
                      <input
                        type="text"
                        value={anilistId}
                        onChange={(e) => setAnilistId(e.target.value)}
                        placeholder="Ej. 166240"
                        className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberMagenta"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono text-slate-400 mb-1">
                        TVMaze ID (Series):
                      </label>
                      <input
                        type="text"
                        value={tvmazeId}
                        onChange={(e) => setTvmazeId(e.target.value)}
                        placeholder="Ej. 82"
                        className="w-full bg-panel text-white font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberMagenta"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Título / Año de respaldo */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <div className="sm:col-span-3">
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Título de referencia (opcional si indicas ID):
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título de película, serie o álbum..."
                className="w-full bg-void text-white rounded-lg px-3 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">Año:</label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2025"
                className="w-full bg-void text-white font-mono rounded-lg px-3 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
            </div>
          </div>

          {mediaType === 'music' && (
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Artista (para Música / MusicBrainz):
              </label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Nombre del artista o banda..."
                className="w-full bg-void text-white rounded-lg px-3 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
            </div>
          )}

          {/* Resumen rápido de IDs activos */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-void/70 border border-cyberBorder/80 text-[10px] font-mono">
            <div className="flex flex-wrap items-center gap-2 text-slate-300">
              <span>TMDB: <b className="text-cyberCyan">{tmdbId || '—'}</b></span>
              <span>IMDb: <b className="text-amber-300">{imdbId || '—'}</b></span>
              <span>TVDB: <b className="text-cyberGreen">{tvdbId || '—'}</b></span>
              <span>MBID: <b className="text-cyberMagenta">{mbidId ? `${mbidId.slice(0, 8)}…` : '—'}</b></span>
            </div>
            <button
              type="button"
              onClick={handleClearIds}
              className="text-rose-400 hover:text-rose-300 cursor-pointer underline"
            >
              Limpiar IDs
            </button>
          </div>
        </div>

        <div className="px-5 py-3.5 bg-elevated border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-void hover:bg-panel border border-cyberBorder text-slate-300 font-semibold text-xs cursor-pointer"
          >
            Cancelar
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSaveOnly(buildPayload());
                onClose();
              }}
              className="px-3.5 py-2 rounded-xl bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-slate-200 font-bold text-xs cursor-pointer"
            >
              💾 Solo guardar IDs
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={() => void onIdentifyAndSync(buildPayload())}
              className="neon-btn-cyan px-4 py-2 rounded-xl font-extrabold text-xs cursor-pointer disabled:opacity-50"
            >
              {syncing ? '⏳ Identificando...' : '🎯 Identificar y Sincronizar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   MODAL: GESTOR DE CONTRASEÑAS GUARDADAS
   ============================================================================ */
interface PasswordManagerModalProps {
  open: boolean;
  savedPasswords: SavedPasswordEntry[];
  currentPostPassword: string;
  currentPostBody: string;
  onClose: () => void;
  onUpdateSavedPasswords: (next: SavedPasswordEntry[]) => void;
  onApplyPasswordToPost: (
    passwordText: string,
    options?: { ensureVariable?: boolean; matchHeadingUppercase?: boolean }
  ) => void;
  onInsertAtCursor: (text: string) => void;
  onEnsureVariableBelowHeading: () => void;
}

export const PasswordManagerModal: React.FC<PasswordManagerModalProps> = ({
  open,
  savedPasswords,
  currentPostPassword,
  currentPostBody,
  onClose,
  onUpdateSavedPasswords,
  onApplyPasswordToPost,
  onInsertAtCursor,
  onEnsureVariableBelowHeading,
}) => {
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [forceUpperOnSave, setForceUpperOnSave] = useState(false);
  const [matchHeadingUppercase, setMatchHeadingUppercase] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editValue, setEditValue] = useState('');
  const [customQuickPass, setCustomQuickPass] = useState('');

  useEffect(() => {
    if (!open) return;
    setCustomQuickPass(currentPostPassword || '');
    setSearchQuery('');
    setEditingId(null);
  }, [open, currentPostPassword]);

  if (!open) return null;

  const headingInfo = detectPasswordHeadingInfo(currentPostBody);

  const previewAppliedText = (raw: string, forceUpper = false) => {
    if (forceUpper || (matchHeadingUppercase && headingInfo.headingIsUppercase)) {
      return raw.toUpperCase();
    }
    return raw;
  };

  const handleSaveNew = () => {
    const cleanVal = (forceUpperOnSave ? newValue.toUpperCase() : newValue).trim();
    if (!cleanVal) return;

    const alreadyExists = savedPasswords.some(
      (p) => p.value === cleanVal && (p.label || '') === newLabel.trim()
    );
    if (alreadyExists) {
      setNewValue('');
      setNewLabel('');
      return;
    }

    const entry: SavedPasswordEntry = {
      id: `pw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: newLabel.trim() || undefined,
      value: cleanVal,
      uppercase: cleanVal === cleanVal.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(cleanVal),
      createdAt: Date.now(),
    };
    onUpdateSavedPasswords([entry, ...savedPasswords]);
    setNewLabel('');
    setNewValue('');
  };

  const handleSaveEdit = (id: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    onUpdateSavedPasswords(
      savedPasswords.map((p) =>
        p.id === id
          ? {
              ...p,
              label: editLabel.trim() || undefined,
              value: trimmed,
              uppercase: trimmed === trimmed.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(trimmed),
            }
          : p
      )
    );
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    onUpdateSavedPasswords(savedPasswords.filter((p) => p.id !== id));
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredPasswords = q
    ? savedPasswords.filter(
        (p) =>
          p.value.toLowerCase().includes(q) ||
          (p.label && p.label.toLowerCase().includes(q))
      )
    : savedPasswords;

  return (
    <div className="fixed inset-0 z-[72] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-panel border-2 border-cyberCyan/60 rounded-2xl shadow-[0_24px_72px_rgba(0,0,0,0.95)] overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div>
            <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
              <span>🔑</span>
              <span>Contraseñas Guardadas y Variable del Post</span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Guarda tus contraseñas frecuentes y elígelas para insertarlas debajo de{' '}
              <span className="text-cyberCyan font-mono">Password / Contraseña</span> respetando o coincidiendo con mayúsculas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center text-xs cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3.5 text-xs">
          {/* Estado de la variable en el post activo */}
          <div className="bg-void/90 border border-cyberBorder rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Contraseña activa en el post ({'{{password}}'})
                </div>
                <div className="font-mono text-sm font-bold text-cyberGreen truncate">
                  {currentPostPassword || 'Sin Password'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {headingInfo.hasVariableBelowHeading || headingInfo.hasVariableAnywhere ? (
                  <span className="px-2 py-0.5 rounded bg-cyberGreen/15 border border-cyberGreen/50 text-cyberGreen font-mono text-[10px] font-bold">
                    {headingInfo.hasHeading
                      ? headingInfo.headingIsUppercase
                        ? '✔ Variable debajo de PASSWORD/CONTRASEÑA (MAYÚS)'
                        : '✔ Variable debajo de Password/Contraseña'
                      : '✔ Variable {{password}} activa'}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onEnsureVariableBelowHeading}
                    className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 text-amber-200 font-mono text-[10px] font-bold cursor-pointer"
                  >
                    + Crear variable debajo de Password/Contraseña
                  </button>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 pt-1 border-t border-cyberBorder/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={matchHeadingUppercase}
                onChange={(e) => setMatchHeadingUppercase(e.target.checked)}
                className="accent-cyberCyan cursor-pointer"
              />
              <span className="text-[11px] text-slate-300">
                Coincidir automáticamente en <b className="text-cyberCyan font-mono">MAYÚSCULAS</b> cuando el encabezado del post esté en mayúsculas{' '}
                <span className="font-mono text-[10px] text-slate-400">
                  ({headingInfo.headingIsUppercase ? 'detectado: MAYÚSCULAS' : 'detectado: normal'})
                </span>
              </span>
            </label>
          </div>

          {/* Guardar nueva contraseña */}
          <div className="bg-void/70 border border-cyberCyan/35 rounded-xl p-3 space-y-2">
            <div className="text-[11px] font-mono font-bold text-cyberCyan uppercase">
              + Guardar nueva contraseña
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Etiqueta (ej. Zinfinal, Mega...)"
                className="sm:col-span-4 bg-panel text-slate-100 rounded-lg px-2.5 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan text-xs"
              />
              <div className="sm:col-span-5 flex items-center gap-1">
                <input
                  type="text"
                  value={forceUpperOnSave ? newValue.toUpperCase() : newValue}
                  onChange={(e) =>
                    setNewValue(forceUpperOnSave ? e.target.value.toUpperCase() : e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveNew();
                  }}
                  placeholder="Contraseña exacta..."
                  className="flex-1 min-w-0 bg-panel text-white font-mono rounded-lg px-2.5 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const nextUpper = !forceUpperOnSave;
                    setForceUpperOnSave(nextUpper);
                    if (nextUpper) setNewValue((v) => v.toUpperCase());
                  }}
                  title="Convertir a MAYÚSCULAS al guardar"
                  className={`px-2 py-1.5 rounded-lg border font-mono text-[10px] font-bold cursor-pointer shrink-0 ${
                    forceUpperOnSave
                      ? 'bg-cyberCyan/20 border-cyberCyan text-cyberCyan'
                      : 'bg-panel border-cyberBorder text-slate-400 hover:text-white'
                  }`}
                >
                  AA
                </button>
              </div>
              <div className="sm:col-span-3 flex gap-1">
                <button
                  type="button"
                  onClick={handleSaveNew}
                  disabled={!newValue.trim()}
                  className="flex-1 neon-btn-cyan px-3 py-1.5 rounded-lg font-extrabold text-xs cursor-pointer disabled:opacity-40 whitespace-nowrap"
                >
                  💾 Guardar
                </button>
              </div>
            </div>
          </div>

          {/* Lista de contraseñas guardadas */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-mono font-bold text-slate-300 uppercase">
                Contraseñas Guardadas ({filteredPasswords.length})
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar guardadas..."
                className="bg-void text-slate-200 font-mono text-[11px] rounded-lg px-2.5 py-1 border border-cyberBorder w-44 focus:outline-none focus:border-cyberCyan"
              />
            </div>

            {filteredPasswords.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cyberBorder bg-void/60 p-4 text-center text-slate-400 text-[11px]">
                No hay contraseñas guardadas que coincidan. Agrega una arriba para usarla con un clic.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                {filteredPasswords.map((entry) => {
                  const isEditing = editingId === entry.id;
                  const appliedPreview = previewAppliedText(entry.value);
                  const isActive =
                    currentPostPassword === entry.value ||
                    currentPostPassword === appliedPreview;
                  const isUpper =
                    entry.value === entry.value.toUpperCase() &&
                    /[A-ZÁÉÍÓÚÑ]/.test(entry.value);

                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border p-2.5 transition-colors ${
                        isActive
                          ? 'bg-cyberCyan/10 border-cyberCyan/70'
                          : 'bg-void/80 border-cyberBorder hover:border-cyberCyan/40'
                      }`}
                    >
                      {isEditing ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Etiqueta"
                            className="w-32 bg-panel text-slate-200 rounded px-2 py-1 border border-cyberBorder text-xs"
                          />
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(entry.id);
                            }}
                            className="flex-1 min-w-[140px] bg-panel text-white font-mono rounded px-2 py-1 border border-cyberBorder text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setEditValue((v) => v.toUpperCase())}
                            className="px-2 py-1 rounded bg-panel border border-cyberBorder text-cyberCyan font-mono text-[10px] font-bold cursor-pointer"
                            title="Pasar a MAYÚSCULAS"
                          >
                            AA
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(entry.id)}
                            className="px-2.5 py-1 rounded bg-cyberGreen/20 border border-cyberGreen text-cyberGreen font-bold text-[11px] cursor-pointer"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 rounded bg-panel border border-cyberBorder text-slate-300 text-[11px] cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {entry.label && (
                                <span className="px-1.5 py-0.5 rounded bg-panel border border-cyberBorder text-[10px] font-semibold text-cyberCyan">
                                  {entry.label}
                                </span>
                              )}
                              <span className="font-mono text-xs font-bold text-white select-all break-all">
                                {entry.value}
                              </span>
                              {isUpper && (
                                <span className="px-1 py-0.5 rounded bg-cyberMagenta/15 border border-cyberMagenta/40 text-cyberMagenta font-mono text-[9px] font-bold">
                                  MAYÚS
                                </span>
                              )}
                              {isActive && (
                                <span className="px-1.5 py-0.5 rounded bg-cyberGreen/20 border border-cyberGreen/50 text-cyberGreen font-mono text-[9px] font-bold">
                                  ✔ En uso
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                onApplyPasswordToPost(entry.value, {
                                  ensureVariable: true,
                                  matchHeadingUppercase,
                                });
                                onClose();
                              }}
                              className="neon-btn-cyan px-2.5 py-1 rounded-lg font-extrabold text-[10px] cursor-pointer whitespace-nowrap"
                              title={`Elegir e insertar "${appliedPreview}" debajo de Password / Contraseña`}
                            >
                              ✓ Elegir e Insertar
                            </button>
                            {!isUpper && (
                              <button
                                type="button"
                                onClick={() => {
                                  onApplyPasswordToPost(entry.value.toUpperCase(), {
                                    ensureVariable: true,
                                    matchHeadingUppercase: false,
                                  });
                                  onClose();
                                }}
                                className="px-2 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberMagenta/50 text-cyberMagenta font-mono font-bold text-[10px] cursor-pointer"
                                title={`Insertar en MAYÚSCULAS: ${entry.value.toUpperCase()}`}
                              >
                                AA
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                onInsertAtCursor(previewAppliedText(entry.value));
                                onClose();
                              }}
                              className="px-2 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder hover:border-cyberCyan text-slate-200 font-mono text-[10px] cursor-pointer"
                              title="Insertar texto exacto en la posición del cursor del Editor BBCode"
                            >
                              📝 Cursor
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditLabel(entry.label || '');
                                setEditValue(entry.value);
                              }}
                              className="w-6 h-6 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder text-slate-300 hover:text-cyberCyan flex items-center justify-center text-[11px] cursor-pointer"
                              title="Editar contraseña guardada"
                            >
                              ✎
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(entry.id)}
                              className="w-6 h-6 rounded-lg bg-panel hover:bg-red-950/50 border border-cyberBorder hover:border-red-500/60 text-slate-400 hover:text-red-300 flex items-center justify-center text-[11px] cursor-pointer"
                              title="Eliminar contraseña guardada"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Contraseña rápida directa para este post */}
          <div className="bg-void/60 border border-cyberBorder rounded-xl p-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono text-slate-400 uppercase shrink-0">
              Rápida para este post:
            </span>
            <input
              type="text"
              value={customQuickPass}
              onChange={(e) => setCustomQuickPass(e.target.value)}
              placeholder="Escribe contraseña manual..."
              className="flex-1 min-w-[160px] bg-panel text-white font-mono text-xs rounded-lg px-2.5 py-1 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
            />
            <button
              type="button"
              onClick={() => {
                if (!customQuickPass.trim()) return;
                onApplyPasswordToPost(customQuickPass.trim(), {
                  ensureVariable: true,
                  matchHeadingUppercase,
                });
                onClose();
              }}
              className="px-2.5 py-1 rounded-lg bg-cyberGreen/20 hover:bg-cyberGreen/30 border border-cyberGreen/60 text-cyberGreen font-mono font-bold text-[10px] cursor-pointer whitespace-nowrap"
            >
              ✓ Aplicar al Post
            </button>
          </div>
        </div>

        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onInsertAtCursor('{{password}}');
              onClose();
            }}
            className="px-3 py-1.5 rounded-xl bg-void hover:bg-panel border border-cyberBorder hover:border-cyberCyan text-cyberCyan font-mono font-bold text-[11px] cursor-pointer"
          >
            + Insertar {'{{password}}'} en cursor
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-void hover:bg-panel border border-cyberBorder text-slate-200 font-semibold text-xs cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

interface TemplateExportModalProps {
  open: boolean;
  template: BbTemplate;
  onClose: () => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const TemplateExportModal: React.FC<TemplateExportModalProps> = ({
  open,
  template,
  onClose,
  onToast,
}) => {
  const [name, setName] = useState(template?.name || '');
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState('Uploader');
  const [compatibleSite, setCompatibleSite] = useState<string>(template?.site || 'zinfinal');
  const [description, setDescription] = useState('Plantilla BBCode exportada desde PostPro Studio');

  useEffect(() => {
    if (open && template) {
      setName(template.name);
      setCompatibleSite(template.site || 'zinfinal');
    }
  }, [open, template]);

  if (!open || !template) return null;

  const handleExport = () => {
    const authorship = {
      name: name.trim() || template.name,
      version: version.trim() || '1.0.0',
      author: author.trim() || 'Anónimo',
      compatibleSites: [compatibleSite],
      description: description.trim(),
    };
    const tplData = {
      id: template.id,
      name: name.trim() || template.name,
      site: compatibleSite as any,
      category: template.category || 'video',
      titlePattern: template.titlePattern,
      bodyPattern: template.bodyPattern,
    };
    const checksum = computePostTemplateChecksum(authorship, tplData);

    const payload = {
      magicHeader: 'POSTPRO_STUDIO_POST_TEMPLATE_V1',
      format: 'postpro-studio-template',
      createdAt: Date.now(),
      authorship,
      template: tplData,
      checksum,
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (name || template.name).replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safeName}.Post`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onToast(`Plantilla exportada exitosamente como "${safeName}.Post"`, 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-panel border-2 border-cyberCyan/80 rounded-2xl w-full max-w-lg shadow-[0_24px_64px_rgba(0,240,255,0.25)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-cyberCyan text-base">📦</span>
            <h3 className="font-bold text-sm text-white">Exportar Plantilla a .Post (Seguro)</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-void border border-cyberBorder text-slate-400 hover:text-white flex items-center justify-center cursor-pointer">✕</button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <p className="text-xs text-slate-300 leading-relaxed">
            Empaqueta esta plantilla con metadatos de autoría en un archivo con la extensión exclusiva <strong className="text-cyberCyan font-mono">.Post</strong>.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Nombre del Diseño / Plantilla</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-void text-white font-mono text-xs rounded-xl px-3 py-2 border border-cyberBorder focus:border-cyberCyan focus:outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Versión</label>
                <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} className="w-full bg-void text-white font-mono text-xs rounded-xl px-3 py-2 border border-cyberBorder focus:border-cyberCyan focus:outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">Autor / Creador</label>
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full bg-void text-white font-mono text-xs rounded-xl px-3 py-2 border border-cyberBorder focus:border-cyberCyan focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Sitio Compatible</label>
              <select value={compatibleSite} onChange={(e) => setCompatibleSite(e.target.value)} className="w-full bg-void text-white font-mono text-xs rounded-xl px-3 py-2 border border-cyberBorder focus:border-cyberCyan focus:outline-none cursor-pointer">
                <option value="zinfinal">Zinfinal</option>
                <option value="identi">Identi</option>
                <option value="custom">Personalizado / Universal</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Descripción / Notas</label>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-void text-white font-mono text-xs rounded-xl px-3 py-2 border border-cyberBorder focus:border-cyberCyan focus:outline-none" />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 rounded-xl bg-void border border-cyberBorder text-slate-300 hover:text-white text-xs font-semibold cursor-pointer">Cancelar</button>
          <button onClick={handleExport} className="neon-btn-cyan px-4 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer">📥 Generar archivo .Post</button>
        </div>
      </div>
    </div>
  );
};




