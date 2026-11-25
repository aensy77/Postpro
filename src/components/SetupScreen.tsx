import React, { useState } from 'react';
import type { BbTemplate, ImageHostProvider, UserConfig } from '../types';
import { verifyImageHost } from '../utils/apiClient';
import { formatBytes, pickLocalDirectory, pickSingleLocalFile } from '../utils/filePicker';
import { APP_INFO, PostProLogo } from './PostProLogo';

interface SetupScreenProps {
  config: UserConfig;
  onUpdateConfig: (patch: Partial<UserConfig>) => void;
  onImportTemplatesFromFolder: (templates: BbTemplate[]) => void;
  onBack: () => void;
  onFinish: () => void;
  onToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({
  config,
  onUpdateConfig,
  onImportTemplatesFromFolder,
  onBack,
  onFinish,
  onToast,
}) => {
  const [verifyingHost, setVerifyingHost] = useState(false);
  const [hostStatus, setHostStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const handleBrowseBinary = async (which: 'ffmpeg' | 'mediainfo') => {
    const picked = await pickSingleLocalFile(
      which === 'ffmpeg' ? '.exe,.bin,.wasm,*/*' : '.exe,.dll,.so,*/*'
    );
    if (!picked) return;
    const displayPath = picked.meta.relativePath || picked.meta.name;
    if (which === 'ffmpeg') {
      onUpdateConfig({ ffmpegPath: displayPath, ffmpegLinkedFile: picked.meta });
      onToast(
        `Archivo vinculado: ${picked.meta.name} (${formatBytes(picked.meta.sizeBytes)})`,
        'success'
      );
    } else {
      onUpdateConfig({ mediainfoPath: displayPath, mediainfoLinkedFile: picked.meta });
      onToast(
        `Archivo vinculado: ${picked.meta.name} (${formatBytes(picked.meta.sizeBytes)})`,
        'success'
      );
    }
  };

  const handleBrowseTemplatesFolder = async () => {
    const res = await pickLocalDirectory({ parseTemplates: true });
    if (!res) return;
    if (res.importedTemplates.length > 0) {
      onImportTemplatesFromFolder(res.importedTemplates);
    }
    onUpdateConfig({
      templatesPath: res.folderName,
      templatesLinkedFolder: res.folderName,
      templatesCountFound: res.importedTemplates.length,
    });
    onToast(
      `Carpeta "${res.folderName}" leída (${res.files.length} archivos, ${res.importedTemplates.length} plantillas JSON)`,
      'success'
    );
  };

  const handleBrowseMediaFolder = async () => {
    const res = await pickLocalDirectory();
    if (!res) return;
    const mediaOnly = res.metas.filter((m) =>
      /\.(mkv|mp4|webm|mov|avi|flac|mp3|wav|ogg|m4a|nfo|jpg|png|webp)$/i.test(m.name)
    );
    onUpdateConfig({
      mediaFolderLinked: res.folderName,
      mediaFilesIndex: mediaOnly,
    });
    onToast(
      `Carpeta de medios "${res.folderName}" indexada (${mediaOnly.length} archivos multimedia)`,
      'success'
    );
  };

  const handleVerifyImageHost = async () => {
    setVerifyingHost(true);
    setHostStatus(null);
    const res = await verifyImageHost({
      provider: config.imgHostProvider,
      apiKey: config.imgHostKey,
      endpoint: config.imgHostEndpoint,
    });
    setVerifyingHost(false);

    if (res.ok) {
      const msg = `✔ Verificado HTTP ${res.status} (${res.latencyMs} ms)${res.details ? ` · ${res.details}` : ''}`;
      setHostStatus({ ok: true, text: msg });
      onToast(`Host de imágenes verificado (${res.latencyMs} ms)`, 'success');
    } else {
      const msg = `✕ Error: ${res.error || 'Fallo de autenticación'}`;
      setHostStatus({ ok: false, text: msg });
      onToast(res.error || 'No se pudo verificar el host de imágenes', 'error');
    }
  };

  return (
    <section className="fixed inset-0 z-50 cad-grid-bg flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="anim-enter w-full max-w-4xl bg-panel/95 border border-cyberBorder rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] flex flex-col max-h-[94vh] overflow-hidden">
        <div className="px-6 py-4 bg-elevated border-b border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <PostProLogo size={36} className="shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] font-mono text-cyberCyan uppercase tracking-widest">
                {APP_INFO.name} v{APP_INFO.version} · Por {APP_INFO.creator} · Auto-guardado activo
              </span>
              <h2 className="text-lg font-extrabold text-white truncate">
                Navegador de Medios, Binarios, Plantillas y Verificación de APIs
              </h2>
            </div>
          </div>
          <button
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg bg-void border border-cyberBorder text-xs text-slate-300 hover:text-white cursor-pointer"
          >
            ← Volver
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs">
          {/* 1. Carpeta de Medios Locales */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberCyan/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/50 flex items-center justify-center text-cyberCyan font-mono font-bold text-xs">
                  DIR
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Carpeta de Medios Locales{' '}
                    <span className="text-xs font-mono text-slate-400">(Explorador del Navegador)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Indexa tu carpeta de películas, series o música FLAC para acceder rápidamente desde el estudio.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold text-cyberCyan">
                {config.mediaFolderLinked
                  ? `✔ ${config.mediaFolderLinked} (${config.mediaFilesIndex?.length || 0} archivos)`
                  : 'Sin carpeta asignada'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={config.mediaFolderLinked || ''}
                onChange={(e) => onUpdateConfig({ mediaFolderLinked: e.target.value })}
                placeholder="Usa 'Examinar Carpeta' o escribe una etiqueta/ruta de referencia..."
                className="flex-1 bg-void text-slate-100 font-mono text-xs rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
              <button
                onClick={handleBrowseMediaFolder}
                className="px-4 py-2 rounded-lg bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/50 text-cyberCyan text-xs font-bold cursor-pointer shrink-0"
              >
                📂 Examinar Carpeta de Medios...
              </button>
            </div>
          </div>

          {/* 2. FFmpeg */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberCyan/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/50 flex items-center justify-center text-cyberCyan font-mono font-bold text-xs">
                  FF
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Ejecutable FFmpeg{' '}
                    <span className="text-xs font-mono text-slate-400">(Opcional · Capturas HTML5 Canvas incluidas)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    El navegador captura fotogramas de video y espectros de audio directamente; vincula tu binario si deseas registrar la ruta.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold text-cyberGreen">
                {config.ffmpegLinkedFile
                  ? `✔ ${config.ffmpegLinkedFile.name} (${formatBytes(config.ffmpegLinkedFile.sizeBytes)})`
                  : config.ffmpegPath
                  ? 'Ruta configurada'
                  : 'Motor Canvas del navegador listo'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={config.ffmpegPath}
                onChange={(e) => onUpdateConfig({ ffmpegPath: e.target.value })}
                placeholder="Selecciona ffmpeg.exe con Examinar o escribe la ruta..."
                className="flex-1 bg-void text-slate-100 font-mono text-xs rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
              <button
                onClick={() => handleBrowseBinary('ffmpeg')}
                className="px-3.5 py-2 rounded-lg bg-panel hover:bg-void border border-cyberBorder text-slate-200 text-xs font-semibold cursor-pointer shrink-0"
              >
                Examinar Archivo...
              </button>
            </div>
          </div>

          {/* 3. MediaInfo */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberMagenta/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberMagenta/50 flex items-center justify-center text-cyberMagenta font-mono font-bold text-xs">
                  MI
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Binario MediaInfo{' '}
                    <span className="text-xs font-mono text-slate-400">(Lectura Binaria Integrada MKV/FLAC/MP3/MP4)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Al soltar archivos, PostPro analiza cabeceras EBML, FLAC STREAMINFO, ID3v2, átomos MP4 y metadatos incrustados.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold text-cyberGreen">
                {config.mediainfoLinkedFile
                  ? `✔ ${config.mediainfoLinkedFile.name} (${formatBytes(config.mediainfoLinkedFile.sizeBytes)})`
                  : 'Analizador binario integrado activo'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mb-2.5">
              <input
                type="text"
                value={config.mediainfoPath}
                onChange={(e) => onUpdateConfig({ mediainfoPath: e.target.value })}
                placeholder="Selecciona MediaInfo.exe / .dll o escribe la ruta..."
                className="flex-1 bg-void text-slate-100 font-mono text-xs rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
              <button
                onClick={() => handleBrowseBinary('mediainfo')}
                className="px-3.5 py-2 rounded-lg bg-panel hover:bg-void border border-cyberBorder text-slate-200 text-xs font-semibold cursor-pointer shrink-0"
              >
                Examinar Archivo...
              </button>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={config.useNativeDll}
                onChange={(e) => onUpdateConfig({ useNativeDll: e.target.checked })}
                className="accent-cyan-400 w-4 h-4 rounded"
              />
              <span>Activar analizador binario automático al arrastrar y soltar archivos</span>
            </label>
          </div>

          {/* 4. Carpeta de Plantillas */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberPurple/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberPurple/50 flex items-center justify-center text-cyberPurple font-mono font-bold text-xs">
                  TPL
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Carpeta de Plantillas BBCode (.json)</h3>
                  <p className="text-[11px] text-slate-400">
                    Si eliges una carpeta con archivos JSON de plantillas PostPro, se importarán automáticamente.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold text-cyberPurple">
                {config.templatesLinkedFolder
                  ? `✔ ${config.templatesLinkedFolder} (${config.templatesCountFound || 0} importadas)`
                  : '4 plantillas base (Zinfinal & Identi)'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={config.templatesPath}
                onChange={(e) => onUpdateConfig({ templatesPath: e.target.value })}
                placeholder="Selecciona tu carpeta de plantillas con Examinar..."
                className="flex-1 bg-void text-slate-100 font-mono text-xs rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
              />
              <button
                onClick={handleBrowseTemplatesFolder}
                className="px-3.5 py-2 rounded-lg bg-panel hover:bg-void border border-cyberBorder text-slate-200 text-xs font-semibold cursor-pointer shrink-0"
              >
                📂 Examinar Carpeta...
              </button>
            </div>
          </div>

          {/* 5. Host de Imágenes con Verificación HTTP */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberGreen/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberGreen/50 flex items-center justify-center text-cyberGreen font-mono font-bold text-xs">
                  IMG
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Host de Imágenes{' '}
                    <span className="text-xs font-mono text-slate-400">(Subida directa y verificación vía Backend)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Ingresa tu API Key para subir covers y capturas directamente al servidor.
                  </p>
                </div>
              </div>
              {hostStatus && (
                <span
                  className={`font-mono text-[11px] font-bold ${
                    hostStatus.ok ? 'text-cyberGreen' : 'text-red-400'
                  }`}
                >
                  {hostStatus.text}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">PROVEEDOR DE HOST:</label>
                <select
                  value={config.imgHostProvider}
                  onChange={(e) => {
                    setHostStatus(null);
                    onUpdateConfig({ imgHostProvider: e.target.value as ImageHostProvider });
                  }}
                  className="w-full bg-void text-cyberCyan font-semibold text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan cursor-pointer"
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
                    setHostStatus(null);
                    onUpdateConfig({ imgHostKey: e.target.value });
                  }}
                  placeholder="Pega tu API Key..."
                  className="w-full bg-void text-slate-100 font-mono text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">FORMATO BBCODE & EXPIRACIÓN:</label>
                <div className="flex gap-1.5">
                  <select
                    value={config.imgHostFormat}
                    onChange={(e) =>
                      onUpdateConfig({ imgHostFormat: e.target.value as 'direct' | 'thumb' })
                    }
                    className="flex-1 bg-void text-slate-200 font-mono text-[11px] rounded-lg px-2 py-2 border border-cyberBorder cursor-pointer"
                  >
                    <option value="direct">[img]URL directa[/img]</option>
                    <option value="thumb">[url=full][img]thumb[/img][/url]</option>
                  </select>
                  <select
                    value={config.imgHostExpire}
                    onChange={(e) =>
                      onUpdateConfig({
                        imgHostExpire: e.target.value as UserConfig['imgHostExpire'],
                      })
                    }
                    className="bg-void text-slate-200 font-mono text-[11px] rounded-lg px-2 py-2 border border-cyberBorder cursor-pointer"
                  >
                    <option value="never">Nunca</option>
                    <option value="24h">24h</option>
                    <option value="7d">7 días</option>
                    <option value="30d">30 días</option>
                  </select>
                </div>
              </div>
            </div>

            {config.imgHostProvider === 'chevereto' && (
              <div className="mb-2">
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  ENDPOINT URL (CHEVERETO / CUSTOM API):
                </label>
                <input
                  type="text"
                  value={config.imgHostEndpoint}
                  onChange={(e) => onUpdateConfig({ imgHostEndpoint: e.target.value })}
                  placeholder="https://tu-servidor-chevereto.com/api/1/upload"
                  className="w-full bg-void text-cyberMagenta font-mono text-xs rounded-lg px-3 py-1.5 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
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
                onClick={handleVerifyImageHost}
                disabled={verifyingHost}
                className="px-3.5 py-1.5 rounded-lg bg-cyberCyan/15 hover:bg-cyberCyan/25 disabled:opacity-50 border border-cyberCyan/50 text-cyberCyan text-xs font-bold cursor-pointer"
              >
                {verifyingHost ? '⏳ Verificando HTTP...' : '⚡ Verificar Conexión'}
              </button>
            </div>
          </div>

          {/* 6. APIs de Metadatos & Fanart.tv v3.2 */}
          <div className="bg-elevated/90 border border-cyberBorder hover:border-cyberCyan/50 rounded-xl p-4 transition-colors">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-void border border-cyberCyan/50 flex items-center justify-center text-cyberCyan font-mono font-bold text-xs">
                  API
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    APIs de Metadatos &amp; Artwork{' '}
                    <span className="text-xs font-mono text-slate-400">(TMDB / OMDb + Fanart.tv v3.2)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Fanart.tv se encadena tras TMDB, OMDb, TVMaze y MusicBrainz para obtener Logos HD, Banners y ClearArt.
                  </p>
                </div>
              </div>
              <span className="font-mono text-[11px] font-bold text-cyberCyan">
                {config.fanartApiKey.trim() || config.fanartClientKey.trim()
                  ? '✔ Fanart.tv activo'
                  : 'Opcional'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">TMDB API KEY (V3):</label>
                <input
                  type="password"
                  value={config.tmdbApiKey}
                  onChange={(e) => onUpdateConfig({ tmdbApiKey: e.target.value })}
                  placeholder="Tu API Key de TMDB..."
                  className="w-full bg-void text-cyberCyan font-mono text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">OMDB / IMDB API KEY:</label>
                <input
                  type="password"
                  value={config.omdbApiKey}
                  onChange={(e) => onUpdateConfig({ omdbApiKey: e.target.value })}
                  placeholder="Tu API Key de OMDb..."
                  className="w-full bg-void text-cyberMagenta font-mono text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  FANART.TV API KEY (V3.2 · Banners/Logos/ClearArt):
                </label>
                <input
                  type="password"
                  value={config.fanartApiKey}
                  onChange={(e) => onUpdateConfig({ fanartApiKey: e.target.value })}
                  placeholder="Project API Key de Fanart.tv..."
                  className="w-full bg-void text-cyberGreen font-mono text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  FANART.TV CLIENT KEY (Opcional · Personal Key):
                </label>
                <input
                  type="password"
                  value={config.fanartClientKey}
                  onChange={(e) => onUpdateConfig({ fanartClientKey: e.target.value })}
                  placeholder="Client Key personal (acceso rápido VIP)..."
                  className="w-full bg-void text-slate-100 font-mono text-xs rounded-lg px-2.5 py-2 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-elevated border-t border-cyberBorder flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] font-mono text-cyberGreen">
            ✔ Guardado automático activo · {APP_INFO.fullName} v{APP_INFO.version} · {APP_INFO.creator}
          </span>
          <button
            onClick={onFinish}
            className="neon-btn-cyan px-6 py-2.5 rounded-xl font-extrabold text-xs tracking-wide cursor-pointer"
          >
            Guardar y Abrir {APP_INFO.name} →
          </button>
        </div>
      </div>
    </section>
  );
};
