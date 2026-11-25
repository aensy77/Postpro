import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

declare const __BUNDLED_SERVER__: boolean | undefined;

function resolveDistDir(): string {
  const runtimeDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const candidates = [
    path.resolve(runtimeDir, 'dist'),
    path.resolve(runtimeDir, '..', 'dist'),
    path.join(path.dirname(process.execPath), 'dist'),
    path.resolve(process.cwd(), 'dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return path.resolve(runtimeDir, 'dist');
}

const PORT = Number(process.env.PORT) || 3000;

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Genera un PNG válido de 16x16 px para evitar bloqueos WAF contra píxeles 1x1
function createVerifyPngBuffer(): Buffer {
  const width = 16;
  const height = 16;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height, 0x24);
  for (let y = 0; y < height; y++) raw[y * rowSize] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const VERIFY_PNG_BUFFER = createVerifyPngBuffer();
const VERIFY_PNG_BASE64 = VERIFY_PNG_BUFFER.toString('base64');

function formatHostError(rawMsg: string | undefined, fallbackStatus: number, providerLabel: string): string {
  const msg = rawMsg || `${providerLabel} respondió HTTP ${fallbackStatus}`;
  if (msg.toLowerCase().includes('forbidden to use this website')) {
    return `${msg} — El firewall de ${providerLabel} tiene bloqueada tu IP pública/CGNAT o VPN actual. Prueba desactivar VPN, reiniciar tu módem o usar Imgur / Postimages.`;
  }
  return msg;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function parseIpv4MappedHexPair(hiHex: string, loHex: string): string | null {
  const hi = Number.parseInt(hiHex, 16);
  const lo = Number.parseInt(loHex, 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (net.isIPv4(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return true;
    const mappedDotted = /^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
    if (mappedDotted && net.isIPv4(mappedDotted[1])) {
      return isPrivateOrReservedIpv4(mappedDotted[1]);
    }
    const mappedHex = /^(?:::ffff:|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
    if (mappedHex) {
      const v4 = parseIpv4MappedHexPair(mappedHex[1], mappedHex[2]);
      if (v4 && net.isIPv4(v4)) return isPrivateOrReservedIpv4(v4);
    }
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (/^fe[89ab][0-9a-f]?:/i.test(normalized)) return true;
    if (normalized.startsWith('ff')) return true;
    return false;
  }
  return true;
}

async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Solo se permiten URLs con protocolo http:// o https://.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHost = hostname.replace(/^\[|\]$/g, '').split('%')[0];
  if (
    cleanHost === 'localhost' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.internal')
  ) {
    throw new Error('Acceso bloqueado a direcciones locales o internas.');
  }

  if (net.isIP(cleanHost)) {
    if (isPrivateOrReservedIp(cleanHost)) {
      throw new Error('Acceso bloqueado a direcciones IP privadas o reservadas.');
    }
    return parsed;
  }

  const resolved = await dns.lookup(hostname, { all: true });
  if (!resolved || resolved.length === 0) {
    throw new Error(`No se pudo resolver el host ${hostname}.`);
  }
  for (const entry of resolved) {
    if (isPrivateOrReservedIp(entry.address)) {
      throw new Error('El host resuelve a una IP privada o reservada.');
    }
  }

  return parsed;
}

async function safeExternalFetch(rawUrl: string, init: RequestInit, maxRedirects = 3): Promise<Response> {
  let currentUrl = (await assertSafeExternalUrl(rawUrl)).toString();
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(currentUrl, currentInit);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      if (hop === maxRedirects) {
        throw new Error('Demasiadas redirecciones externas.');
      }
      const nextParsed = new URL(location, currentUrl);
      await assertSafeExternalUrl(nextParsed.toString());
      currentUrl = nextParsed.toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentInit.method === 'POST')) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      continue;
    }
    return res;
  }

  throw new Error('Error al resolver la petición externa.');
}

function sanitizeOutgoingHeaders(input: unknown): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return safe;
  }
  const forbidden = new Set(['host', 'content-length', 'connection', 'cookie']);
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const keyLower = k.trim().toLowerCase();
    if (!keyLower || forbidden.has(keyLower)) continue;
    if (typeof v === 'string' && v.length < 4096) {
      safe[k.trim()] = v;
    }
  }
  return safe;
}

