import type {
  ApiProviderConfig,
  ApiVerificationResult,
  FanartArtworkItem,
  ImageHostProvider,
  UserConfig,
} from '../types';

export function parseTmdbIdInput(
  raw?: string,
  fallbackType?: string
): { id: string; type?: 'movie' | 'tv' } {
  const s = (raw || '').trim();
  if (!s) {
    return {
      id: '',
      type: fallbackType === 'tv' ? 'tv' : fallbackType === 'movie' ? 'movie' : undefined,
    };
  }
  const urlMatch = s.match(/(?:themoviedb\.org\/)?(movie|tv)\/(\d+)/i);
  if (urlMatch) {
    return {
      type: urlMatch[1].toLowerCase() === 'tv' ? 'tv' : 'movie',
      id: urlMatch[2],
    };
  }
  const digits = s.match(/\d+/);
  return {
    id: digits ? digits[0] : s,
    type: fallbackType === 'tv' ? 'tv' : fallbackType === 'movie' ? 'movie' : undefined,
  };
}

export function parseImdbIdInput(raw?: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const match = s.match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : s;
}

/**
 * Evaluates a subset of JSONPath expressions such as:
 * - $.data.Media.title.romaji
 * - $.results[0].genres[*].name
 * - $.genres[*]
 * - https://image.tmdb.org/t/p/w500{{$.results[0].poster_path}}
 */
export function evaluateJsonPath(data: unknown, expr: string): string {
  if (!expr || !expr.trim() || data == null) return '';

  // Template string containing embedded {{$.path}} expressions (e.g. TMDB poster URL)
  if (expr.includes('{{$.')) {
    let anyResolved = false;
    const out = expr.replace(/\{\{(\$\.[^}]+)\}\}/g, (_, innerPath) => {
      const resolved = evaluateJsonPath(data, innerPath.trim());
      if (resolved) anyResolved = true;
      return resolved;
    });
    return anyResolved ? out : '';
  }

  const cleaned = expr.trim().replace(/^\$\.?/, '');
  if (!cleaned) return '';

  const tokens: Array<string | number | '*'> = [];
  const tokenRegex = /([^.[\]]+)|\[(\*|\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(cleaned)) !== null) {
    if (m[1] !== undefined) {
      tokens.push(m[1]);
    } else if (m[2] !== undefined) {
      tokens.push(m[2] === '*' ? '*' : Number(m[2]));
    }
  }

  let current: unknown[] = [data];
  for (const tok of tokens) {
    const next: unknown[] = [];
    for (const node of current) {
      if (node == null) continue;
      if (tok === '*') {
        if (Array.isArray(node)) {
          next.push(...node);
        } else if (typeof node === 'object') {
          next.push(...Object.values(node as Record<string, unknown>));
        }
      } else if (typeof tok === 'number') {
        if (Array.isArray(node) && tok < node.length) {
          next.push(node[tok]);
        }
      } else {
        if (typeof node === 'object' && !Array.isArray(node)) {
          const val = (node as Record<string, unknown>)[tok];
          if (val !== undefined) next.push(val);
        }
      }
    }
    current = next;
  }

  const flattened: string[] = [];
  for (const item of current) {
    if (item == null) continue;
    if (Array.isArray(item)) {
      for (const sub of item) {
        if (sub != null && typeof sub !== 'object') flattened.push(String(sub));
      }
    } else if (typeof item !== 'object') {
      flattened.push(String(item));
    }
  }

  return flattened.join(', ');
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function replaceQueryVariables(
  template: string,
  params: {
    query: string;
    title: string;
    artist: string;
    year: string;
    tmdbKey: string;
    omdbKey: string;
    fanartKey: string;
    fanartClientKey: string;
  },
  encodeForUrl: boolean
): string {
  const enc = (s: string) =>
    encodeForUrl ? encodeURIComponent(s) : s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return template
    .replace(/\{\{query\}\}/gi, enc(params.query))
    .replace(/\{\{title\}\}/gi, enc(params.title))
    .replace(/\{\{artist\}\}/gi, enc(params.artist))
    .replace(/\{\{year\}\}/gi, enc(params.year))
    .replace(/\{\{tmdbKey\}\}/gi, enc(params.tmdbKey))
    .replace(/\{\{omdbKey\}\}/gi, enc(params.omdbKey))
    .replace(/\{\{fanartKey\}\}/gi, enc(params.fanartKey))
    .replace(/\{\{fanartClientKey\}\}/gi, enc(params.fanartClientKey));
}

async function proxyRequest(params: {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  latencyMs: number;
  data: unknown;
  rawText: string;
  error?: string;
}> {
  const res = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: params.url,
      method: params.method || 'GET',
      headers: params.headers || { Accept: 'application/json' },
      body: params.body,
    }),
  });
  const payload = await res.json();
  return {
    ok: Boolean(res.ok && payload.ok),
    status: payload.status || res.status,
    statusText: payload.statusText,
    latencyMs: payload.latencyMs || 0,
    data: payload.data,
    rawText: payload.rawText || '',
    error: payload.error,
  };
}

function toFanartPreviewUrl(fullUrl: string): string {
  if (fullUrl.includes('/fanart/')) {
    return fullUrl.replace('/fanart/', '/bigpreview/');
  }
  return fullUrl;
}

interface RawFanartImageEntry {
  id?: string | number;
  url?: string;
  lang?: string;
  likes?: string | number;
}

function sortFanartEntries(entries: RawFanartImageEntry[]): RawFanartImageEntry[] {
  const langScore = (lang?: string): number => {
    const l = (lang || '').toLowerCase();
    if (l === 'es') return 4;
    if (l === 'en') return 3;
    if (l === '00' || l === '') return 2;
    return 1;
  };
  return [...entries].sort((a, b) => {
    const lDiff = langScore(b.lang) - langScore(a.lang);
    if (lDiff !== 0) return lDiff;
    return (Number(b.likes) || 0) - (Number(a.likes) || 0);
  });
}

export interface FanartAssetLookupOptions {
  mediaType?: string;
  tmdbId?: string;
  imdbId?: string;
  tvdbId?: string;
  mbidId?: string;
  title?: string;
  artist?: string;
  config: UserConfig;
}

export interface FanartTypedAssetResult {
  ok: boolean;
  kind: 'banner' | 'logo' | 'clearart';
  primaryUrl: string;
  items: FanartArtworkItem[];
  error?: string;
}

function collectFanartGroup(
  obj: Record<string, unknown>,
  keys: string[],
  kind: FanartArtworkItem['kind'],
  limit = 10,
  idOffset = 0
): FanartArtworkItem[] {
  const combined: RawFanartImageEntry[] = [];
  for (const k of keys) {
    const arr = obj[k];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object' && typeof (item as RawFanartImageEntry).url === 'string') {
          combined.push(item as RawFanartImageEntry);
        }
      }
    }
  }

  // Handle music albums nested array (`albums: [{ albumcover, cdart }]`)
  if (Array.isArray(obj.albums)) {
    for (const alb of obj.albums) {
      if (!alb || typeof alb !== 'object') continue;
      const aObj = alb as Record<string, unknown>;
      for (const k of keys) {
        const arr = aObj[k];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && typeof item === 'object' && typeof (item as RawFanartImageEntry).url === 'string') {
              combined.push(item as RawFanartImageEntry);
            }
          }
        }
      }
    }
  }

  const sorted = sortFanartEntries(combined);
  const items: FanartArtworkItem[] = [];
  for (let i = 0; i < Math.min(sorted.length, limit); i++) {
    const item = sorted[i];
    if (!item.url) continue;
    items.push({
      id: `${kind}-${item.id ?? i}-${idOffset + items.length}`,
      kind,
      source: 'fanart',
      url: item.url,
      previewUrl: toFanartPreviewUrl(item.url),
      lang: (item.lang || '00').toUpperCase(),
      likes: Number(item.likes) || 0,
    });
  }
  return items;
}

const FANART_LOGO_KEYS = [
  'hdmovielogo',
  'movielogo',
  'hdtvlogo',
  'clearlogo',
  'hdmusiclogo',
  'musiclogo',
];
const FANART_BANNER_KEYS = ['moviebanner', 'tvbanner', 'musicbanner'];
const FANART_CLEARART_KEYS = ['hdmovieclearart', 'movieart', 'hdclearart', 'clearart'];

export function extractFanartLogos(json: unknown): FanartArtworkItem[] {
  if (!json || typeof json !== 'object') return [];
  return collectFanartGroup(json as Record<string, unknown>, FANART_LOGO_KEYS, 'logo');
}

export function extractFanartBanners(json: unknown): FanartArtworkItem[] {
  if (!json || typeof json !== 'object') return [];
  return collectFanartGroup(json as Record<string, unknown>, FANART_BANNER_KEYS, 'banner');
}

export function extractFanartClearArts(json: unknown): FanartArtworkItem[] {
  if (!json || typeof json !== 'object') return [];
  return collectFanartGroup(json as Record<string, unknown>, FANART_CLEARART_KEYS, 'clearart');
}

