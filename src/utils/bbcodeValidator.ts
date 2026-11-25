export type BbDiagnosticSeverity = 'error' | 'warning';

export interface BbDiagnostic {
  id: string;
  severity: BbDiagnosticSeverity;
  line: number;
  column: number;
  start: number;
  end: number;
  snippet: string;
  message: string;
}

export type BbHighlightKind =
  | 'text'
  | 'tag-valid'
  | 'tag-code'
  | 'var'
  | 'warning'
  | 'error';

export interface BbHighlightSegment {
  start: number;
  end: number;
  text: string;
  kind: BbHighlightKind;
  diagnosticMessage?: string;
}

export interface BbValidationResult {
  segments: BbHighlightSegment[];
  diagnostics: BbDiagnostic[];
  errorCount: number;
  warningCount: number;
  validTagCount: number;
  lineSeverities: Record<number, BbDiagnosticSeverity>;
}

const PAIRED_TAGS = new Set([
  'b',
  'i',
  'u',
  's',
  'center',
  'left',
  'right',
  'quote',
  'code',
  'spoiler',
  'jd',
  'youtube',
  'list',
  'color',
  'size',
  'url',
  'img',
]);

const SELF_CLOSING_TAGS = new Set(['*', 'hosticon', 'hr']);

const KNOWN_TAGS = new Set([...PAIRED_TAGS, ...SELF_CLOSING_TAGS]);

const LITERAL_CONTAINER_TAGS = new Set(['code', 'jd']);

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function getLineCol(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  const lineIdx = Math.max(0, hi);
  return {
    line: lineIdx + 1,
    column: offset - lineStarts[lineIdx] + 1,
  };
}

function isValidColorAttr(attr: string): boolean {
  const val = attr.trim();
  if (!val) return false;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) return true;
  if (/^[a-z]{3,20}$/i.test(val)) return true;
  if (/^\{\{[a-z0-9_]+\}\}$/i.test(val)) return true;
  return false;
}

function isValidSizeAttr(attr: string): boolean {
  const val = attr.trim();
  if (/^\{\{[a-z0-9_]+\}\}$/i.test(val)) return true;
  if (!/^\d{1,2}$/.test(val)) return false;
  const num = Number(val);
  return num >= 1 && num <= 72;
}

function isValidUrlAttr(attr: string): boolean {
  const val = attr.trim();
  if (!val) return false;
  if (/\{\{[a-z0-9_]+\}\}/i.test(val)) return true;
  return /^(https?:\/\/|magnet:\?|ftp:\/\/|\/)/i.test(val);
}

interface StackEntry {
  tag: string;
  start: number;
  end: number;
  contentStart: number;
  segmentIndex: number;
  line: number;
  column: number;
  snippet: string;
}

