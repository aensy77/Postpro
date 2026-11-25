import { DEFAULT_YOUTUBE_PRIORITIES } from '../data/defaults';
import type {
  YoutubeTrailerPriorityId,
  YoutubeTrailerPriorityRule,
  YoutubeTrailerResult,
} from '../types';

export interface RawYoutubeSearchItem {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  published: string;
  thumbnail: string;
  description: string;
}

export function extractYoutubeVideoId(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : '';
}

export function normalizeYoutubeShortUrl(videoIdOrUrl: string): string {
  const id = extractYoutubeVideoId(videoIdOrUrl);
  return id ? `https://youtu.be/${id}` : videoIdOrUrl.trim();
}

function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const LATINO_TITLE_PATTERNS = [
  /\bespanol latino\b/,
  /\bdoblado\b/,
  /\baudio latino\b/,
  /\btrailer latino\b/,
  /\btriler latino\b/,
  /\ben latino\b/,
  /\blatino\b/,
];

const LATINO_CHANNEL_PATTERNS = [
  /sony pictures latino/,
  /warner bros\.?\s*pictures latino/,
  /universal pictures mexico/,
  /universal pictures latino/,
  /20th century studios la/,
  /disney studios la/,
  /paramount mexico/,
  /paramount pictures mexico/,
  /netflix latinoamerica/,
  /prime video latinoamerica/,
  /crunchyroll en espanol/,
  /diamond films/,
  /cinepolis/,
  /corazon films/,
  /latinoamerica/,
];

const SUBTITLED_PATTERNS = [
  /\bsubtitulado\b/,
  /\bsubtitulada\b/,
  /\bsub espanol\b/,
  /\bsub\.?\s*esp\b/,
  /\bsubs\.?\s*espanol\b/,
  /\bsubtitulos en espanol\b/,
  /\bvose\b/,
  /\bsub esp\b/,
  /\bespanol sub\b/,
];

const CASTELLANO_PATTERNS = [
  /\bcastellano\b/,
  /\bespana\b/,
  /\bespanol de espana\b/,
];

const OFFICIAL_TRAILER_PATTERNS = [
  /\bofficial trailer\b/,
  /\btrailer oficial\b/,
  /\btriler oficial\b/,
  /\bofficial teaser\b/,
  /\bteaser oficial\b/,
  /\bmain trailer\b/,
  /\bfinal trailer\b/,
  /\btrailer\b/,
  /\bavance oficial\b/,
];

const OFFICIAL_STUDIO_CHANNEL_PATTERNS = [
  /sony pictures/,
  /warner bros/,
  /universal pictures/,
  /20th century/,
  /disney/,
  /marvel/,
  /paramount/,
  /netflix/,
  /prime video/,
  /apple tv/,
  /a24/,
  /lionsgate/,
  /crunchyroll/,
  /aniplex/,
  /toho/,
  /kadokawa/,
  /mappa/,
  /ufotable/,
  /trailers/,
  /sensacine/,
];

const NOISE_PENALTY_PATTERNS = [
  /\breaction\b/,
  /\breaccion\b/,
  /\breview\b/,
  /\bresena\b/,
  /\bresumen\b/,
  /\bexplicacion\b/,
  /\bending explained\b/,
  /\bfan made\b/,
  /\bfanmade\b/,
  /\bconcept trailer\b/,
  /\bparody\b/,
  /\bparodia\b/,
  /\bgameplay\b/,
  /\bfull movie\b/,
  /\bpelicula completa\b/,
  /\bsoundtrack\b/,
  /\bost\b/,
  /\bmusica\b/,
];