export function parseFanartTvResponse(json: unknown): {
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
} {
  const extracted: Record<string, string> = {};
  const gallery: FanartArtworkItem[] = [];
  if (!json || typeof json !== 'object') return { extracted, gallery };

  const obj = json as Record<string, unknown>;

  const pushGroup = (
    keys: string[],
    kind: FanartArtworkItem['kind'],
    targetField: string
  ) => {
    const items = collectFanartGroup(obj, keys, kind, 10, gallery.length);
    if (items.length > 0 && items[0].url && !extracted[targetField]) {
      extracted[targetField] = items[0].url;
    }
    gallery.push(...items);
  };

  // Logo (Movie -> TV -> Music)
  pushGroup(FANART_LOGO_KEYS, 'logo', 'logo_url');
  // Banner (Movie -> TV -> Music)
  pushGroup(FANART_BANNER_KEYS, 'banner', 'banner_url');
  // ClearArt (Movie -> TV)
  pushGroup(FANART_CLEARART_KEYS, 'clearart', 'clearart_url');
  // Poster / Album Cover
  pushGroup(['movieposter', 'tvposter', 'seasonposter', 'albumcover'], 'poster', 'poster_url');
  // Background 4K / HD
  pushGroup(
    [
      'moviebackground',
      'movie4kbackground',
      'showbackground',
      'show4kbackground',
      'artistbackground',
      'artist4kbackground',
    ],
    'background',
    'background_url'
  );
  // Thumb / Disc
  pushGroup(['moviethumb', 'tvthumb', 'artistthumb'], 'thumb', 'thumb_url');
  pushGroup(['moviedisc', 'cdart'], 'disc', 'thumb_url');

  return { extracted, gallery };
}

export async function fetchFanartTvArtwork(
  opts: FanartAssetLookupOptions
): Promise<{
  ok: boolean;
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
  rawJson?: unknown;
  error?: string;
}> {
  const apiKey = opts.config.fanartApiKey.trim();
  const clientKey = opts.config.fanartClientKey.trim();
  if (!apiKey && !clientKey) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: 'Falta Fanart.tv API Key en Configuración.',
    };
  }

  let mediaType = (opts.mediaType || '').toLowerCase();
  let tmdbId = (opts.tmdbId || '').trim();
  let imdbId = (opts.imdbId || '').trim();
  let tvdbId = (opts.tvdbId || '').trim();
  let mbidId = (opts.mbidId || '').trim();

  // Auto-resolve IDs from IMDb / title when needed (Fanart.tv TV requires TVDB or TMDB source=tmdb)
  const cleanTitle = (opts.title || '').trim();
  if (mediaType === 'tv' && !tvdbId && !tmdbId && imdbId) {
    try {
      const imdbLookup = await proxyRequest({
        url: `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
      });
      if (imdbLookup.ok && imdbLookup.data) {
        const foundTvdb = evaluateJsonPath(imdbLookup.data, '$.externals.thetvdb');
        if (foundTvdb) tvdbId = foundTvdb;
      }
    } catch {
      // Ignore TVMaze IMDb lookup error
    }
  }

  if (!tmdbId && !imdbId && !tvdbId && !mbidId && cleanTitle) {
    if (mediaType === 'music' || opts.artist) {
      const mbQuery = [opts.artist, cleanTitle].filter(Boolean).join(' ');
      try {
        const mbRes = await proxyRequest({
          url: `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(opts.artist || mbQuery)}&fmt=json&limit=1`,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'PostProStudio/2.5 (desktop-bbcode-tool)',
          },
        });
        if (mbRes.ok && mbRes.data) {
          const foundMbid = evaluateJsonPath(mbRes.data, '$.artists[0].id');
          if (foundMbid) {
            mbidId = foundMbid;
            mediaType = 'music';
          }
        }
      } catch {
        // Ignore fallback lookup error
      }
    } else if (opts.config.tmdbApiKey.trim()) {
      try {
        const tmdbSearch = await proxyRequest({
          url: `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(
            opts.config.tmdbApiKey.trim()
          )}&language=es-ES&query=${encodeURIComponent(cleanTitle)}`,
        });
        if (tmdbSearch.ok && tmdbSearch.data) {
          const foundId = evaluateJsonPath(tmdbSearch.data, '$.results[0].id');
          const foundType = evaluateJsonPath(tmdbSearch.data, '$.results[0].media_type');
          if (foundId) {
            tmdbId = foundId;
            if (foundType === 'tv' || foundType === 'movie') mediaType = foundType;
          }
        }
      } catch {
        // Ignore TMDB resolve error
      }
    } else if (opts.config.omdbApiKey.trim()) {
      try {
        const omdbRes = await proxyRequest({
          url: `https://www.omdbapi.com/?apikey=${encodeURIComponent(
            opts.config.omdbApiKey.trim()
          )}&t=${encodeURIComponent(cleanTitle)}`,
        });
        if (omdbRes.ok && omdbRes.data) {
          const foundImdb = evaluateJsonPath(omdbRes.data, '$.imdbID');
          const foundType = evaluateJsonPath(omdbRes.data, '$.Type');
          if (foundImdb) imdbId = foundImdb;
          if (foundType === 'series') mediaType = 'tv';
          else if (foundType === 'movie') mediaType = 'movie';
        }
      } catch {
        // Ignore OMDb resolve error
      }
    }

    // Public TVMaze fallback if still no ID (or TV series with only IMDb ID)
    if ((!tmdbId && !imdbId && !tvdbId && !mbidId) || (mediaType === 'tv' && !tvdbId && !tmdbId)) {
      try {
        const tvUrl = imdbId
          ? `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(imdbId)}`
          : `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanTitle)}`;
        const tvRes = await proxyRequest({ url: tvUrl });
        if (tvRes.ok && tvRes.data) {
          const foundTvdb = evaluateJsonPath(tvRes.data, '$.externals.thetvdb');
          const foundImdb = evaluateJsonPath(tvRes.data, '$.externals.imdb');
          if (foundTvdb) tvdbId = foundTvdb;
          if (foundImdb && !imdbId) imdbId = foundImdb;
          if (foundTvdb || foundImdb) mediaType = 'tv';
        }
      } catch {
        // Ignore TVMaze fallback error
      }
    }
  }

  const queryParams = new URLSearchParams();
  if (apiKey) queryParams.set('api_key', apiKey);
  if (clientKey) queryParams.set('client_key', clientKey);

  let endpoint = '';
  if (mediaType === 'music' && mbidId) {
    endpoint = `https://webservice.fanart.tv/v3.2/music/${encodeURIComponent(mbidId)}?${queryParams.toString()}`;
  } else if (mediaType === 'tv') {
    const id = tvdbId || tmdbId || imdbId;
    if (!id) {
      return {
        ok: false,
        extracted: {},
        gallery: [],
        error: 'No se encontró TVDB/TMDB/IMDb ID para consultar Fanart.tv.',
      };
    }
    if (!tvdbId && tmdbId) {
      queryParams.set('source', 'tmdb');
    }
    endpoint = `https://webservice.fanart.tv/v3.2/tv/${encodeURIComponent(id)}?${queryParams.toString()}`;
  } else {
    const id = tmdbId || imdbId || tvdbId;
    if (!id) {
      return {
        ok: false,
        extracted: {},
        gallery: [],
        error: 'No se encontró TMDB/IMDb ID para consultar Fanart.tv.',
      };
    }
    endpoint = `https://webservice.fanart.tv/v3.2/movies/${encodeURIComponent(id)}?${queryParams.toString()}`;
  }

  try {
    const res = await proxyRequest({ url: endpoint });
    if (!res.ok) {
      if (mediaType === 'music' && mbidId && !endpoint.includes('/music/albums/')) {
        const albumRes = await proxyRequest({
          url: `https://webservice.fanart.tv/v3.2/music/albums/${encodeURIComponent(mbidId)}?${queryParams.toString()}`,
        });
        if (albumRes.ok && albumRes.data) {
          return { ok: true, rawJson: albumRes.data, ...parseFanartTvResponse(albumRes.data) };
        }
      }
      // Fallback: if /movies failed and we only had tmdbId or imdbId, try /tv once
      if (!endpoint.includes('/tv/') && mediaType !== 'music' && (tvdbId || tmdbId)) {
        const tvParams = new URLSearchParams(queryParams);
        if (!tvdbId && tmdbId) tvParams.set('source', 'tmdb');
        const tvRes = await proxyRequest({
          url: `https://webservice.fanart.tv/v3.2/tv/${encodeURIComponent(tvdbId || tmdbId)}?${tvParams.toString()}`,
        });
        if (tvRes.ok && tvRes.data) {
          return { ok: true, rawJson: tvRes.data, ...parseFanartTvResponse(tvRes.data) };
        }
      }
      return {
        ok: false,
        extracted: {},
        gallery: [],
        error: res.error || `Fanart.tv HTTP ${res.status}`,
      };
    }
    return { ok: true, rawJson: res.data, ...parseFanartTvResponse(res.data) };
  } catch (err) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: err instanceof Error ? err.message : 'Error consultando Fanart.tv',
    };
  }
}

