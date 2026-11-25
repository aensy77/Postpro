import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_YOUTUBE_PRIORITIES } from '../data/defaults';
import type {
  UserConfig,
  YoutubeTrailerPriorityId,
  YoutubeTrailerPriorityRule,
  YoutubeTrailerResult,
} from '../types';
import { extractYoutubeVideoId, searchYoutubeTrailers } from '../utils/youtubeTrailer';

interface YoutubeTrailerModalProps {
  open: boolean;
  initialTitle: string;
  initialYear: string;
  currentTrailerUrl: string;
  tmdbId?: string;
  mediaType?: string;
  config: UserConfig;
  onUpdateConfig: (patch: Partial<UserConfig>) => void;
  onSelectTrailer: (url: string, result?: YoutubeTrailerResult) => void;
  onClose: () => void;
  onToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const PRIORITY_BADGE_STYLES: Record<YoutubeTrailerPriorityId, string> = {
  latino_dubbed: 'bg-cyberGreen/15 border-cyberGreen/60 text-cyberGreen',
  subtitled_es: 'bg-cyberCyan/15 border-cyberCyan/60 text-cyberCyan',
  original_lang: 'bg-cyberPurple/20 border-cyberPurple/60 text-purple-300',
};

const PRIORITY_SHORT_LABELS: Record<YoutubeTrailerPriorityId, string> = {
  latino_dubbed: 'Español Latino',
  subtitled_es: 'Subtitulado ES',
  original_lang: 'Idioma Original',
};

export const YoutubeTrailerModal: React.FC<YoutubeTrailerModalProps> = ({
  open,
  initialTitle,
  initialYear,
  currentTrailerUrl,
  tmdbId,
  mediaType,
  config,
  onUpdateConfig,
  onSelectTrailer,
  onClose,
  onToast,
}) => {
  const [searchTitle, setSearchTitle] = useState(initialTitle || '');
  const [searchYear, setSearchYear] = useState(initialYear || '');
  const [showPriorities, setShowPriorities] = useState(false);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<YoutubeTrailerResult[]>([]);
  const [filterPriority, setFilterPriority] = useState<'all' | YoutubeTrailerPriorityId>('all');
  const [previewVideo, setPreviewVideo] = useState<YoutubeTrailerResult | null>(null);
  const [manualUrlDraft, setManualUrlDraft] = useState(currentTrailerUrl || '');
  const [queriesInfo, setQueriesInfo] = useState<
    Array<{ priorityId: YoutubeTrailerPriorityId; label: string; query: string; count: number }>
  >([]);

  const priorities = useMemo(
    () =>
      Array.isArray(config.youtubeTrailerPriorities) && config.youtubeTrailerPriorities.length > 0
        ? config.youtubeTrailerPriorities
        : DEFAULT_YOUTUBE_PRIORITIES,
    [config.youtubeTrailerPriorities]
  );

  const runSearch = async (overrideTitle?: string, overrideYear?: string, overrideRules?: YoutubeTrailerPriorityRule[]) => {
    const t = (overrideTitle ?? searchTitle).trim();
    const y = (overrideYear ?? searchYear).trim();
    if (!t) {
      setErrorMsg('Escribe el nombre de la película o serie para buscar en YouTube.');
      return;
    }
    setSearching(true);
    setErrorMsg(null);
    setPreviewVideo(null);

    const res = await searchYoutubeTrailers({
      title: t,
      year: y,
      priorities: overrideRules || priorities,
      youtubeApiKey: config.youtubeApiKey,
      tmdbId,
      tmdbApiKey: config.tmdbApiKey,
      mediaType,
    });

    setSearching(false);
    setQueriesInfo(res.queriesExecuted);

    if (!res.ok && res.results.length === 0) {
      setResults([]);
      setErrorMsg(res.error || 'No se encontraron resultados en YouTube.');
      return;
    }

    setResults(res.results);
    setFilterPriority('all');
    if (res.results.length === 0) {
      setErrorMsg(`Sin coincidencias de trailer para "${t}${y ? ` (${y})` : ''}".`);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSearchTitle(initialTitle || '');
    setSearchYear(initialYear || '');
    setManualUrlDraft(currentTrailerUrl || '');
    setPreviewVideo(null);
    setErrorMsg(null);
    setFilterPriority('all');
    if (initialTitle && initialTitle.trim()) {
      void runSearch(initialTitle, initialYear);
    } else {
      setResults([]);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const movePriority = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= priorities.length) return;
    const next = [...priorities];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onUpdateConfig({ youtubeTrailerPriorities: next });
  };

  const togglePriorityEnabled = (id: YoutubeTrailerPriorityId) => {
    const enabledCount = priorities.filter((p) => p.enabled).length;
    const target = priorities.find((p) => p.id === id);
    if (target?.enabled && enabledCount <= 1) {
      onToast('Debe haber al menos 1 prioridad activa para buscar.', 'warning');
      return;
    }
    const next = priorities.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p));
    onUpdateConfig({ youtubeTrailerPriorities: next });
  };