function classifyAndScoreCandidate(opts: {
  item: RawYoutubeSearchItem;
  sourceRuleId: YoutubeTrailerPriorityId;
  movieTitle: string;
  movieYear: string;
  activeRules: YoutubeTrailerPriorityRule[];
}): {
  matchedPriorityId: YoutubeTrailerPriorityId;
  score: number;
  badges: string[];
} {
  const titleNorm = normalizeText(opts.item.title);
  const channelNorm = normalizeText(opts.item.channel);
  const descNorm = normalizeText(opts.item.description);
  const combined = `${titleNorm} ${channelNorm} ${descNorm}`;
  const badges: string[] = [];

  const isLatinoTitle = LATINO_TITLE_PATTERNS.some((rx) => rx.test(titleNorm) || rx.test(descNorm));
  const isLatinoChannel = LATINO_CHANNEL_PATTERNS.some((rx) => rx.test(channelNorm));
  const isSubtitled = SUBTITLED_PATTERNS.some((rx) => rx.test(combined));
  const isCastellano = CASTELLANO_PATTERNS.some((rx) => rx.test(titleNorm) || rx.test(channelNorm));
  const isTrailer = OFFICIAL_TRAILER_PATTERNS.some((rx) => rx.test(titleNorm));
  const isOfficialKeyword = /\boficial\b|\bofficial\b/.test(titleNorm);
  const isOfficialChannel = OFFICIAL_STUDIO_CHANNEL_PATTERNS.some((rx) => rx.test(channelNorm));
  const isNoise = NOISE_PENALTY_PATTERNS.some((rx) => rx.test(titleNorm));

  // Determine true classification among enabled priorities
  let matchedPriorityId: YoutubeTrailerPriorityId = opts.sourceRuleId;
  const enabledSet = new Set(opts.activeRules.map((r) => r.id));

  if ((isLatinoTitle || (isLatinoChannel && !isSubtitled)) && enabledSet.has('latino_dubbed')) {
    matchedPriorityId = 'latino_dubbed';
  } else if (isSubtitled && enabledSet.has('subtitled_es')) {
    matchedPriorityId = 'subtitled_es';
  } else if (
    !isLatinoTitle &&
    !isSubtitled &&
    /\bofficial trailer\b|\bmain trailer\b|\bofficial teaser\b/.test(titleNorm) &&
    enabledSet.has('original_lang')
  ) {
    matchedPriorityId = 'original_lang';
  }

  let score = 50;

  // Title word overlap with movie title
  const movieWords = normalizeText(opts.movieTitle)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  if (movieWords.length > 0) {
    let hits = 0;
    for (const w of movieWords) {
      if (titleNorm.includes(w)) hits++;
    }
    const ratio = hits / movieWords.length;
    score += Math.round(ratio * 45);
  }

  // Year match
  if (opts.movieYear.trim() && combined.includes(opts.movieYear.trim())) {
    score += 18;
    badges.push(`Año ${opts.movieYear.trim()}`);
  }

  if (isTrailer) {
    score += 24;
  } else {
    score -= 22;
  }

  if (isOfficialKeyword) {
    score += 18;
    badges.push('Oficial');
  }

  if (isOfficialChannel) {
    score += 16;
    badges.push('Canal Estudio');
  }

  if (matchedPriorityId === 'latino_dubbed') {
    if (isLatinoTitle) score += 28;
    if (isLatinoChannel) score += 20;
    if (isCastellano && !isLatinoTitle) score -= 12;
  } else if (matchedPriorityId === 'subtitled_es') {
    if (isSubtitled) score += 28;
  } else if (matchedPriorityId === 'original_lang') {
    if (/\bofficial trailer\b|\bofficial teaser\b/.test(titleNorm)) score += 20;
  }

  if (isNoise) {
    score -= 55;
    badges.push('No trailer');
  }

  return {
    matchedPriorityId,
    score: Math.max(0, score),
    badges: Array.from(new Set(badges)),
  };
}