async function fetchFanartAssetByKind(
  opts: FanartAssetLookupOptions,
  kind: 'banner' | 'logo' | 'clearart',
  extractedKey: 'banner_url' | 'logo_url' | 'clearart_url'
): Promise<FanartTypedAssetResult> {
  const res = await fetchFanartTvArtwork(opts);
  if (!res.ok) {
    return {
      ok: false,
      kind,
      primaryUrl: '',
      items: [],
      error: res.error,
    };
  }
  const items = res.gallery.filter((item) => item.kind === kind);
  const primaryUrl = res.extracted[extractedKey] || items[0]?.url || '';
  return {
    ok: items.length > 0,
    kind,
    primaryUrl,
    items,
    error: items.length === 0 ? `Fanart.tv no devolvió ${kind}s para este título.` : undefined,
  };
}

export function fetchFanartBanners(
  opts: FanartAssetLookupOptions
): Promise<FanartTypedAssetResult> {
  return fetchFanartAssetByKind(opts, 'banner', 'banner_url');
}

export function fetchFanartLogos(
  opts: FanartAssetLookupOptions
): Promise<FanartTypedAssetResult> {
  return fetchFanartAssetByKind(opts, 'logo', 'logo_url');
}

export function fetchFanartClearArts(
  opts: FanartAssetLookupOptions
): Promise<FanartTypedAssetResult> {
  return fetchFanartAssetByKind(opts, 'clearart', 'clearart_url');
}

export async function enrichWithFanartTvIfConfigured(
  baseExtracted: Record<string, string>,
  config: UserConfig,
  hint?: { title?: string; artist?: string; mediaType?: string }
): Promise<{
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
  fanartOk: boolean;
}> {
  if (!config.fanartApiKey.trim() && !config.fanartClientKey.trim()) {
    return { extracted: baseExtracted, gallery: [], fanartOk: false };
  }

  const res = await fetchFanartTvArtwork({
    mediaType: baseExtracted.media_type || hint?.mediaType,
    tmdbId: baseExtracted.tmdb_id,
    imdbId: baseExtracted.imdb_id,
    tvdbId: baseExtracted.tvdb_id,
    mbidId: baseExtracted.mbid_id,
    title: baseExtracted.titulo || hint?.title,
    artist: baseExtracted.artista || hint?.artist,
    config,
  });

  if (!res.ok || res.gallery.length === 0) {
    return { extracted: baseExtracted, gallery: [], fanartOk: false };
  }

  const merged: Record<string, string> = { ...baseExtracted };
  const hasRealUrl = (u?: string) =>
    Boolean(u && u.trim() && u !== 'N/A' && !u.startsWith('data:image/svg+xml'));

  // Priority 3 (Fanart.tv): Banners & ClearArts + Logo SOLO en caso de no encontrarlo con TMDB/OMDb
  if (res.extracted.banner_url) merged.banner_url = res.extracted.banner_url;
  if (res.extracted.clearart_url) merged.clearart_url = res.extracted.clearart_url;
  if (res.extracted.logo_url && !hasRealUrl(merged.logo_url)) {
    merged.logo_url = res.extracted.logo_url;
  }
  if (res.extracted.background_url && !hasRealUrl(merged.background_url)) {
    merged.background_url = res.extracted.background_url;
  }
  if (res.extracted.thumb_url && !hasRealUrl(merged.thumb_url)) {
    merged.thumb_url = res.extracted.thumb_url;
  }
  if (res.extracted.poster_url && !hasRealUrl(merged.poster_url)) {
    merged.poster_url = res.extracted.poster_url;
  }

  return {
    extracted: merged,
    gallery: res.gallery,
    fanartOk: true,
  };
}

interface TmdbImageEntry {
  file_path?: string;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
  width?: number;
  height?: number;
}

const TMDB_GENRE_MAP: Record<number, string> = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia ficción',
  10770: 'Película de TV',
  53: 'Suspense',
  10752: 'Bélica',
  37: 'Western',
  10759: 'Acción y Aventura',
  10762: 'Infantil',
  10765: 'Sci-Fi & Fantasía',
};

function sortTmdbImages(entries: TmdbImageEntry[]): TmdbImageEntry[] {
  const langScore = (lang?: string | null): number => {
    const l = (lang || '').toLowerCase();
    if (l === 'es') return 4;
    if (l === 'en') return 3;
    if (!l || l === 'xx') return 2;
    return 1;
  };
  return [...entries].sort((a, b) => {
    const lDiff = langScore(b.iso_639_1) - langScore(a.iso_639_1);
    if (lDiff !== 0) return lDiff;
    const vDiff = (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0);
    if (vDiff !== 0) return vDiff;
    return (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0);
  });
}

function buildTmdbGalleryFromDetail(detailData: Record<string, unknown>): {
  gallery: FanartArtworkItem[];
  bestPoster: string;
  bestLogo: string;
  bestBackground: string;
} {
  const imagesObj = (detailData.images || {}) as {
    posters?: TmdbImageEntry[];
    logos?: TmdbImageEntry[];
    backdrops?: TmdbImageEntry[];
  };
  const gallery: FanartArtworkItem[] = [];
  const seenUrls = new Set<string>();

  const pushTmdbGroup = (
    entries: TmdbImageEntry[] | undefined,
    kind: 'poster' | 'logo' | 'background',
    fullSize: string,
    previewSize: string,
    limit: number
  ): string => {
    const sorted = sortTmdbImages(Array.isArray(entries) ? entries : []);
    let firstUrl = '';
    for (let i = 0; i < Math.min(sorted.length, limit); i++) {
      const entry = sorted[i];
      if (!entry.file_path) continue;
      const fullUrl = `https://image.tmdb.org/t/p/${fullSize}${entry.file_path}`;
      const previewUrl = `https://image.tmdb.org/t/p/${previewSize}${entry.file_path}`;
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);
      if (!firstUrl) firstUrl = fullUrl;
      gallery.push({
        id: `tmdb-${kind}-${i}-${entry.file_path.replace(/[^a-z0-9]/gi, '').slice(-8)}`,
        kind,
        source: 'tmdb',
        url: fullUrl,
        previewUrl,
        lang: (entry.iso_639_1 || '00').toUpperCase(),
        likes: Math.round((Number(entry.vote_average) || 0) * 10) || Number(entry.vote_count) || 0,
        width: entry.width,
        height: entry.height,
      });
    }
    return firstUrl;
  };

  let bestPoster = pushTmdbGroup(imagesObj.posters, 'poster', 'w780', 'w342', 12);
  let bestLogo = pushTmdbGroup(imagesObj.logos, 'logo', 'original', 'w500', 10);
  let bestBackground = pushTmdbGroup(imagesObj.backdrops, 'background', 'w1280', 'w780', 10);

  const fallbackPosterPath =
    typeof detailData.poster_path === 'string' ? detailData.poster_path : '';
  if (!bestPoster && fallbackPosterPath) {
    bestPoster = `https://image.tmdb.org/t/p/w500${fallbackPosterPath}`;
    if (!seenUrls.has(bestPoster)) {
      seenUrls.add(bestPoster);
      gallery.unshift({
        id: `tmdb-poster-base`,
        kind: 'poster',
        source: 'tmdb',
        url: bestPoster,
        previewUrl: `https://image.tmdb.org/t/p/w342${fallbackPosterPath}`,
        lang: 'TMDB',
        likes: 0,
      });
    }
  }

  const fallbackBackdropPath =
    typeof detailData.backdrop_path === 'string' ? detailData.backdrop_path : '';
  if (!bestBackground && fallbackBackdropPath) {
    bestBackground = `https://image.tmdb.org/t/p/w1280${fallbackBackdropPath}`;
    if (!seenUrls.has(bestBackground)) {
      seenUrls.add(bestBackground);
      gallery.push({
        id: `tmdb-background-base`,
        kind: 'background',
        source: 'tmdb',
        url: bestBackground,
        previewUrl: `https://image.tmdb.org/t/p/w780${fallbackBackdropPath}`,
        lang: 'TMDB',
        likes: 0,
      });
    }
  }

  return { gallery, bestPoster, bestLogo, bestBackground };
}