export function validateBbCode(input: string): BbValidationResult {
  if (!input) {
    return {
      segments: [],
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
      validTagCount: 0,
      lineSeverities: {},
    };
  }

  const lineStarts = buildLineStarts(input);
  const segments: BbHighlightSegment[] = [];
  const diagnostics: BbDiagnostic[] = [];
  const stack: StackEntry[] = [];
  let validTagCount = 0;

  const pushPlain = (start: number, end: number, kind: BbHighlightKind = 'text') => {
    if (end <= start) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && !last.diagnosticMessage && last.end === start) {
      last.end = end;
      last.text = input.slice(last.start, end);
      return;
    }
    segments.push({
      start,
      end,
      text: input.slice(start, end),
      kind,
    });
  };

  const addDiagnostic = (
    severity: BbDiagnosticSeverity,
    start: number,
    end: number,
    message: string,
    segIdx?: number
  ) => {
    const { line, column } = getLineCol(lineStarts, start);
    diagnostics.push({
      id: `diag-${diagnostics.length}-${start}`,
      severity,
      line,
      column,
      start,
      end,
      snippet: input.slice(start, end),
      message,
    });
    if (segIdx !== undefined && segments[segIdx]) {
      const currentKind = segments[segIdx].kind;
      if (severity === 'error' || currentKind !== 'error') {
        segments[segIdx].kind = severity;
      }
      segments[segIdx].diagnosticMessage = message;
    }
  };

  let cursor = 0;
  let plainStart = 0;
  let activeLiteralTag: string | null = null;

  while (cursor < input.length) {
    const ch = input[cursor];

    // Inside [code]...[/code] or [jd]...[/jd], do not parse nested tags—only look for matching close tag
    if (activeLiteralTag) {
      if (ch === '[' && input[cursor + 1] === '/') {
        const closeRx = new RegExp(`^\\[\\/${activeLiteralTag}\\]`, 'i');
        const m = closeRx.exec(input.slice(cursor));
        if (m) {
          pushPlain(plainStart, cursor, 'tag-code');
          const tagEnd = cursor + m[0].length;
          const segIdx = segments.length;
          segments.push({
            start: cursor,
            end: tagEnd,
            text: input.slice(cursor, tagEnd),
            kind: 'tag-code',
          });
          // Pop the matching literal tag from stack
          const matchIdx = stack.map((s) => s.tag).lastIndexOf(activeLiteralTag);
          if (matchIdx !== -1) {
            stack.splice(matchIdx, 1);
            validTagCount += 1;
          }
          activeLiteralTag = null;
          cursor = tagEnd;
          plainStart = cursor;
          continue;
        }
      }
      cursor += 1;
      continue;
    }

    // Template placeholders {{var}}
    if (ch === '{' && input[cursor + 1] === '{') {
      const nlIdx = input.indexOf('\n', cursor);
      const closeIdx = input.indexOf('}}', cursor + 2);
      if (closeIdx !== -1 && (nlIdx === -1 || closeIdx < nlIdx)) {
        const inner = input.slice(cursor + 2, closeIdx);
        pushPlain(plainStart, cursor, 'text');
        const tokenEnd = closeIdx + 2;
        const segIdx = segments.length;
        const validVar = /^[a-zA-Z0-9_]+$/.test(inner);
        segments.push({
          start: cursor,
          end: tokenEnd,
          text: input.slice(cursor, tokenEnd),
          kind: validVar ? 'var' : 'warning',
        });
        if (!validVar) {
          addDiagnostic(
            'warning',
            cursor,
            tokenEnd,
            `Variable de plantilla mal formada: "${input.slice(cursor, tokenEnd)}"`,
            segIdx
          );
        }
        cursor = tokenEnd;
        plainStart = cursor;
        continue;
      } else {
        // Unclosed {{ on this line
        const lineEnd = nlIdx === -1 ? input.length : nlIdx;
        const tokenEnd = Math.min(lineEnd, cursor + 24);
        pushPlain(plainStart, cursor, 'text');
        const segIdx = segments.length;
        segments.push({
          start: cursor,
          end: tokenEnd,
          text: input.slice(cursor, tokenEnd),
          kind: 'warning',
        });
        addDiagnostic(
          'warning',
          cursor,
          tokenEnd,
          'Variable de plantilla "{{..." sin cerrar con "}}"',
          segIdx
        );
        cursor = tokenEnd;
        plainStart = cursor;
        continue;
      }
    }

    // BBCode tag candidate starting with '['
    if (ch === '[') {
      const nlIdx = input.indexOf('\n', cursor + 1);
      const nextClose = input.indexOf(']', cursor + 1);
      const nextOpen = input.indexOf('[', cursor + 1);

      const closeOnSameLine =
        nextClose !== -1 &&
        (nlIdx === -1 || nextClose < nlIdx) &&
        (nextOpen === -1 || nextClose < nextOpen);

      if (!closeOnSameLine) {
        // Check if it looks like an unclosed BBCode tag (missing ']')
        const lineSliceEnd =
          nlIdx !== -1 && (nextOpen === -1 || nlIdx < nextOpen)
            ? nlIdx
            : nextOpen !== -1
            ? nextOpen
            : input.length;
        const rawFragment = input.slice(cursor, lineSliceEnd);
        const brokenTagMatch = /^\[(\/?)(\*|[a-zA-Z][a-zA-Z0-9_-]*)(?:=|\s|$)/.exec(
          rawFragment
        );
        const tagCandidate = brokenTagMatch ? brokenTagMatch[2].toLowerCase() : '';
        if (brokenTagMatch && (brokenTagMatch[1] === '/' || KNOWN_TAGS.has(tagCandidate))) {
          pushPlain(plainStart, cursor, 'text');
          const segIdx = segments.length;
          segments.push({
            start: cursor,
            end: lineSliceEnd,
            text: rawFragment,
            kind: 'error',
          });
          addDiagnostic(
            'error',
            cursor,
            lineSliceEnd,
            `Etiqueta mal formada: falta el corchete de cierre "]" en "${rawFragment.slice(0, 32)}"`,
            segIdx
          );
          cursor = lineSliceEnd;
          plainStart = cursor;
          continue;
        }
        cursor += 1;
        continue;
      }

      const rawTag = input.slice(cursor, nextClose + 1);
      const inner = input.slice(cursor + 1, nextClose);
      const parsed = /^(\/?)(\*|[a-zA-Z][a-zA-Z0-9_-]*)(?:(?:(=)|\s+(?:size|width)=)([\s\S]*))?$/i.exec(inner);

      if (!parsed) {
        // Could be malformed like "[]" or "[/]" or "[b something]"
        const looksBroken =
          inner.trim() === '' ||
          inner.startsWith('/') ||
          /^(b|i|u|s|url|img|color|size|center|left|right|quote|code|spoiler|jd|youtube|list|hosticon)\b/i.test(
            inner.trim()
          );
        if (looksBroken) {
          pushPlain(plainStart, cursor, 'text');
          const tagEnd = nextClose + 1;
          const segIdx = segments.length;
          segments.push({
            start: cursor,
            end: tagEnd,
            text: rawTag,
            kind: 'error',
          });
          addDiagnostic(
            'error',
            cursor,
            tagEnd,
            `Etiqueta BBCode mal formada: "${rawTag}"`,
            segIdx
          );
          cursor = tagEnd;
          plainStart = cursor;
          continue;
        }
        // Plain bracketed label like [1080p] or [2024]
        cursor = nextClose + 1;
        continue;
      }

      const isClosing = parsed[1] === '/';
      const tagName = parsed[2].toLowerCase();
      const hasEquals = parsed[3] === '=';
      const hasImgSizeAttr = !hasEquals && tagName === 'img' && parsed[4] !== undefined;
      const attrValue = parsed[4] ?? '';

      // Unknown opening bracket tag like [EAC3] or [BluRay] -> treat as plain text, not BBCode error
      if (!isClosing && !KNOWN_TAGS.has(tagName)) {
        cursor = nextClose + 1;
        continue;
      }

      pushPlain(plainStart, cursor, 'text');
      const tagEnd = nextClose + 1;
      const segIdx = segments.length;

      // Closing tag with unknown name like [/foo]
      if (isClosing && !KNOWN_TAGS.has(tagName)) {
        segments.push({
          start: cursor,
          end: tagEnd,
          text: rawTag,
          kind: 'warning',
        });
        addDiagnostic(
          'warning',
          cursor,
          tagEnd,
          `Etiqueta de cierre desconocida "${rawTag}"`,
          segIdx
        );
        cursor = tagEnd;
        plainStart = cursor;
        continue;
      }

      if (isClosing) {
        if (SELF_CLOSING_TAGS.has(tagName) || hasEquals) {
          segments.push({
            start: cursor,
            end: tagEnd,
            text: rawTag,
            kind: 'error',
          });
          addDiagnostic(
            'error',
            cursor,
            tagEnd,
            hasEquals
              ? `Etiqueta de cierre mal formada "${rawTag}" (no debe llevar "=")`
              : `La etiqueta "[${tagName}]" es autocontenida y no requiere cierre "${rawTag}"`,
            segIdx
          );
          cursor = tagEnd;
          plainStart = cursor;
          continue;
        }

        const matchIdx = stack.map((s) => s.tag).lastIndexOf(tagName);
        if (matchIdx === -1) {
          segments.push({
            start: cursor,
            end: tagEnd,
            text: rawTag,
            kind: 'error',
          });
          addDiagnostic(
            'error',
            cursor,
            tagEnd,
            `Etiqueta de cierre "${rawTag}" sin etiqueta de apertura "[${tagName}]"`,
            segIdx
          );
        } else if (matchIdx === stack.length - 1) {
          const opened = stack.pop()!;
          segments.push({
            start: cursor,
            end: tagEnd,
            text: rawTag,
            kind: 'tag-valid',
          });
          validTagCount += 1;

          if (tagName === 'img') {
            const innerImg = input.slice(opened.contentStart, cursor).trim();
            if (!innerImg) {
              addDiagnostic(
                'warning',
                opened.start,
                tagEnd,
                'Etiqueta [img]...[/img] vacía sin URL de imagen',
                segIdx
              );
            }
          }
        } else {
          // Crossed / out-of-order closing tag: flag intervening unclosed inner tags
          const intervening = stack.splice(matchIdx + 1);
          stack.pop(); // remove matching open
          for (const orphan of intervening) {
            addDiagnostic(
              'error',
              orphan.start,
              orphan.end,
              `Etiqueta "[${orphan.tag}]" abierta sin cerrar antes de "${rawTag}"`,
              orphan.segmentIndex
            );
          }
          segments.push({
            start: cursor,
            end: tagEnd,
            text: rawTag,
            kind: 'warning',
          });
          addDiagnostic(
            'warning',
            cursor,
            tagEnd,
            `Cierre desordenado "${rawTag}" (se cerró antes que ${intervening
              .map((o) => `[/${o.tag}]`)
              .join(', ')})`,
            segIdx
          );
        }

        cursor = tagEnd;
        plainStart = cursor;
        continue;
      }

      // Opening or self-closing tag
      let initialKind: BbHighlightKind = LITERAL_CONTAINER_TAGS.has(tagName)
        ? 'tag-code'
        : 'tag-valid';
      let attrWarning: string | null = null;
      let attrError: string | null = null;

      if (tagName === 'color') {
        if (!hasEquals || !isValidColorAttr(attrValue)) {
          attrWarning = `Color mal formado en "${rawTag}". Usa formato #hex (ej. #00f0ff) o nombre CSS.`;
        }
      } else if (tagName === 'size') {
        if (!hasEquals || !isValidSizeAttr(attrValue)) {
          attrWarning = `Tamaño inválido en "${rawTag}". Usa un número entre 1 y 72 (ej. [size=5] o [size=22]).`;
        }
      } else if (tagName === 'img') {
        if (hasImgSizeAttr && !/^\d{2,4}$/.test(attrValue.trim())) {
          attrWarning = `Ancho inválido en "${rawTag}". Usa [img size=350].`;
        } else if (hasEquals) {
          attrWarning = `Usa [img size=350] en lugar de "${rawTag}".`;
        }
      } else if (tagName === 'url') {
        if (hasEquals && !isValidUrlAttr(attrValue)) {
          attrError = `URL vacía o inválida en "${rawTag}".`;
        }
      } else if (tagName === 'spoiler') {
        if (hasEquals && !attrValue.trim()) {
          attrWarning = 'Título vacío en [spoiler=]. Especifica un texto o usa [spoiler].';
        }
      } else if (tagName === 'hosticon') {
        if (!hasEquals || !attrValue.trim()) {
          attrWarning = 'Falta identificador en [hosticon=...] (ej. [hosticon=mega]).';
        }
      } else if (tagName === '*') {
        if (!stack.some((s) => s.tag === 'list')) {
          attrWarning = 'Viñeta [*] utilizada fuera de un bloque [list]...[/list].';
        }
        if (hasEquals) {
          attrWarning = `Atributo innecesario en "${rawTag}".`;
        }
      } else if (hasEquals) {
        attrWarning = `La etiqueta [${tagName}] no espera atributo "=" en "${rawTag}".`;
      }

      if (attrError) initialKind = 'error';
      else if (attrWarning) initialKind = 'warning';

      segments.push({
        start: cursor,
        end: tagEnd,
        text: rawTag,
        kind: initialKind,
      });

      if (attrError) {
        addDiagnostic('error', cursor, tagEnd, attrError, segIdx);
      } else if (attrWarning) {
        addDiagnostic('warning', cursor, tagEnd, attrWarning, segIdx);
      } else if (SELF_CLOSING_TAGS.has(tagName)) {
        validTagCount += 1;
      }

      if (PAIRED_TAGS.has(tagName)) {
        const { line, column } = getLineCol(lineStarts, cursor);
        stack.push({
          tag: tagName,
          start: cursor,
          end: tagEnd,
          contentStart: tagEnd,
          segmentIndex: segIdx,
          line,
          column,
          snippet: rawTag,
        });
        if (LITERAL_CONTAINER_TAGS.has(tagName)) {
          activeLiteralTag = tagName;
        }
      }

      cursor = tagEnd;
      plainStart = cursor;
      continue;
    }

    cursor += 1;
  }

  // Remaining trailing text
  pushPlain(plainStart, input.length, activeLiteralTag ? 'tag-code' : 'text');

  // Any remaining open tags on stack were never closed
  for (const unclosed of stack) {
    addDiagnostic(
      'error',
      unclosed.start,
      unclosed.end,
      `Etiqueta "${unclosed.snippet}" sin etiqueta de cierre "[/${unclosed.tag}]"`,
      unclosed.segmentIndex
    );
  }

  const lineSeverities: Record<number, BbDiagnosticSeverity> = {};
  let errorCount = 0;
  let warningCount = 0;

  for (const d of diagnostics) {
    if (d.severity === 'error') {
      errorCount += 1;
      lineSeverities[d.line] = 'error';
    } else {
      warningCount += 1;
      if (lineSeverities[d.line] !== 'error') {
        lineSeverities[d.line] = 'warning';
      }
    }
  }

  diagnostics.sort((a, b) => a.start - b.start);

  return {
    segments,
    diagnostics,
    errorCount,
    warningCount,
    validTagCount,
    lineSeverities,
  };
}