export async function searchYoutubeTrailers(params: {
  title: string;
  year?: string;
  priorities?: YoutubeTrailerPriorityRule[];
  youtubeApiKey?: string;
  tmdbId?: string;
  tmdbApiKey?: string;
  mediaType?: string;
}): Promise<{
  ok: boolean;
  results: YoutubeTrailerResult[];
  queriesExecuted: Array<{ priorityId: YoutubeTrailerPriorityId; label: string; query: string; count: number }>;
  error?: string;
}> {
  const cleanTitle = (params.title || '').trim();
  const cleanYear = (params.year || '').trim();

  if (!cleanTitle) {
    return {
      ok: false,
      results: [],
      queriesExecuted: [],
      error: 'Ingresa el nombre de la película o serie para buscar el trailer.',
    };
  }

  const allRules =
    params.priorities && params.priorities.length > 0
      ? params.priorities
      : DEFAULT_YOUTUBE_PRIORITIES;
  const activeRules = allRules.filter((r) => r.enabled);
  const rulesToRun = activeRules.length > 0 ? activeRules : [allRules[0]];

  const titleAlreadyHasYear = cleanYear.length === 4 && cleanTitle.includes(cleanYear);
  const baseTerms = titleAlreadyHasYear ? cleanTitle : [cleanTitle, cleanYear].filter(Boolean).join(' ');

  const queryJobs = rulesToRun.map(async (rule, idx) => {
    const fullQuery = `${baseTerms} ${rule.querySuffix}`.trim();
    const hl = rule.id === 'original_lang' ? 'en' : 'es-419';
    const gl = rule.id === 'original_lang' ? 'US' : 'MX';

    try {
      const res = await fetch('/api/youtube/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: fullQuery,
          youtubeApiKey: params.youtubeApiKey || '',
          hl,
          gl,
          maxResults: 8,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        items?: RawYoutubeSearchItem[];
        error?: string;
      } | null;

      return {
        rule,
        rank: idx + 1,
        fullQuery,
        ok: Boolean(json?.ok),
        items: Array.isArray(json?.items) ? json!.items : [],
        error: json?.error,
      };
    } catch (err) {
      return {
        rule,
        rank: idx + 1,
        fullQuery,
        ok: false,
        items: [] as RawYoutubeSearchItem[],
        error: err instanceof Error ? err.message : 'Error de red',
      };
    }
  });

  const jobResults = await Promise.all(queryJobs);

  const rankById = new Map<YoutubeTrailerPriorityId, { rank: number; rule: YoutubeTrailerPriorityRule }>();
  rulesToRun.forEach((r, idx) => {
    rankById.set(r.id, { rank: idx + 1, rule: r });
  });

  const candidateMap = new Map<string, YoutubeTrailerResult>();

  for (const job of jobResults) {
    for (let i = 0; i < job.items.length; i++) {
      const item = job.items[i];
      if (!item.videoId) continue;

      const evalRes = classifyAndScoreCandidate({
        item,
        sourceRuleId: job.rule.id,
        movieTitle: cleanTitle,
        movieYear: cleanYear,
        activeRules: rulesToRun,
      });

      // Slight position bonus within YouTube's natural search ranking
      const positionBonus = Math.max(0, 12 - i * 1.5);
      const totalScore = Math.round(evalRes.score + positionBonus);

      const ruleInfo = rankById.get(evalRes.matchedPriorityId) || {
        rank: job.rank,
        rule: job.rule,
      };

      const candidate: YoutubeTrailerResult = {
        videoId: item.videoId,
        url: normalizeYoutubeShortUrl(item.videoId),
        title: item.title,
        channel: item.channel || 'YouTube',
        duration: item.duration || '',
        views: item.views || '',
        published: item.published || '',
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
        matchedPriorityId: evalRes.matchedPriorityId,
        matchedPriorityLabel: ruleInfo.rule.label,
        priorityRank: ruleInfo.rank,
        score: totalScore,
        badges: evalRes.badges,
      };

      const existing = candidateMap.get(item.videoId);
      if (
        !existing ||
        candidate.priorityRank < existing.priorityRank ||
        (candidate.priorityRank === existing.priorityRank && candidate.score > existing.score)
      ) {
        candidateMap.set(item.videoId, candidate);
      }
    }
  }

  // Optional TMDB fallback enrichment if user has TMDB API key & tmdbId
  if (params.tmdbApiKey?.trim() && params.tmdbId?.trim()) {
    try {
      const mType = params.mediaType === 'tv' ? 'tv' : 'movie';
      for (const lang of ['es-MX', 'es-ES', 'en-US']) {
        const proxyRes = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: `https://api.themoviedb.org/3/${mType}/${encodeURIComponent(
              params.tmdbId.trim()
            )}/videos?api_key=${encodeURIComponent(params.tmdbApiKey.trim())}&language=${lang}`,
          }),
        });
        const payload = await proxyRes.json().catch(() => null);
        const videos = (payload?.data as {
          results?: Array<{
            site?: string;
            key?: string;
            name?: string;
            type?: string;
            official?: boolean;
            iso_639_1?: string;
          }>;
        } | null)?.results;
        if (Array.isArray(videos)) {
          for (const v of videos) {
            if (v.site !== 'YouTube' || !v.key || candidateMap.has(v.key)) continue;
            if (v.type !== 'Trailer' && v.type !== 'Teaser') continue;
            const inferredId: YoutubeTrailerPriorityId =
              lang === 'es-MX'
                ? 'latino_dubbed'
                : lang === 'en-US'
                ? 'original_lang'
                : 'subtitled_es';
            const ruleInfo = rankById.get(inferredId) || {
              rank: rulesToRun.length,
              rule: rulesToRun[rulesToRun.length - 1],
            };
            candidateMap.set(v.key, {
              videoId: v.key,
              url: normalizeYoutubeShortUrl(v.key),
              title: v.name || `${cleanTitle} Trailer`,
              channel: `TMDB (${lang})`,
              duration: '',
              views: '',
              published: cleanYear,
              thumbnail: `https://i.ytimg.com/vi/${v.key}/hqdefault.jpg`,
              matchedPriorityId: ruleInfo.rule.id,
              matchedPriorityLabel: ruleInfo.rule.label,
              priorityRank: ruleInfo.rank,
              score: v.official ? 120 : 95,
              badges: [v.official ? 'TMDB Oficial' : 'TMDB'],
            });
          }
        }
      }
    } catch {
      // Ignore TMDB video enrichment failure
    }
  }

  const sorted = Array.from(candidateMap.values()).sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
    return b.score - a.score;
  });

  const queriesExecuted = jobResults.map((j) => ({
    priorityId: j.rule.id,
    label: j.rule.label,
    query: j.fullQuery,
    count: j.items.length,
  }));

  const anySuccess = jobResults.some((j) => j.ok) || sorted.length > 0;
  const firstError = jobResults.find((j) => j.error)?.error;

  return {
    ok: anySuccess,
    results: sorted,
    queriesExecuted,
    error: !anySuccess ? firstError || 'No se encontraron trailers en YouTube.' : undefined,
  };
}