export async function fetchTmdbArtwork(opts: {
  mediaType?: string;
  tmdbId?: string;
  imdbId?: string;
  title?: string;
  year?: string;
  config: UserConfig;
}): Promise<{
  ok: boolean;
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
  error?: string;
}> {
  const apiKey = opts.config.tmdbApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: 'Falta TMDB API Key en Configuración.',
    };
  }

  const parsedTmdb = parseTmdbIdInput(opts.tmdbId, opts.mediaType);
  let resolvedType: 'movie' | 'tv' =
    parsedTmdb.type || (opts.mediaType === 'tv' ? 'tv' : 'movie');
  let resolvedId = parsedTmdb.id;
  const parsedImdb = parseImdbIdInput(opts.imdbId);

  if (!resolvedId && parsedImdb) {
    try {
      const findRes = await proxyRequest({
        url: `https://api.themoviedb.org/3/find/${encodeURIComponent(
          parsedImdb
        )}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`,
      });
      if (findRes.ok && findRes.data && typeof findRes.data === 'object') {
        const d = findRes.data as {
          movie_results?: Array<{ id?: number }>;
          tv_results?: Array<{ id?: number }>;
        };
        if (Array.isArray(d.movie_results) && d.movie_results[0]?.id) {
          resolvedId = String(d.movie_results[0].id);
          resolvedType = 'movie';
        } else if (Array.isArray(d.tv_results) && d.tv_results[0]?.id) {
          resolvedId = String(d.tv_results[0].id);
          resolvedType = 'tv';
        }
      }
    } catch {
      // Ignore find error
    }
  }

  if (!resolvedId && opts.title?.trim()) {
    try {
      const searchRes = await proxyRequest({
        url: `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(
          apiKey
        )}&language=es-ES&query=${encodeURIComponent(opts.title.trim())}`,
      });
      if (searchRes.ok && searchRes.data && typeof searchRes.data === 'object') {
        const rawResults = (
          searchRes.data as {
            results?: Array<{
              id?: number;
              media_type?: string;
              release_date?: string;
              first_air_date?: string;
            }>;
          }
        ).results;
        const candidates = (rawResults || []).filter(
          (r) => r.id && (r.media_type === 'movie' || r.media_type === 'tv')
        );
        const cleanYear = (opts.year || '').match(/\d{4}/)?.[0] || '';
        const yearMatch = cleanYear
          ? candidates.find((r) => (r.release_date || r.first_air_date || '').startsWith(cleanYear))
          : undefined;
        const picked = yearMatch || candidates[0];
        if (picked?.id) {
          resolvedId = String(picked.id);
          resolvedType = picked.media_type === 'tv' ? 'tv' : 'movie';
        }
      }
    } catch (err) {
      return {
        ok: false,
        extracted: {},
        gallery: [],
        error: err instanceof Error ? err.message : 'Error buscando en TMDB.',
      };
    }
  }

  if (!resolvedId) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: 'No se encontraron coincidencias en TMDB para este título.',
    };
  }

  try {
    let detailRes = await proxyRequest({
      url: `https://api.themoviedb.org/3/${resolvedType}/${encodeURIComponent(
        resolvedId
      )}?api_key=${encodeURIComponent(
        apiKey
      )}&language=es-ES&append_to_response=videos,external_ids,images&include_video_language=es,es-MX,en,null&include_image_language=es,en,null`,
    });

    if (!detailRes.ok && opts.tmdbId) {
      const altType: 'movie' | 'tv' = resolvedType === 'movie' ? 'tv' : 'movie';
      const altRes = await proxyRequest({
        url: `https://api.themoviedb.org/3/${altType}/${encodeURIComponent(
          resolvedId
        )}?api_key=${encodeURIComponent(
          apiKey
        )}&language=es-ES&append_to_response=videos,external_ids,images&include_video_language=es,es-MX,en,null&include_image_language=es,en,null`,
      });
      if (altRes.ok && altRes.data) {
        detailRes = altRes;
        resolvedType = altType;
      }
    }

    if (!detailRes.ok || !detailRes.data || typeof detailRes.data !== 'object') {
      return {
        ok: false,
        extracted: {},
        gallery: [],
        error: detailRes.error || `TMDB HTTP ${detailRes.status}`,
      };
    }

    const detailObj = detailRes.data as Record<string, unknown>;
    const extracted: Record<string, string> = {
      tmdb_id: resolvedId,
      media_type: resolvedType,
    };

    let titleVal =
      evaluateJsonPath(detailObj, '$.title') || evaluateJsonPath(detailObj, '$.name');

    const dateVal =
      evaluateJsonPath(detailObj, '$.release_date') ||
      evaluateJsonPath(detailObj, '$.first_air_date');
    const yearMatch = dateVal.match(/\d{4}/);
    if (yearMatch) extracted.anio = yearMatch[0];

    let overviewVal = evaluateJsonPath(detailObj, '$.overview');
    if (!overviewVal) {
      try {
        const enRes = await proxyRequest({
          url: `https://api.themoviedb.org/3/${resolvedType}/${encodeURIComponent(
            resolvedId
          )}?api_key=${encodeURIComponent(apiKey)}&language=en-US`,
        });
        if (enRes.ok && enRes.data && typeof enRes.data === 'object') {
          overviewVal = evaluateJsonPath(enRes.data, '$.overview');
          if (!titleVal) {
            titleVal =
              evaluateJsonPath(enRes.data, '$.title') || evaluateJsonPath(enRes.data, '$.name');
          }
        }
      } catch {
        // Ignore English fallback error
      }
    }
    if (titleVal) extracted.titulo = titleVal;
    if (overviewVal) extracted.sinopsis = stripHtmlTags(overviewVal);

    const voteVal = Number(evaluateJsonPath(detailObj, '$.vote_average'));
    if (!Number.isNaN(voteVal) && voteVal > 0) {
      extracted.tmdb_rating = voteVal.toFixed(1);
    }

    const genresVal = evaluateJsonPath(detailObj, '$.genres[*].name');
    if (genresVal) extracted.generos = genresVal;

    const imdbId =
      evaluateJsonPath(detailObj, '$.external_ids.imdb_id') ||
      evaluateJsonPath(detailObj, '$.imdb_id');
    const tvdbId = evaluateJsonPath(detailObj, '$.external_ids.tvdb_id');
    if (imdbId) extracted.imdb_id = imdbId;
    if (tvdbId) extracted.tvdb_id = tvdbId;

    const videos = detailObj.videos as
      | { results?: Array<{ site?: string; type?: string; key?: string }> }
      | undefined;
    const ytTrailer =
      videos?.results?.find(
        (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser') && v.key
      ) || videos?.results?.find((v) => v.site === 'YouTube' && v.key);
    if (ytTrailer?.key) {
      extracted.trailer_url = `https://youtu.be/${ytTrailer.key}`;
    }

    const { gallery, bestPoster, bestLogo, bestBackground } = buildTmdbGalleryFromDetail(detailObj);
    if (bestPoster) extracted.poster_url = bestPoster;
    if (bestLogo) extracted.logo_url = bestLogo;
    if (bestBackground) extracted.background_url = bestBackground;

    return {
      ok: true,
      extracted,
      gallery,
    };
  } catch (err) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: err instanceof Error ? err.message : 'Error consultando TMDB.',
    };
  }
}

function cleanOmdbField(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return trimmed && trimmed.toUpperCase() !== 'N/A' ? trimmed : '';
}