  const updatePrioritySuffix = (id: YoutubeTrailerPriorityId, querySuffix: string) => {
    const next = priorities.map((p) => (p.id === id ? { ...p, querySuffix } : p));
    onUpdateConfig({ youtubeTrailerPriorities: next });
  };

  const resetDefaultPriorities = () => {
    const reset = DEFAULT_YOUTUBE_PRIORITIES.map((r) => ({ ...r }));
    onUpdateConfig({ youtubeTrailerPriorities: reset });
    onToast('Prioridades restablecidas: 1° Latino, 2° Subtitulado, 3° Original', 'info');
  };

  const filteredResults =
    filterPriority === 'all'
      ? results
      : results.filter((r) => r.matchedPriorityId === filterPriority);

  const countByPriority = (id: YoutubeTrailerPriorityId) =>
    results.filter((r) => r.matchedPriorityId === id).length;

  const currentVidId = extractYoutubeVideoId(currentTrailerUrl);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[72] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="yt-trailer-modal-title"
        className="anim-enter bg-panel border border-red-500/60 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.95)] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* HEADER */}
        <div className="px-5 py-3.5 bg-elevated border-b border-cyberBorder flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/70 flex items-center justify-center text-red-400 font-extrabold text-sm shrink-0">
              ▶
            </div>
            <div className="min-w-0">
              <h3 id="yt-trailer-modal-title" className="text-sm font-extrabold text-white truncate">
                Buscador de Trailers en YouTube (Por Prioridades)
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Busca por título y año · Inserta el video elegido en{' '}
                <code className="text-cyberCyan">{'{{trailer_url}}'}</code>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowPriorities((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border font-mono text-[11px] font-bold cursor-pointer transition-colors ${
                showPriorities
                  ? 'bg-cyberCyan/15 border-cyberCyan text-cyberCyan'
                  : 'bg-void hover:bg-panel border-cyberBorder hover:border-cyberCyan text-slate-200'
              }`}
            >
              ⚙ {showPriorities ? 'Ocultar Prioridades' : 'Configurar Prioridades'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar buscador de YouTube"
              className="w-8 h-8 rounded-lg bg-void hover:bg-red-600 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {/* BARRA DE BÚSQUEDA (NOMBRE + AÑO) */}
          <div className="bg-void/90 border border-cyberBorder rounded-xl p-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-7">
                <label className="block text-[10px] font-mono text-cyberCyan uppercase font-bold mb-1">
                  Nombre de la Película / Serie / Anime:
                </label>
                <input
                  type="text"
                  value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch();
                  }}
                  placeholder="Ej. Demon Slayer Castillo infinito, Dune Part Two..."
                  className="w-full bg-panel text-white font-semibold rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-red-400"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">
                  Año:
                </label>
                <input
                  type="text"
                  value={searchYear}
                  onChange={(e) => setSearchYear(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch();
                  }}
                  placeholder="2025"
                  className="w-full bg-panel text-cyberCyan font-mono rounded-lg px-3 py-2 border border-cyberBorder focus:outline-none focus:border-red-400 tabular-nums"
                />
              </div>
              <div className="sm:col-span-3">
                <button
                  type="button"
                  onClick={() => void runSearch()}
                  disabled={searching}
                  className="w-full py-2 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(220,38,38,0.35)] disabled:opacity-50"
                >
                  <span>{searching ? '⏳' : '🔍'}</span>
                  <span>{searching ? 'Buscando...' : 'Buscar Trailer'}</span>
                </button>
              </div>
            </div>

            {/* Resumen de prioridades activas */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-cyberBorder/50 text-[10px] font-mono">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-400">Orden de prioridad:</span>
                {priorities
                  .filter((p) => p.enabled)
                  .map((p, idx) => (
                    <span
                      key={p.id}
                      className={`px-2 py-0.5 rounded border font-bold ${PRIORITY_BADGE_STYLES[p.id]}`}
                    >
                      {idx + 1}º {PRIORITY_SHORT_LABELS[p.id]}
                    </span>
                  ))}
              </div>
              {currentTrailerUrl && (
                <span className="text-slate-400 truncate max-w-[260px]">
                  Actual:{' '}
                  <span className="text-cyberCyan">{currentVidId ? `youtu.be/${currentVidId}` : currentTrailerUrl}</span>
                </span>
              )}
            </div>
          </div>

          {/* PANEL DE CONFIGURACIÓN DE PRIORIDADES */}
          {showPriorities && (
            <div className="bg-void border border-cyberCyan/50 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-mono font-bold text-cyberCyan uppercase">
                    ⚙ Configuración de Prioridades de Trailer
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Ordena qué idioma/versión debe aparecer primero y personaliza las palabras clave de búsqueda.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={resetDefaultPriorities}
                    className="px-2.5 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder text-slate-300 font-mono text-[10px] cursor-pointer"
                  >
                    ↺ Restablecer orden
                  </button>
                  <button
                    type="button"
                    onClick={() => void runSearch()}
                    disabled={searching}
                    className="px-2.5 py-1 rounded-lg bg-cyberCyan/15 hover:bg-cyberCyan/25 border border-cyberCyan/60 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    ⚡ Aplicar y Re-buscar
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {priorities.map((rule, idx) => (
                  <div
                    key={rule.id}
                    className={`rounded-xl border p-2.5 flex flex-col sm:flex-row sm:items-center gap-2.5 ${
                      rule.enabled
                        ? 'bg-panel/90 border-cyberBorder'
                        : 'bg-panel/40 border-cyberBorder/40 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => movePriority(idx, -1)}
                          disabled={idx === 0}
                          title="Subir prioridad"
                          className="px-1.5 py-0.2 rounded bg-void border border-cyberBorder text-[9px] text-slate-300 hover:text-cyberCyan disabled:opacity-30 cursor-pointer"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => movePriority(idx, 1)}
                          disabled={idx === priorities.length - 1}
                          title="Bajar prioridad"
                          className="px-1.5 py-0.2 rounded bg-void border border-cyberBorder text-[9px] text-slate-300 hover:text-cyberCyan disabled:opacity-30 cursor-pointer"
                        >
                          ▼
                        </button>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-lg border font-mono text-[11px] font-extrabold tabular-nums ${PRIORITY_BADGE_STYLES[rule.id]}`}
                      >
                        #{idx + 1}
                      </span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px] font-mono text-slate-200">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => togglePriorityEnabled(rule.id)}
                          className="accent-cyan-400 w-3.5 h-3.5"
                        />
                        <span>Activa</span>
                      </label>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white text-xs">{rule.label}</div>
                      <div className="text-[10px] text-slate-400">{rule.description}</div>
                    </div>

                    <div className="sm:w-64 shrink-0">
                      <label className="block text-[9px] font-mono text-slate-400 mb-0.5">
                        Sufijo de búsqueda en YouTube:
                      </label>
                      <input
                        type="text"
                        value={rule.querySuffix}
                        onChange={(e) => updatePrioritySuffix(rule.id, e.target.value)}
                        className="w-full bg-void text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-cyberBorder/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-[10px] text-slate-400">
                  <strong className="text-slate-200">YouTube Data API v3 Key (Opcional):</strong> si la dejas vacía, PostPro busca directamente en YouTube sin requerir clave.
                </div>
                <input
                  type="password"
                  value={config.youtubeApiKey || ''}
                  onChange={(e) => onUpdateConfig({ youtubeApiKey: e.target.value })}
                  placeholder="AIza... (Opcional)"
                  className="sm:w-64 bg-panel text-slate-100 font-mono text-[11px] rounded-lg px-2.5 py-1 border border-cyberBorder focus:outline-none focus:border-cyberCyan"
                />
              </div>
            </div>
          )}

          {/* REPRODUCTOR INLINE DE PREVISUALIZACIÓN */}
          {previewVideo && (
            <div className="bg-void border border-red-500/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold shrink-0 ${PRIORITY_BADGE_STYLES[previewVideo.matchedPriorityId]}`}
                  >
                    #{previewVideo.priorityRank} {PRIORITY_SHORT_LABELS[previewVideo.matchedPriorityId]}
                  </span>
                  <span className="font-bold text-white text-xs truncate">{previewVideo.title}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectTrailer(previewVideo.url, previewVideo);
                      onClose();
                    }}
                    className="neon-btn-cyan px-3 py-1 rounded-lg font-extrabold text-[11px] cursor-pointer"
                  >
                    ✔ Elegir e Insertar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewVideo(null)}
                    className="px-2 py-1 rounded-lg bg-panel border border-cyberBorder text-slate-300 hover:text-white text-[11px] cursor-pointer"
                  >
                    Cerrar video
                  </button>
                </div>
              </div>
              <div className="aspect-video w-full max-h-[300px] rounded-lg overflow-hidden bg-black border border-cyberBorder">
                <iframe
                  title={previewVideo.title}
                  src={`https://www.youtube.com/embed/${previewVideo.videoId}?autoplay=1`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* FILTROS Y ACCIÓN RÁPIDA */}
          {results.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterPriority('all')}
                  className={`px-2.5 py-1 rounded-lg border font-mono text-[10px] font-bold cursor-pointer tabular-nums ${
                    filterPriority === 'all'
                      ? 'bg-panel border-cyberCyan text-cyberCyan'
                      : 'bg-void border-cyberBorder text-slate-400 hover:text-white'
                  }`}
                >
                  Todos ({results.length})
                </button>
                {priorities
                  .filter((p) => p.enabled)
                  .map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFilterPriority(p.id)}
                      className={`px-2.5 py-1 rounded-lg border font-mono text-[10px] font-bold cursor-pointer tabular-nums ${
                        filterPriority === p.id
                          ? PRIORITY_BADGE_STYLES[p.id]
                          : 'bg-void border-cyberBorder text-slate-400 hover:text-white'
                      }`}
                    >
                      #{idx + 1} {PRIORITY_SHORT_LABELS[p.id]} ({countByPriority(p.id)})
                    </button>
                  ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const best = results[0];
                  if (!best) return;
                  onSelectTrailer(best.url, best);
                  onClose();
                }}
                className="px-3 py-1 rounded-lg bg-cyberGreen/15 hover:bg-cyberGreen/25 border border-cyberGreen/60 text-cyberGreen font-mono text-[10px] font-bold cursor-pointer"
              >
                ⚡ Elegir Mejor Coincidencia (#1)
              </button>
            </div>
          )}

          {/* MENSAJE DE ERROR O CARGA */}
          {errorMsg && (
            <div className="bg-amber-950/30 border border-amber-500/50 rounded-xl p-3 text-amber-200 text-xs flex items-center justify-between gap-2">
              <span>⚠ {errorMsg}</span>
              <button
                type="button"
                onClick={() => void runSearch()}
                className="px-2.5 py-1 rounded bg-void border border-amber-400/50 text-amber-200 font-mono text-[10px] cursor-pointer shrink-0"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* LISTADO DE RESULTADOS */}
          {searching ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-24 rounded-xl bg-void/80 border border-cyberBorder animate-pulse flex items-center gap-3 p-3"
                >
                  <div className="w-36 h-20 rounded-lg bg-panel shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 bg-panel rounded" />
                    <div className="h-2.5 w-1/3 bg-panel rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredResults.length > 0 ? (
            <div className="space-y-2">
              {filteredResults.map((item, idx) => {
                const isCurrent = currentVidId && currentVidId === item.videoId;
                const isBestOverall = idx === 0 && filterPriority === 'all';
                return (
                  <div
                    key={item.videoId}
                    className={`rounded-xl border p-2.5 flex flex-col sm:flex-row gap-3 transition-colors ${
                      isCurrent
                        ? 'bg-cyberGreen/10 border-cyberGreen'
                        : isBestOverall
                        ? 'bg-void border-cyberCyan/60'
                        : 'bg-void/90 border-cyberBorder hover:border-cyberCyan/50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewVideo(item)}
                      className="sm:w-44 aspect-video rounded-lg overflow-hidden bg-black border border-cyberBorder relative group shrink-0 cursor-pointer"
                      title="Previsualizar video dentro del modal"
                    >
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/30 group-hover:bg-black/15 flex items-center justify-center">
                        <span className="w-9 h-9 rounded-full bg-red-600/90 text-white flex items-center justify-center text-sm shadow-lg">
                          ▶
                        </span>
                      </div>
                      {item.duration && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/85 text-white font-mono text-[9px] font-bold tabular-nums">
                          {item.duration}
                        </span>
                      )}
                    </button>

                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded border font-mono text-[10px] font-bold ${PRIORITY_BADGE_STYLES[item.matchedPriorityId]}`}
                          >
                            Prioridad #{item.priorityRank} · {PRIORITY_SHORT_LABELS[item.matchedPriorityId]}
                          </span>
                          {isBestOverall && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/60 text-amber-200 font-mono text-[10px] font-bold">
                              ★ Recomendado
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded bg-cyberGreen/20 border border-cyberGreen text-cyberGreen font-mono text-[10px] font-bold">
                              ✔ En el post
                            </span>
                          )}
                          {item.badges.slice(0, 3).map((b) => (
                            <span
                              key={b}
                              className="px-1.5 py-0.5 rounded bg-panel border border-cyberBorder text-slate-300 font-mono text-[9px]"
                            >
                              {b}
                            </span>
                          ))}
                        </div>

                        <h4 className="font-bold text-white text-xs sm:text-[13px] leading-snug line-clamp-2">
                          {item.title}
                        </h4>

                        <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center gap-x-2">
                          <span className="text-slate-200 font-semibold">{item.channel}</span>
                          {item.views && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.views}</span>
                            </>
                          )}
                          {item.published && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.published}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-cyberBorder/50">
                        <span className="font-mono text-[10px] text-slate-400 truncate">
                          {item.url}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewVideo(item)}
                            className="px-2.5 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberBorder hover:border-red-400 text-slate-200 font-mono text-[10px] font-bold cursor-pointer"
                          >
                            ▶ Ver
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectTrailer(item.url, item);
                              onClose();
                            }}
                            className="neon-btn-cyan px-3 py-1 rounded-lg font-extrabold text-[11px] cursor-pointer"
                          >
                            ✔ Usar este Trailer
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !errorMsg ? (
            <div className="rounded-xl border border-dashed border-cyberBorder bg-void/70 p-6 text-center space-y-2">
              <div className="text-sm font-bold text-slate-200">
                Listo para buscar el trailer oficial
              </div>
              <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                Ingresa el nombre y año de la película o serie arriba y pulsa{' '}
                <strong className="text-red-400">Buscar Trailer</strong>. Se aplicarán tus prioridades configuradas automáticamente.
              </p>
            </div>
          ) : null}

          {/* DETALLE DE CONSULTAS + URL MANUAL */}
          <div className="bg-void/70 border border-cyberBorder rounded-xl p-3 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-[10px] font-mono text-slate-400 uppercase shrink-0">
                Pegar URL manual en {'{{trailer_url}}'}:
              </span>
              <div className="flex-1 flex gap-1.5">
                <input
                  type="text"
                  value={manualUrlDraft}
                  onChange={(e) => setManualUrlDraft(e.target.value)}
                  placeholder="https://youtu.be/..."
                  className="flex-1 min-w-0 bg-panel text-cyberCyan font-mono text-[11px] rounded-lg px-2.5 py-1 border border-cyberBorder"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!manualUrlDraft.trim()) return;
                    onSelectTrailer(manualUrlDraft.trim());
                    onClose();
                  }}
                  className="px-3 py-1 rounded-lg bg-panel hover:bg-elevated border border-cyberCyan/50 text-cyberCyan font-mono text-[10px] font-bold cursor-pointer shrink-0"
                >
                  Aplicar URL
                </button>
              </div>
            </div>
            {queriesInfo.length > 0 && (
              <div className="text-[10px] font-mono text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                {queriesInfo.map((q) => (
                  <span key={q.priorityId}>
                    [{PRIORITY_SHORT_LABELS[q.priorityId]}: &ldquo;{q.query}&rdquo; → {q.count}]
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 bg-elevated border-t border-cyberBorder flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] font-mono text-slate-400 truncate">
            Al elegir un video, se actualizará automáticamente{' '}
            <code className="text-cyberCyan">{'{{trailer_url}}'}</code> en el post activo.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-void border border-cyberBorder text-slate-300 text-xs cursor-pointer shrink-0"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