function expirationToSeconds(exp: string): number | undefined {
  if (exp === '24h') return 86400;
  if (exp === '7d') return 604800;
  if (exp === '30d') return 2592000;
  return undefined;
}

function parseImageDataUri(rawBase64: string, filename: string): {
  cleanBase64: string;
  mimeType: string;
  ext: string;
} {
  const dataUriMatch = rawBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/);
  const extFromName = filename.split('.').pop()?.toLowerCase() || '';
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1].toLowerCase();
    const subtype = mimeType.split('/')[1]?.replace('jpeg', 'jpg').replace('+xml', '') || extFromName || 'png';
    return {
      cleanBase64: dataUriMatch[2],
      mimeType,
      ext: subtype,
    };
  }
  const fallbackMime =
    extFromName === 'jpg' || extFromName === 'jpeg'
      ? 'image/jpeg'
      : extFromName === 'webp'
      ? 'image/webp'
      : extFromName === 'gif'
      ? 'image/gif'
      : 'image/png';
  return {
    cleanBase64: rawBase64,
    mimeType: fallbackMime,
    ext: extFromName || 'png',
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'postpro-studio', timestamp: Date.now() });
  });

  app.post('/api/proxy', async (req, res) => {
    const { url, method = 'GET', headers = {}, body } = req.body || {};
    if (typeof url !== 'string' || !url.trim()) {
      res.status(400).json({ ok: false, error: 'Falta la URL del endpoint.' });
      return;
    }

    const upperMethod = String(method).toUpperCase();
    if (!['GET', 'POST'].includes(upperMethod)) {
      res.status(400).json({ ok: false, error: 'Solo se permiten métodos GET o POST.' });
      return;
    }

    try {
      const targetUrl = await assertSafeExternalUrl(url.trim());
      const outHeaders = sanitizeOutgoingHeaders(headers);
      if (!outHeaders['User-Agent']) {
        outHeaders['User-Agent'] = 'PostProStudio/1.1 (NodeProxy)';
      }

      const fetchInit: RequestInit = {
        method: upperMethod,
        headers: outHeaders,
        signal: AbortSignal.timeout(12000),
      };

      if (upperMethod === 'POST' && body !== undefined && body !== null && body !== '') {
        fetchInit.body = typeof body === 'string' ? body : JSON.stringify(body);
        if (!outHeaders['Content-Type'] && !outHeaders['content-type']) {
          outHeaders['Content-Type'] = 'application/json';
        }
      }

      const started = performance.now();
      const upstream = await safeExternalFetch(targetUrl.toString(), fetchInit);
      const latencyMs = Math.round(performance.now() - started);
      const contentType = upstream.headers.get('content-type') || '';
      const rawText = await upstream.text();

      let parsedData: unknown = null;
      try {
        parsedData = JSON.parse(rawText);
      } catch {
        parsedData = null;
      }

      res.json({
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        latencyMs,
        contentType,
        data: parsedData,
        rawText: rawText.slice(0, 20000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error de red al consultar la API.';
      res.status(502).json({ ok: false, status: 0, error: message });
    }
  });

  interface RawYtSearchItem {
    videoId: string;
    title: string;
    channel: string;
    duration: string;
    views: string;
    published: string;
    thumbnail: string;
    description: string;
  }

  function extractTextRuns(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const obj = node as Record<string, unknown>;
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    if (Array.isArray(obj.runs)) {
      return obj.runs
        .map((r) => (r && typeof r === 'object' && typeof (r as Record<string, unknown>).text === 'string' ? (r as Record<string, unknown>).text : ''))
        .join('');
    }
    return '';
  }

  function collectYoutubeVideoRenderers(root: unknown, maxItems = 15): RawYtSearchItem[] {
    const results: RawYtSearchItem[] = [];
    const seen = new Set<string>();

    const walk = (node: unknown, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 20 || results.length >= maxItems) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (obj.videoRenderer && typeof obj.videoRenderer === 'object') {
        const vr = obj.videoRenderer as Record<string, unknown>;
        const videoId = typeof vr.videoId === 'string' ? vr.videoId.trim() : '';
        if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) && !seen.has(videoId)) {
          seen.add(videoId);
          const title = extractTextRuns(vr.title);
          const channel = extractTextRuns(vr.ownerText) || extractTextRuns(vr.longBylineText);
          const duration = extractTextRuns(vr.lengthText) || '';
          const views = extractTextRuns(vr.shortViewCountText) || extractTextRuns(vr.viewCountText) || '';
          const published = extractTextRuns(vr.publishedTimeText) || '';
          const thumbs = (vr.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails;
          const thumb =
            (Array.isArray(thumbs) && thumbs[thumbs.length - 1]?.url) ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

          let description = '';
          if (Array.isArray(vr.detailedMetadataSnippets)) {
            const first = vr.detailedMetadataSnippets[0] as Record<string, unknown> | undefined;
            if (first?.snippetText) description = extractTextRuns(first.snippetText);
          }

          if (title) {
            results.push({
              videoId,
              title,
              channel,
              duration,
              views,
              published,
              thumbnail: thumb,
              description,
            });
          }
        }
        return;
      }

      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };

    walk(root, 0);
    return results;
  }

  function extractYtInitialDataFromHtml(html: string): unknown | null {
    const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = '];
    for (const marker of markers) {
      const idx = html.indexOf(marker);
      if (idx === -1) continue;
      const start = html.indexOf('{', idx + marker.length);
      if (start === -1) continue;

      let depth = 0;
      let inStr = false;
      let escaped = false;
      for (let i = start; i < html.length; i++) {
        const ch = html[i];
        if (inStr) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inStr = false;
          }
          continue;
        }
        if (ch === '"') {
          inStr = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(html.slice(start, i + 1));
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }

  app.post('/api/youtube/search', async (req, res) => {
    const {
      query,
      youtubeApiKey = '',
      hl = 'es-419',
      gl = 'MX',
      maxResults = 10,
    } = req.body || {};

    if (typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ ok: false, error: 'Falta el término de búsqueda para YouTube.' });
      return;
    }

    const cleanQuery = query.trim();
    const limit = Math.max(1, Math.min(20, Number(maxResults) || 10));
    const started = performance.now();

    try {
      // 1. Official YouTube Data API v3 when user provides a key
      if (typeof youtubeApiKey === 'string' && youtubeApiKey.trim()) {
        const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${encodeURIComponent(
          cleanQuery
        )}&relevanceLanguage=es&key=${encodeURIComponent(youtubeApiKey.trim())}`;
        const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        const json = (await apiRes.json().catch(() => null)) as {
          items?: Array<{
            id?: { videoId?: string };
            snippet?: {
              title?: string;
              channelTitle?: string;
              publishedAt?: string;
              description?: string;
              thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
            };
          }>;
          error?: { message?: string };
        } | null;

        if (apiRes.ok && Array.isArray(json?.items)) {
          const items: RawYtSearchItem[] = json.items
            .filter((it) => it.id?.videoId)
            .map((it) => {
              const videoId = it.id!.videoId!;
              return {
                videoId,
                title: it.snippet?.title || 'Trailer YouTube',
                channel: it.snippet?.channelTitle || 'YouTube',
                duration: '',
                views: '',
                published: it.snippet?.publishedAt ? it.snippet.publishedAt.slice(0, 10) : '',
                thumbnail:
                  it.snippet?.thumbnails?.high?.url ||
                  it.snippet?.thumbnails?.medium?.url ||
                  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                description: it.snippet?.description || '',
              };
            });
          res.json({
            ok: true,
            source: 'youtube-api',
            latencyMs: Math.round(performance.now() - started),
            items,
          });
          return;
        }
      }

      // 2. Public YouTube Web Search (ytInitialData)
      const webHeaders = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': `${hl},es;q=0.9,en;q=0.8`,
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAI',
      };

      const webUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        cleanQuery
      )}&hl=${encodeURIComponent(String(hl))}&gl=${encodeURIComponent(String(gl))}`;
      const webRes = await fetch(webUrl, {
        headers: webHeaders,
        signal: AbortSignal.timeout(12000),
      });
      if (webRes.ok) {
        const html = await webRes.text();
        const initialData = extractYtInitialDataFromHtml(html);
        if (initialData) {
          const items = collectYoutubeVideoRenderers(initialData, limit);
          if (items.length > 0) {
            res.json({
              ok: true,
              source: 'youtube-web',
              latencyMs: Math.round(performance.now() - started),
              items,
            });
            return;
          }
        }
      }

      // 3. Fallback: YouTube InnerTube public search endpoint
      const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': webHeaders['User-Agent'],
          'Accept-Language': webHeaders['Accept-Language'],
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20241120.01.00',
              hl: String(hl),
              gl: String(gl),
            },
          },
          query: cleanQuery,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (innertubeRes.ok) {
        const innerJson = await innertubeRes.json().catch(() => null);
        if (innerJson) {
          const items = collectYoutubeVideoRenderers(innerJson, limit);
          res.json({
            ok: true,
            source: 'youtube-innertube',
            latencyMs: Math.round(performance.now() - started),
            items,
          });
          return;
        }
      }

      res.json({
        ok: false,
        source: 'none',
        latencyMs: Math.round(performance.now() - started),
        items: [],
        error: 'YouTube no devolvió resultados para esta consulta.',
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        items: [],
        error: err instanceof Error ? err.message : 'Error consultando YouTube.',
      });
    }
  });

  app.post('/api/image-host/verify', async (req, res) => {
    const { provider, apiKey = '', endpoint = '' } = req.body || {};
    const started = performance.now();

    try {
      if (provider === 'imgur') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Ingresa tu Client-ID de Imgur.' });
          return;
        }
        const upstream = await fetch('https://api.imgur.com/3/credits', {
          headers: { Authorization: `Client-ID ${apiKey.trim()}` },
          signal: AbortSignal.timeout(10000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          res.json({
            ok: false,
            status: upstream.status,
            latencyMs,
            error: json?.data?.error || `Imgur respondió HTTP ${upstream.status}`,
          });
          return;
        }
        res.json({
          ok: true,
          status: upstream.status,
          latencyMs,
          details: `Créditos restantes: ${json?.data?.ClientRemaining ?? 'OK'}`,
        });
        return;
      }

      if (provider === 'imgbb') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Ingresa tu API Key de ImgBB.' });
          return;
        }
        const form = new FormData();
        form.append('key', apiKey.trim());
        form.append('image', new Blob([new Uint8Array(VERIFY_PNG_BUFFER)], { type: 'image/png' }), 'postpro_verify.png');
        form.append('name', 'postpro_verify');
        form.append('expiration', '60');

        const upstream = await fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(12000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok || !json?.success) {
          res.json({
            ok: false,
            status: upstream.status,
            latencyMs,
            error: formatHostError(json?.error?.message, upstream.status, 'ImgBB'),
          });
          return;
        }
        res.json({
          ok: true,
          status: upstream.status,
          latencyMs,
          details: 'API Key válida (subida de verificación 60s OK)',
        });
        return;
      }

      if (provider === 'freeimage') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Ingresa tu API Key de Freeimage.host.' });
          return;
        }
        const form = new FormData();
        form.append('key', apiKey.trim());
        form.append('action', 'upload');
        form.append('source', new Blob([new Uint8Array(VERIFY_PNG_BUFFER)], { type: 'image/png' }), 'postpro_verify.png');
        form.append('format', 'json');

        const upstream = await fetch('https://freeimage.host/api/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(12000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok || json?.status_code !== 200) {
          res.json({
            ok: false,
            status: upstream.status,
            latencyMs,
            error: formatHostError(json?.error?.message, upstream.status, 'Freeimage.host'),
          });
          return;
        }
        res.json({
          ok: true,
          status: upstream.status,
          latencyMs,
          details: 'Freeimage API Key verificada',
        });
        return;
      }

      if (provider === 'postimages') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Postimages requiere una API Key de cuenta.' });
          return;
        }
        const form = new URLSearchParams();
        form.set('key', apiKey.trim());
        form.set('o', '2b819584285c102318568238c7d4a4c7');
        form.set('m', '59c2ad4b46b0c1e12b77033e20001c1a');
        form.set('version', '1.0.1');
        form.set('portable', '1');
        form.set('name', 'verify');
        form.set('type', 'png');
        form.set('image', VERIFY_PNG_BASE64);

        const upstream = await fetch('https://api.postimages.org/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(12000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const text = await upstream.text();
        if (!upstream.ok || text.includes('<error>') || !text.includes('http')) {
          res.json({
            ok: false,
            status: upstream.status,
            latencyMs,
            error: 'No se pudo autenticar con Postimages API (revisa tu API Key).',
          });
          return;
        }
        res.json({ ok: true, status: upstream.status, latencyMs, details: 'Postimages API verificado' });
        return;
      }

      if (provider === 'chevereto') {
        if (!endpoint.trim()) {
          res.status(400).json({ ok: false, error: 'Ingresa el Endpoint URL de tu servidor Chevereto / Custom.' });
          return;
        }
        const safeUrl = await assertSafeExternalUrl(endpoint.trim());
        const form = new FormData();
        if (apiKey.trim()) form.append('key', apiKey.trim());
        form.append('source', new Blob([new Uint8Array(VERIFY_PNG_BUFFER)], { type: 'image/png' }), 'postpro_verify.png');
        form.append('format', 'json');

        const upstream = await safeExternalFetch(safeUrl.toString(), {
          method: 'POST',
          headers: apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : {},
          body: form,
          signal: AbortSignal.timeout(12000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => null);
        if (!upstream.ok) {
          res.json({
            ok: false,
            status: upstream.status,
            latencyMs,
            error: formatHostError(json?.error?.message, upstream.status, 'Chevereto'),
          });
          return;
        }
        res.json({
          ok: true,
          status: upstream.status,
          latencyMs,
          details: 'Endpoint Chevereto / Custom respondió correctamente',
        });
        return;
      }

      res.status(400).json({ ok: false, error: 'Proveedor de imágenes no soportado.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al verificar el host de imágenes.';
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.post('/api/image-host/upload', async (req, res) => {
    const {
      provider,
      apiKey = '',
      endpoint = '',
      expiration = 'never',
      imageBase64,
      filename = 'cover.png',
    } = req.body || {};

    if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
      res.status(400).json({ ok: false, error: 'Falta el contenido de imagen en base64.' });
      return;
    }

    const { cleanBase64, mimeType, ext } = parseImageDataUri(imageBase64, String(filename || 'cover.png'));
    const started = performance.now();

    try {
      if (provider === 'imgbb') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Configura tu API Key de ImgBB antes de subir.' });
          return;
        }
        const imgBuffer = Buffer.from(cleanBase64, 'base64');
        const form = new FormData();
        form.append('key', apiKey.trim());
        form.append('image', new Blob([new Uint8Array(imgBuffer)], { type: mimeType }), filename);
        form.append('name', filename.replace(/\.[^.]+$/, ''));
        const secs = expirationToSeconds(expiration);
        if (secs) form.append('expiration', String(secs));

        const upstream = await fetch('https://api.imgbb.com/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok || !json?.success) {
          res.status(upstream.status || 502).json({
            ok: false,
            error: formatHostError(json?.error?.message, upstream.status, 'ImgBB'),
          });
          return;
        }
        res.json({
          ok: true,
          latencyMs,
          url: json.data.url,
          thumbUrl: json.data.thumb?.url || json.data.medium?.url || json.data.url,
          deleteUrl: json.data.delete_url,
        });
        return;
      }

      if (provider === 'freeimage') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Configura tu API Key de Freeimage.host antes de subir.' });
          return;
        }
        const imgBuffer = Buffer.from(cleanBase64, 'base64');
        const form = new FormData();
        form.append('key', apiKey.trim());
        form.append('action', 'upload');
        form.append('source', new Blob([new Uint8Array(imgBuffer)], { type: mimeType }), filename);
        form.append('format', 'json');

        const upstream = await fetch('https://freeimage.host/api/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok || json?.status_code !== 200) {
          res.status(upstream.status || 502).json({
            ok: false,
            error: formatHostError(json?.error?.message, upstream.status, 'Freeimage.host'),
          });
          return;
        }
        res.json({
          ok: true,
          latencyMs,
          url: json.image?.url,
          thumbUrl: json.image?.thumb?.url || json.image?.url,
        });
        return;
      }

      if (provider === 'imgur') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Configura tu Client-ID de Imgur antes de subir.' });
          return;
        }
        const form = new URLSearchParams();
        form.set('image', cleanBase64);
        form.set('type', 'base64');
        form.set('name', filename);

        const upstream = await fetch('https://api.imgur.com/3/image', {
          method: 'POST',
          headers: { Authorization: `Client-ID ${apiKey.trim()}` },
          body: form,
          signal: AbortSignal.timeout(20000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        if (!upstream.ok || !json?.success) {
          res.status(upstream.status || 502).json({
            ok: false,
            error: json?.data?.error || `Imgur respondió HTTP ${upstream.status}`,
          });
          return;
        }
        res.json({
          ok: true,
          latencyMs,
          url: json.data.link,
          thumbUrl: json.data.link,
        });
        return;
      }

      if (provider === 'postimages') {
        if (!apiKey.trim()) {
          res.status(400).json({ ok: false, error: 'Configura tu API Key de Postimages antes de subir.' });
          return;
        }
        const form = new URLSearchParams();
        form.set('key', apiKey.trim());
        form.set('o', '2b819584285c102318568238c7d4a4c7');
        form.set('m', '59c2ad4b46b0c1e12b77033e20001c1a');
        form.set('version', '1.0.1');
        form.set('portable', '1');
        form.set('name', filename);
        form.set('type', ext);
        form.set('image', cleanBase64);

        const upstream = await fetch('https://api.postimages.org/1/upload', {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const text = await upstream.text();
        const directMatch = text.match(/<direct_link>(.*?)<\/direct_link>|<hotlink>(.*?)<\/hotlink>/i);
        const errMatch = text.match(/<error>([\s\S]*?)<\/error>/i);
        const url = directMatch?.[1] || directMatch?.[2];
        if (!upstream.ok || !url) {
          res.status(502).json({
            ok: false,
            error: errMatch?.[1]?.trim() || 'Postimages no devolvió un enlace directo válido.',
          });
          return;
        }
        res.json({ ok: true, latencyMs, url, thumbUrl: url });
        return;
      }

      if (provider === 'chevereto') {
        if (!endpoint.trim()) {
          res.status(400).json({ ok: false, error: 'Configura el Endpoint URL de tu servidor Chevereto.' });
          return;
        }
        const safeUrl = await assertSafeExternalUrl(endpoint.trim());
        const imgBuffer = Buffer.from(cleanBase64, 'base64');
        const form = new FormData();
        if (apiKey.trim()) form.append('key', apiKey.trim());
        form.append('source', new Blob([new Uint8Array(imgBuffer)], { type: mimeType }), filename);
        form.append('format', 'json');

        const upstream = await safeExternalFetch(safeUrl.toString(), {
          method: 'POST',
          headers: apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : {},
          body: form,
          signal: AbortSignal.timeout(20000),
        });
        const latencyMs = Math.round(performance.now() - started);
        const json = await upstream.json().catch(() => ({}));
        const url = json?.image?.url || json?.data?.url || json?.url;
        if (!upstream.ok || !url) {
          res.status(upstream.status || 502).json({
            ok: false,
            error: formatHostError(json?.error?.message, upstream.status, 'Chevereto'),
          });
          return;
        }
        res.json({
          ok: true,
          latencyMs,
          url,
          thumbUrl: json?.image?.thumb?.url || url,
        });
        return;
      }

      res.status(400).json({ ok: false, error: 'Proveedor de host no soportado.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al subir imagen al host.';
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint API no encontrado.' });
  });

  const isBundledServer = typeof __BUNDLED_SERVER__ !== 'undefined' && __BUNDLED_SERVER__;

  if (!isBundledServer && process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = resolveDistDir();
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PostPro Studio running on http://localhost:${PORT} (0.0.0.0:${PORT})`);
  });
}

startServer();