export async function fetchOmdbArtwork(opts: {
  imdbId?: string;
  title?: string;
  year?: string;
  config: UserConfig;
}): Promise<{
  ok: boolean;
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
  error?: string;
}> {
  const apiKey = opts.config.omdbApiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: 'Falta OMDb API Key en Configuración.',
    };
  }

  const cleanImdb = parseImdbIdInput(opts.imdbId);
  const cleanTitle = (opts.title || '').trim();
  const cleanYear = (opts.year || '').match(/\d{4}/)?.[0] || '';

  if (!cleanImdb && !cleanTitle) {
    return {
      ok: false,
      extracted: {},
      gallery: [],
      error: 'Se requiere título o IMDb ID para consultar OMDb.',
    };
  }

  const querySingle = async (url: string) => {
    const res = await proxyRequest({ url });
    if (!res.ok || !res.data || typeof res.data !== 'object') return null;
    const obj = res.data as Record<string, unknown>;
    if (obj.Response === 'False') return null;
    return obj;
  };

  let detailObj: Record<string, unknown> | null = null;
  if (cleanImdb) {
    detailObj = await querySingle(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(
        cleanImdb
      )}&plot=full`
    );
  }
  if (!detailObj && cleanTitle) {
    if (cleanYear) {
      detailObj = await querySingle(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&t=${encodeURIComponent(
          cleanTitle
        )}&y=${encodeURIComponent(cleanYear)}&plot=full`
      );
    }
    if (!detailObj) {
      detailObj = await querySingle(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&t=${encodeURIComponent(
          cleanTitle
        )}&plot=full`
      );
    }
  }

  const extracted: Record<string, string> = {};
  const gallery: FanartArtworkItem[] = [];
  const seenUrls = new Set<string>();

  if (detailObj) {
    const titleVal = cleanOmdbField(detailObj.Title);
    const yearRaw = cleanOmdbField(detailObj.Year);
    const yearMatch = yearRaw.match(/\d{4}/);
    const genreVal = cleanOmdbField(detailObj.Genre);
    const plotVal = cleanOmdbField(detailObj.Plot);
    const posterVal = cleanOmdbField(detailObj.Poster);
    const ratingRaw = cleanOmdbField(detailObj.imdbRating);
    const imdbIdVal = cleanOmdbField(detailObj.imdbID);
    const typeVal = cleanOmdbField(detailObj.Type).toLowerCase();

    if (titleVal) extracted.titulo = titleVal;
    if (yearMatch) extracted.anio = yearMatch[0];
    if (genreVal) extracted.generos = genreVal;
    if (plotVal) extracted.sinopsis = stripHtmlTags(plotVal);
    if (imdbIdVal) extracted.imdb_id = imdbIdVal;
    if (typeVal) extracted.media_type = typeVal === 'series' ? 'tv' : 'movie';

    const ratingNum = Number(ratingRaw);
    if (!Number.isNaN(ratingNum) && ratingNum > 0) {
      extracted.imdb_rating = ratingNum.toFixed(1);
    }

    if (posterVal && /^https?:\/\//i.test(posterVal)) {
      extracted.poster_url = posterVal;
      seenUrls.add(posterVal);
      gallery.push({
        id: `omdb-poster-main-${imdbIdVal || '0'}`,
        kind: 'poster',
        source: 'omdb',
        url: posterVal,
        previewUrl: posterVal,
        lang: 'IMDb',
        likes: ratingNum > 0 ? Math.round(ratingNum * 10) : 0,
      });
    }
  }

  // Also search OMDb (`?s=...`) so users can choose among alternative IMDb/OMDb covers in Visual Art Selection
  const searchTerm = cleanTitle || extracted.titulo || '';
  if (searchTerm) {
    try {
      const searchObj = await querySingle(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&s=${encodeURIComponent(
          searchTerm
        )}`
      );
      const searchList = Array.isArray(searchObj?.Search)
        ? (searchObj.Search as Array<Record<string, unknown>>)
        : [];
      for (let i = 0; i < searchList.length; i++) {
        const entry = searchList[i];
        const pUrl = cleanOmdbField(entry.Poster);
        const sImdb = cleanOmdbField(entry.imdbID);
        const sYear = cleanOmdbField(entry.Year).match(/\d{4}/)?.[0] || 'IMDb';
        if (pUrl && /^https?:\/\//i.test(pUrl) && !seenUrls.has(pUrl)) {
          seenUrls.add(pUrl);
          if (!extracted.poster_url) extracted.poster_url = pUrl;
          gallery.push({
            id: `omdb-poster-search-${sImdb || i}`,
            kind: 'poster',
            source: 'omdb',
            url: pUrl,
            previewUrl: pUrl,
            lang: sYear,
            likes: 0,
          });
        }
      }
    } catch {
      // Ignore secondary search failure
    }
  }

  const ok = Object.keys(extracted).length > 0 || gallery.length > 0;
  return {
    ok,
    extracted,
    gallery,
    error: ok ? undefined : 'OMDb / IMDb no devolvió resultados para este título.',
  };
}

export interface PostAutomationResult {
  extracted: Record<string, string>;
  gallery: FanartArtworkItem[];
  providersUsed: string[];
  tmdbOk: boolean;
  omdbOk: boolean;
  fanartOk: boolean;
  note: string;
}

const hasNonPlaceholderImage = (url?: string): boolean =>
  Boolean(url && url.trim() && url.trim().toUpperCase() !== 'N/A' && !url.startsWith('data:image/svg+xml'));

/**
 * Pipeline automático al añadir/soltar un archivo:
 * 1) TMDB (Prioridad 1): metadatos principales + portadas, fondos y logos HD.
 * 2) OMDb / IMDb (Secundario): rating IMDb, IDs, metadatos faltantes + portadas/covers de respaldo.
 * 3) Fanart.tv v3.2 (Tercer lugar): solo para insertar Banners, ClearArts y Logo (únicamente si no fue encontrado por TMDB/OMDb).
 *    Las galerías visuales de los 3 proveedores se combinan en `gallery` para que el usuario pueda alternar artes.
 */
export async function automatePostEnrichment(params: {
  title: string;
  year?: string;
  artist?: string;
  mediaType?: string;
  tmdbId?: string;
  imdbId?: string;
  tvdbId?: string;
  mbidId?: string;
  anilistId?: string;
  tvmazeId?: string;
  forceRefresh?: boolean;
  kind: 'video' | 'audio' | 'image' | 'text' | 'unknown';
  fallbackProvider?: ApiProviderConfig | null;
  config: UserConfig;
  cleanHtmlSynopsis?: boolean;
  onStatus?: (msg: string) => void;
}): Promise<PostAutomationResult> {
  const { config } = params;
  const parsedTmdb = parseTmdbIdInput(params.tmdbId, params.mediaType);
  const cleanImdbId = parseImdbIdInput(params.imdbId);
  const cleanTvdbId = (params.tvdbId || '').trim();
  const cleanMbidId = (params.mbidId || '').trim();
  const cleanAnilistId = (params.anilistId || '').replace(/[^\d]/g, '').trim();
  const cleanTvmazeId = (params.tvmazeId || '').replace(/[^\d]/g, '').trim();

  const merged: Record<string, string> = {};
  if (parsedTmdb.id) merged.tmdb_id = parsedTmdb.id;
  if (cleanImdbId) merged.imdb_id = cleanImdbId;
  if (cleanTvdbId) merged.tvdb_id = cleanTvdbId;
  if (cleanMbidId) merged.mbid_id = cleanMbidId;
  if (parsedTmdb.type) merged.media_type = parsedTmdb.type;
  else if (params.mediaType) merged.media_type = params.mediaType;

  const gallery: FanartArtworkItem[] = [];
  const providersUsed: string[] = [];

  let tmdbOk = false;
  let omdbOk = false;
  let fanartOk = false;

  const isMusicDrop = params.kind === 'audio' || params.mediaType === 'music';

  // Paso 0 (Opcional por ID explícito): AniList / TVMaze cuando el usuario identifica con esos IDs
  if (cleanAnilistId && !isMusicDrop) {
    params.onStatus?.(`Consultando AniList ID #${cleanAnilistId}...`);
    try {
      const aniRes = await proxyRequest({
        url: 'https://graphql.anilist.co',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          query:
            'query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native} description(asHtml:false) coverImage{extraLarge} bannerImage averageScore genres seasonYear trailer{id site}}}',
          variables: { id: Number(cleanAnilistId) },
        }),
      });
      if (aniRes.ok && aniRes.data && typeof aniRes.data === 'object') {
        const mediaObj = (aniRes.data as { data?: { Media?: Record<string, unknown> } }).data?.Media;
        if (mediaObj) {
          providersUsed.push('AniList');
          const t =
            evaluateJsonPath(mediaObj, '$.title.romaji') ||
            evaluateJsonPath(mediaObj, '$.title.english');
          const desc = evaluateJsonPath(mediaObj, '$.description');
          const cover = evaluateJsonPath(mediaObj, '$.coverImage.extraLarge');
          const banner = evaluateJsonPath(mediaObj, '$.bannerImage');
          const genres = evaluateJsonPath(mediaObj, '$.genres[*]');
          const yearVal = evaluateJsonPath(mediaObj, '$.seasonYear');
          const score = Number(evaluateJsonPath(mediaObj, '$.averageScore'));
          const tSite = evaluateJsonPath(mediaObj, '$.trailer.site');
          const tId = evaluateJsonPath(mediaObj, '$.trailer.id');
          if (t) merged.titulo = t;
          if (desc) merged.sinopsis = stripHtmlTags(desc);
          if (genres) merged.generos = genres;
          if (yearVal) merged.anio = yearVal;
          if (!Number.isNaN(score) && score > 0) merged.tmdb_rating = (score / 10).toFixed(1);
          if (cover) merged.poster_url = cover;
          if (banner) merged.banner_url = banner;
          if (tSite.toLowerCase() === 'youtube' && tId) merged.trailer_url = `https://youtu.be/${tId}`;
          merged.media_type = 'tv';
        }
      }
    } catch {
      // Ignore AniList ID lookup error
    }
  }

  if (cleanTvmazeId && !isMusicDrop) {
    params.onStatus?.(`Consultando TVMaze ID #${cleanTvmazeId}...`);
    try {
      const tvRes = await proxyRequest({
        url: `https://api.tvmaze.com/shows/${encodeURIComponent(cleanTvmazeId)}`,
      });
      if (tvRes.ok && tvRes.data && typeof tvRes.data === 'object') {
        providersUsed.push('TVMaze');
        const t = evaluateJsonPath(tvRes.data, '$.name');
        const desc = evaluateJsonPath(tvRes.data, '$.summary');
        const cover = evaluateJsonPath(tvRes.data, '$.image.original');
        const genres = evaluateJsonPath(tvRes.data, '$.genres[*]');
        const premiered = evaluateJsonPath(tvRes.data, '$.premiered');
        const rating = evaluateJsonPath(tvRes.data, '$.rating.average');
        const imdb = evaluateJsonPath(tvRes.data, '$.externals.imdb');
        const tvdb = evaluateJsonPath(tvRes.data, '$.externals.thetvdb');
        if (t && !merged.titulo) merged.titulo = t;
        if (desc && !merged.sinopsis) merged.sinopsis = stripHtmlTags(desc);
        if (genres && !merged.generos) merged.generos = genres;
        if (premiered && !merged.anio) merged.anio = premiered.slice(0, 4);
        if (rating && !merged.tmdb_rating) merged.tmdb_rating = rating;
        if (cover && !merged.poster_url) merged.poster_url = cover;
        if (imdb && !merged.imdb_id) merged.imdb_id = imdb;
        if (tvdb && !merged.tvdb_id) merged.tvdb_id = tvdb;
        merged.media_type = 'tv';
      }
    } catch {
      // Ignore TVMaze ID lookup error
    }
  }

  // Paso 1: TMDB (Prioridad 1 para cine/series/anime; también acepta TMDB ID o IMDb ID explícitos)
  if (
    !isMusicDrop &&
    config.tmdbApiKey.trim() &&
    (merged.tmdb_id || merged.imdb_id || params.title.trim())
  ) {
    params.onStatus?.('1/3 · Consultando TMDB (metadatos, portadas y logos)...');
    const tmdbRes = await fetchTmdbArtwork({
      mediaType: merged.media_type || params.mediaType,
      tmdbId: merged.tmdb_id,
      imdbId: merged.imdb_id,
      title: merged.titulo || params.title,
      year: merged.anio || params.year,
      config,
    });
    if (tmdbRes.ok) {
      tmdbOk = true;
      providersUsed.push('TMDB');
      for (const [k, v] of Object.entries(tmdbRes.extracted)) {
        if (v) merged[k] = v;
      }
      gallery.push(...tmdbRes.gallery);
    }
  }

  // Paso 2: OMDb / IMDb (Secundario — rating IMDb, metadatos faltantes y portadas de respaldo)
  if (!isMusicDrop && config.omdbApiKey.trim() && (merged.imdb_id || params.title.trim())) {
    params.onStatus?.('2/3 · Consultando OMDb / IMDb (datos IMDb y portadas)...');
    const omdbRes = await fetchOmdbArtwork({
      imdbId: merged.imdb_id,
      title: merged.titulo || params.title,
      year: merged.anio || params.year,
      config,
    });
    if (omdbRes.ok) {
      omdbOk = true;
      providersUsed.push('OMDb/IMDb');
      if (omdbRes.extracted.imdb_rating) {
        merged.imdb_rating = omdbRes.extracted.imdb_rating;
        if (!merged.tmdb_rating) merged.tmdb_rating = omdbRes.extracted.imdb_rating;
      }
      if (omdbRes.extracted.imdb_id && !merged.imdb_id) {
        merged.imdb_id = omdbRes.extracted.imdb_id;
      }
      for (const field of ['titulo', 'anio', 'sinopsis', 'generos', 'media_type'] as const) {
        if (!merged[field] && omdbRes.extracted[field]) {
          merged[field] = omdbRes.extracted[field];
        }
      }
      if (!hasNonPlaceholderImage(merged.poster_url) && hasNonPlaceholderImage(omdbRes.extracted.poster_url)) {
        merged.poster_url = omdbRes.extracted.poster_url;
      }
      gallery.push(...omdbRes.gallery);
    }
  }

  // Respaldo para música o cuando TMDB/OMDb no están configurados / no encontraron nada
  const searchTitle = merged.titulo || params.title;
  if (
    !tmdbOk &&
    !omdbOk &&
    params.fallbackProvider &&
    params.fallbackProvider.id !== 'prov-tmdb' &&
    params.fallbackProvider.id !== 'prov-omdb' &&
    params.fallbackProvider.id !== 'prov-fanart' &&
    searchTitle.trim()
  ) {
    params.onStatus?.(`Consultando ${params.fallbackProvider.name}...`);
    const fbRes = await executeApiProvider(
      params.fallbackProvider,
      {
        query: searchTitle,
        title: searchTitle,
        artist: params.artist,
        year: merged.anio || params.year,
      },
      config,
      params.cleanHtmlSynopsis ?? true
    );
    if (fbRes.ok && Object.keys(fbRes.extracted).length > 0) {
      providersUsed.push(params.fallbackProvider.name);
      for (const [k, v] of Object.entries(fbRes.extracted)) {
        if (v && !merged[k]) merged[k] = v;
      }
      if (fbRes.gallery && fbRes.gallery.length > 0) {
        gallery.push(...fbRes.gallery);
      }
    }
  }

  // Paso 3: Fanart.tv (Tercer lugar — solo insertar Banners, ClearArts y Logo si no lo encontró TMDB/OMDb)
  if (
    (config.fanartApiKey.trim() || config.fanartClientKey.trim()) &&
    (merged.tmdb_id || merged.imdb_id || merged.tvdb_id || merged.mbid_id || searchTitle.trim())
  ) {
    params.onStatus?.('3/3 · Consultando Fanart.tv (Banners, ClearArt y Logo de respaldo)...');
    const fanRes = await fetchFanartTvArtwork({
      mediaType: merged.media_type || (isMusicDrop ? 'music' : params.mediaType),
      tmdbId: merged.tmdb_id,
      imdbId: merged.imdb_id,
      tvdbId: merged.tvdb_id,
      mbidId: merged.mbid_id,
      title: searchTitle,
      artist: params.artist || merged.artista,
      config,
    });
    if (fanRes.ok && fanRes.gallery.length > 0) {
      fanartOk = true;
      providersUsed.push('Fanart.tv');
      if (fanRes.extracted.banner_url) {
        merged.banner_url = fanRes.extracted.banner_url;
      }
      if (fanRes.extracted.clearart_url) {
        merged.clearart_url = fanRes.extracted.clearart_url;
      }
      // Logo de Fanart.tv SOLO en caso de no haber encontrado logo en TMDB / OMDb
      if (fanRes.extracted.logo_url && !hasNonPlaceholderImage(merged.logo_url)) {
        merged.logo_url = fanRes.extracted.logo_url;
      }
      gallery.push(...fanRes.gallery);
    }
  }

  const note =
    providersUsed.length > 0
      ? `Sincronizado con ${providersUsed.join(' → ')} (${gallery.length} artes en galería)`
      : 'Solo metadatos incrustados y capturas (sin coincidencias en APIs)';

  return {
    extracted: merged,
    gallery,
    providersUsed,
    tmdbOk,
    omdbOk,
    fanartOk,
    note,
  };
}

export async function executeApiProvider(
  provider: ApiProviderConfig,
  params: { query: string; title?: string; artist?: string; year?: string },
  config: UserConfig,
  cleanHtmlSynopsis = true
): Promise<ApiVerificationResult> {
  if (provider.requiresKey === 'tmdb' && !config.tmdbApiKey.trim()) {
    return {
      ok: false,
      status: 400,
      latencyMs: 0,
      rawJson: null,
      rawText: '',
      extracted: {},
      error: 'Falta tu TMDB API Key en Configuración (⚙ -> Rutas & API Keys).',
    };
  }
  if (provider.requiresKey === 'omdb' && !config.omdbApiKey.trim()) {
    return {
      ok: false,
      status: 400,
      latencyMs: 0,
      rawJson: null,
      rawText: '',
      extracted: {},
      error: 'Falta tu OMDb API Key en Configuración (⚙ -> Rutas & API Keys).',
    };
  }
  if (
    provider.requiresKey === 'fanart' &&
    !config.fanartApiKey.trim() &&
    !config.fanartClientKey.trim()
  ) {
    return {
      ok: false,
      status: 400,
      latencyMs: 0,
      rawJson: null,
      rawText: '',
      extracted: {},
      error: 'Falta tu Fanart.tv API Key en Configuración (⚙ -> Rutas & API Keys).',
    };
  }

  const trimmedQuery = params.query.trim() || 'Dune';

  // Special smart handler when the user runs Fanart.tv directly with a title or ID
  if (provider.id === 'prov-fanart' || provider.requiresKey === 'fanart') {
    const started = performance.now();
    const isDirectId =
      /^\d+$/.test(trimmedQuery) ||
      /^tt\d+$/i.test(trimmedQuery) ||
      /^[0-9a-f-]{36}$/i.test(trimmedQuery);
    const fanRes = await fetchFanartTvArtwork({
      tmdbId: /^\d+$/.test(trimmedQuery) ? trimmedQuery : undefined,
      imdbId: /^tt\d+$/i.test(trimmedQuery) ? trimmedQuery : undefined,
      mbidId: /^[0-9a-f-]{36}$/i.test(trimmedQuery) ? trimmedQuery : undefined,
      title: isDirectId ? undefined : trimmedQuery,
      artist: params.artist,
      config,
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!fanRes.ok) {
      return {
        ok: false,
        status: 404,
        latencyMs,
        rawJson: null,
        rawText: '',
        extracted: {},
        error: fanRes.error || 'No se encontraron artworks en Fanart.tv.',
      };
    }
    return {
      ok: true,
      status: 200,
      latencyMs,
      rawJson: fanRes.rawJson ?? { count: fanRes.gallery.length, assets: fanRes.extracted },
      rawText: '',
      extracted: fanRes.extracted,
    };
  }

  const vars = {
    query: trimmedQuery,
    title: (params.title || params.query || '').trim(),
    artist: (params.artist || '').trim(),
    year: (params.year || '').trim(),
    tmdbKey: config.tmdbApiKey.trim(),
    omdbKey: config.omdbApiKey.trim(),
    fanartKey: config.fanartApiKey.trim(),
    fanartClientKey: config.fanartClientKey.trim(),
  };

  const finalUrl = replaceQueryVariables(provider.url, vars, true);
  const finalBody =
    provider.method === 'POST' && provider.body
      ? replaceQueryVariables(provider.body, vars, false)
      : undefined;

  try {
    const payload = await proxyRequest({
      url: finalUrl,
      method: provider.method,
      headers: provider.headers,
      body: finalBody,
    });

    if (!payload.ok) {
      const rawObj = payload.data as Record<string, unknown> | null;
      const apiErr =
        (rawObj?.status_message as string) ||
        (rawObj?.Error as string) ||
        ((rawObj?.errors as Array<Record<string, unknown>> | undefined)?.[0]?.message as string) ||
        payload.error ||
        `HTTP ${payload.status} ${payload.statusText || ''}`.trim();

      return {
        ok: false,
        status: payload.status,
        statusText: payload.statusText,
        latencyMs: payload.latencyMs,
        rawJson: payload.data,
        rawText: payload.rawText,
        extracted: {},
        error: apiErr,
      };
    }

    const jsonData = payload.data;
    const extracted: Record<string, string> = {};
    let gallery: FanartArtworkItem[] = [];

    const mappingEntries: Array<[string, string | undefined]> = [
      ['titulo', provider.mappings.titulo],
      ['poster_url', provider.mappings.poster_url],
      ['banner_url', provider.mappings.banner_url],
      ['logo_url', provider.mappings.logo_url],
      ['clearart_url', provider.mappings.clearart_url],
      ['background_url', provider.mappings.background_url],
      ['trailer_url', provider.mappings.trailer_url],
      ['sinopsis', provider.mappings.sinopsis],
      [provider.id === 'prov-omdb' ? 'imdb_rating' : 'tmdb_rating', provider.mappings.rating],
      ['generos', provider.mappings.generos],
      ['anio', provider.mappings.anio],
    ];

    for (const [targetVar, jp] of mappingEntries) {
      if (!jp) continue;
      let val = evaluateJsonPath(jsonData, jp);
      if (!val && targetVar === 'titulo' && jp === '$.results[0].title') {
        val = evaluateJsonPath(jsonData, '$.results[0].name');
      }
      if (!val && targetVar === 'anio' && jp === '$.results[0].release_date') {
        val = evaluateJsonPath(jsonData, '$.results[0].first_air_date');
      }
      if (!val || val.trim().toUpperCase() === 'N/A') continue;

      if (targetVar === 'sinopsis' && cleanHtmlSynopsis) {
        val = stripHtmlTags(val);
      }
      if (targetVar === 'anio') {
        const yearMatch = val.match(/\d{4}/);
        if (yearMatch) val = yearMatch[0];
      }
      if (targetVar === 'tmdb_rating' || targetVar === 'imdb_rating') {
        const num = Number(val);
        if (!Number.isNaN(num)) {
          val = num > 10 && num <= 100 ? (num / 10).toFixed(1) : num.toFixed(1);
        }
      }
      if (targetVar === 'poster_url' && val.includes('100x100bb')) {
        val = val.replace('100x100bb', '600x600bb');
      }
      extracted[targetVar] = val;
    }

    // Provider-specific external ID, image gallery & trailer enrichment
    if (provider.id === 'prov-tmdb' && jsonData && typeof jsonData === 'object') {
      const tmdbId = evaluateJsonPath(jsonData, '$.results[0].id');
      const mediaType = evaluateJsonPath(jsonData, '$.results[0].media_type') || 'movie';
      const firstResult = (jsonData as { results?: Array<{ genre_ids?: number[] }> })?.results?.[0];
      if (!extracted.generos && Array.isArray(firstResult?.genre_ids) && firstResult.genre_ids.length > 0) {
        const mappedGenres = firstResult.genre_ids
          .map((gid) => TMDB_GENRE_MAP[gid])
          .filter(Boolean)
          .slice(0, 4);
        if (mappedGenres.length > 0) {
          extracted.generos = mappedGenres.join(', ');
        }
      }
      if (tmdbId) {
        extracted.tmdb_id = tmdbId;
        extracted.media_type = mediaType === 'tv' ? 'tv' : 'movie';
        if ((mediaType === 'movie' || mediaType === 'tv') && config.tmdbApiKey.trim()) {
          try {
            const detailRes = await proxyRequest({
              url: `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${encodeURIComponent(
                config.tmdbApiKey.trim()
              )}&language=es-ES&append_to_response=videos,external_ids,images&include_video_language=es,es-MX,en,null&include_image_language=es,en,null`,
            });
            if (detailRes.ok && detailRes.data && typeof detailRes.data === 'object') {
              const imdbId =
                evaluateJsonPath(detailRes.data, '$.external_ids.imdb_id') ||
                evaluateJsonPath(detailRes.data, '$.imdb_id');
              const tvdbId = evaluateJsonPath(detailRes.data, '$.external_ids.tvdb_id');
              const genres = evaluateJsonPath(detailRes.data, '$.genres[*].name');
              const detailTitle =
                evaluateJsonPath(detailRes.data, '$.title') ||
                evaluateJsonPath(detailRes.data, '$.name');
              let detailOverview = evaluateJsonPath(detailRes.data, '$.overview');
              if (!detailOverview && !extracted.sinopsis) {
                try {
                  const enDetailRes = await proxyRequest({
                    url: `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${encodeURIComponent(
                      config.tmdbApiKey.trim()
                    )}&language=en-US`,
                  });
                  if (enDetailRes.ok && enDetailRes.data) {
                    detailOverview = evaluateJsonPath(enDetailRes.data, '$.overview');
                  }
                } catch {
                  // Ignore English fallback error
                }
              }
              const detailVote = Number(evaluateJsonPath(detailRes.data, '$.vote_average'));
              if (detailTitle) extracted.titulo = detailTitle;
              if (detailOverview) extracted.sinopsis = stripHtmlTags(detailOverview);
              if (!Number.isNaN(detailVote) && detailVote > 0) {
                extracted.tmdb_rating = detailVote.toFixed(1);
              }
              if (imdbId) extracted.imdb_id = imdbId;
              if (tvdbId) extracted.tvdb_id = tvdbId;
              if (genres) extracted.generos = genres;
              const videos = (detailRes.data as Record<string, unknown>)?.videos as
                | { results?: Array<{ site?: string; type?: string; key?: string }> }
                | undefined;
              const ytTrailer =
                videos?.results?.find(
                  (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser') && v.key
                ) || videos?.results?.find((v) => v.site === 'YouTube' && v.key);
              if (ytTrailer?.key) {
                extracted.trailer_url = `https://youtu.be/${ytTrailer.key}`;
              }

              const tmdbArt = buildTmdbGalleryFromDetail(detailRes.data as Record<string, unknown>);
              if (tmdbArt.gallery.length > 0) gallery = tmdbArt.gallery;
              if (tmdbArt.bestPoster) extracted.poster_url = tmdbArt.bestPoster;
              if (tmdbArt.bestLogo) extracted.logo_url = tmdbArt.bestLogo;
              if (tmdbArt.bestBackground) extracted.background_url = tmdbArt.bestBackground;
            }
          } catch {
            // Keep base search extraction if detail call fails
          }
        }
      }
    } else if (provider.id === 'prov-omdb' && jsonData && typeof jsonData === 'object') {
      const imdbId = cleanOmdbField(evaluateJsonPath(jsonData, '$.imdbID'));
      const omdbType = cleanOmdbField(evaluateJsonPath(jsonData, '$.Type'));
      if (imdbId) extracted.imdb_id = imdbId;
      extracted.media_type = omdbType === 'series' ? 'tv' : 'movie';
      if (extracted.poster_url && /^https?:\/\//i.test(extracted.poster_url)) {
        gallery = [
          {
            id: `omdb-poster-${imdbId || 'main'}`,
            kind: 'poster',
            source: 'omdb',
            url: extracted.poster_url,
            previewUrl: extracted.poster_url,
            lang: extracted.anio || 'IMDb',
            likes: Number(extracted.imdb_rating) > 0 ? Math.round(Number(extracted.imdb_rating) * 10) : 0,
          },
        ];
      }
    } else if (provider.id === 'prov-tvmaze' && jsonData && typeof jsonData === 'object') {
      const imdbId = evaluateJsonPath(jsonData, '$.externals.imdb');
      const tvdbId = evaluateJsonPath(jsonData, '$.externals.thetvdb');
      if (imdbId) extracted.imdb_id = imdbId;
      if (tvdbId) extracted.tvdb_id = tvdbId;
      extracted.media_type = 'tv';
    } else if (provider.id === 'prov-anilist' && jsonData && typeof jsonData === 'object') {
      const tSite = evaluateJsonPath(jsonData, '$.data.Media.trailer.site');
      const tId = evaluateJsonPath(jsonData, '$.data.Media.trailer.id');
      if (tSite.toLowerCase() === 'youtube' && tId) {
        extracted.trailer_url = `https://youtu.be/${tId}`;
      }
      extracted.media_type = 'tv';
    } else if (provider.id === 'prov-itunes' && jsonData && typeof jsonData === 'object') {
      const artistName = evaluateJsonPath(jsonData, '$.results[0].artistName');
      const albumName = evaluateJsonPath(jsonData, '$.results[0].collectionName');
      if (artistName) extracted.artista = artistName;
      if (albumName) extracted.album = albumName;
      extracted.media_type = 'music';
    } else if (provider.id === 'prov-musicbrainz' && jsonData && typeof jsonData === 'object') {
      const releaseMbid = evaluateJsonPath(jsonData, '$.releases[0].id');
      const artistMbid = evaluateJsonPath(jsonData, '$.releases[0].artist-credit[0].artist.id');
      const artistName = evaluateJsonPath(jsonData, '$.releases[0].artist-credit[0].name');
      if (artistName) extracted.artista = artistName;
      if (extracted.titulo) extracted.album = extracted.titulo;
      if (artistMbid) extracted.mbid_id = artistMbid;
      extracted.media_type = 'music';
      if (!extracted.poster_url && releaseMbid) {
        extracted.poster_url = `https://coverartarchive.org/release/${releaseMbid}/front-500`;
      }
    }

    return {
      ok: true,
      status: payload.status,
      statusText: payload.statusText,
      latencyMs: payload.latencyMs,
      rawJson: jsonData,
      rawText: payload.rawText,
      extracted,
      gallery,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      rawJson: null,
      rawText: '',
      extracted: {},
      error: err instanceof Error ? err.message : 'No se pudo conectar con el proxy de APIs.',
    };
  }
}

export interface ApiPingResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  detail: string;
}

export async function pingApiProvider(
  provider: ApiProviderConfig,
  config: UserConfig
): Promise<ApiPingResult> {
  if (provider.requiresKey === 'tmdb' && !config.tmdbApiKey.trim()) {
    return { ok: false, status: 400, latencyMs: 0, detail: 'Falta TMDB API Key' };
  }
  if (provider.requiresKey === 'omdb' && !config.omdbApiKey.trim()) {
    return { ok: false, status: 400, latencyMs: 0, detail: 'Falta OMDb API Key' };
  }
  if (
    provider.requiresKey === 'fanart' &&
    !config.fanartApiKey.trim() &&
    !config.fanartClientKey.trim()
  ) {
    return { ok: false, status: 400, latencyMs: 0, detail: 'Falta Fanart.tv API Key' };
  }

  // Lightweight endpoint override for TMDB & Fanart.tv health checks
  if (provider.requiresKey === 'fanart' || provider.id === 'prov-fanart') {
    const qp = new URLSearchParams();
    if (config.fanartApiKey.trim()) qp.set('api_key', config.fanartApiKey.trim());
    if (config.fanartClientKey.trim()) qp.set('client_key', config.fanartClientKey.trim());
    try {
      const res = await proxyRequest({
        url: `https://webservice.fanart.tv/v3.2/movies/550?${qp.toString()}`,
      });
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          latencyMs: res.latencyMs,
          detail: `HTTP ${res.status} · ${res.latencyMs} ms`,
        };
      }
      return {
        ok: false,
        status: res.status,
        latencyMs: res.latencyMs,
        detail: res.error || `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        detail: err instanceof Error ? err.message : 'Sin respuesta',
      };
    }
  }

  const targetProvider: ApiProviderConfig =
    provider.id === 'prov-tmdb'
      ? {
          ...provider,
          url: 'https://api.themoviedb.org/3/configuration?api_key={{tmdbKey}}',
        }
      : provider;

  const catLower = provider.category.toLowerCase();
  const sampleQuery =
    catLower === 'anime'
      ? 'Frieren'
      : catLower.includes('mús') || catLower.includes('mus')
      ? 'Daft Punk'
      : 'Dune';

  const res = await executeApiProvider(targetProvider, { query: sampleQuery }, config, false);

  if (
    res.rawJson &&
    typeof res.rawJson === 'object' &&
    (res.rawJson as Record<string, unknown>).Response === 'False'
  ) {
    const omdbErr = String((res.rawJson as Record<string, unknown>).Error || 'API Key inválida');
    return {
      ok: false,
      status: res.status || 401,
      latencyMs: res.latencyMs,
      detail: omdbErr,
    };
  }

  if (
    res.rawJson &&
    typeof res.rawJson === 'object' &&
    Array.isArray((res.rawJson as Record<string, unknown>).errors) &&
    ((res.rawJson as Record<string, unknown>).errors as unknown[]).length > 0
  ) {
    const firstErr = ((res.rawJson as Record<string, unknown>).errors as Array<Record<string, unknown>>)[0];
    return {
      ok: false,
      status: res.status || 400,
      latencyMs: res.latencyMs,
      detail: String(firstErr?.message || 'Error GraphQL'),
    };
  }

  if (res.ok) {
    return {
      ok: true,
      status: res.status,
      latencyMs: res.latencyMs,
      detail: `HTTP ${res.status} · ${res.latencyMs} ms`,
    };
  }

  return {
    ok: false,
    status: res.status,
    latencyMs: res.latencyMs,
    detail: res.error || (res.status ? `HTTP ${res.status}` : 'Sin respuesta'),
  };
}

export async function verifyImageHost(params: {
  provider: ImageHostProvider;
  apiKey: string;
  endpoint?: string;
}): Promise<{ ok: boolean; status?: number; latencyMs?: number; details?: string; error?: string }> {
  try {
    const res = await fetch('/api/image-host/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red al verificar el host de imágenes.',
    };
  }
}

export async function uploadImageToHost(params: {
  provider: ImageHostProvider;
  apiKey: string;
  endpoint?: string;
  expiration?: string;
  imageBase64: string;
  filename: string;
}): Promise<{ ok: boolean; url?: string; thumbUrl?: string; latencyMs?: number; error?: string }> {
  try {
    const res = await fetch('/api/image-host/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error de red al subir la imagen.',
    };
  }
}

export function isApiProviderConnected(provider: ApiProviderConfig, config: UserConfig): boolean {
  if (provider.requiresKey === 'tmdb') {
    return Boolean(config.tmdbApiKey.trim());
  }
  if (provider.requiresKey === 'omdb') {
    return Boolean(config.omdbApiKey.trim());
  }
  if (provider.requiresKey === 'fanart') {
    return Boolean(config.fanartApiKey.trim() || config.fanartClientKey.trim());
  }
  return Array.isArray(config.connectedApiIds) && config.connectedApiIds.includes(provider.id);
}

export function getConnectedMetadataProviders(
  providers: ApiProviderConfig[],
  config: UserConfig
): ApiProviderConfig[] {
  return providers.filter((p) => isApiProviderConnected(p, config));
}

export function pickBestConnectedProvider(
  providers: ApiProviderConfig[],
  config: UserConfig,
  kind: 'video' | 'audio' | 'image' | 'text' | 'unknown',
  suggestedTemplateId?: string,
  activeApiProviderId?: string
): ApiProviderConfig | null {
  // Exclude prov-fanart from being chosen as the primary text provider — Fanart.tv chains automatically after TMDB/OMDb/TVMaze/MusicBrainz
  const connected = getConnectedMetadataProviders(providers, config).filter(
    (p) => p.id !== 'prov-fanart'
  );
  if (connected.length === 0) return null;

  const active = connected.find((p) => p.id === activeApiProviderId);

  if (
    kind === 'audio' ||
    suggestedTemplateId === 'tpl-zinfinal-music' ||
    suggestedTemplateId === 'tpl-identi-music'
  ) {
    const music = connected.find(
      (p) => p.category.toLowerCase().includes('mús') || p.category.toLowerCase().includes('mus')
    );
    if (music) return music;
  }

  if (suggestedTemplateId === 'tpl-identi-main') {
    const seriesOrAnime = connected.find(
      (p) =>
        p.id === 'prov-tmdb' ||
        p.id === 'prov-tvmaze' ||
        p.category.toLowerCase() === 'anime'
    );
    if (seriesOrAnime) return seriesOrAnime;
  }

  if (kind === 'video') {
    if (
      active &&
      (active.category === 'Video' || active.category === 'Anime' || active.category === 'Todos')
    ) {
      return active;
    }
    const video = connected.find((p) => p.category === 'Video' || p.category === 'Anime');
    if (video) return video;
  }

  return active || connected[0];
}
