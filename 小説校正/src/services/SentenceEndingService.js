/**
 * 日本語小説の文末表現の連続検出サービス（E01〜E07）
 * 形態素解析・外部辞書・AI を使用せず、UTF-16コードユニット位置と括弧対応解析により
 * 文分割・文末抽出・連続区間検出・重複統合を行う。
 */

export const DEFAULT_E02_EXPRESSIONS = [
  'のだ',
  'のだった',
  'のである',
  'のです',
  'だろう',
  'でしょう',
  'かもしれない',
  'に違いない',
  'はずだ',
  'わけだ',
  'と思った',
  'と思う',
];

export const POLITE_ENDING_FORMS = [
  'ませんでした',
  'ました',
  'ません',
  'でした',
  'です',
  'ます',
];

const NON_PAST_CHARS = new Set(['る', 'く', 'す', 'む', 'ぶ', 'ぬ', 'つ', 'う', 'ぐ']);
const KANA_END_RE = /^[\u3041-\u3096\u30A1-\u30F6ー]$/;
const TERMINATOR_RE = /[。！？!?]/;
const TRAILING_STRIP_RE = /[。！？!?\s\u3000」』）)】］〉》〕｝”'"]+$/;

const BRACKET_PAIRS = {
  '「': '」',
  '『': '』',
  '（': '）',
  '(': ')',
  '【': '】',
  '［': '］',
  '〈': '〉',
  '〔': '〕',
  '｛': '｝',
  '“': '”',
};

const CLOSE_TO_OPEN = Object.fromEntries(
  Object.entries(BRACKET_PAIRS).map(([o, c]) => [c, o])
);

const DIALOGUE_OPEN_SET = new Set(['「', '『']);

export class SentenceEndingService {
  /**
   * 連続ブロックから検査対象となる文の連なり (runs) を抽出する。
   * - 空行・場面転換・章区切りでリセット（resetOnParagraphBreak === true 時）
   * - 独立した会話文（`「...」` / `『...』`）は初期設定で検査除外＆地の文の連続判定をリセット
   * - 括弧内の句点では文を分割しない
   * - 通常の単一改行ではリセットしない
   * @param {import('../core/RuleContext.js').RuleContext} ctx
   * @param {{ includeDialogue?: boolean, resetOnParagraphBreak?: boolean }} opts
   * @returns {Array<Array<{ start: number, end: number, text: string, normalizedEnd: string, isDialogue: boolean }>>}
   */
  extractSentenceRuns(ctx, opts = {}) {
    const includeDialogue = Boolean(opts.includeDialogue);
    const resetOnParagraphBreak = opts.resetOnParagraphBreak !== false;

    const blocks = this._splitParagraphBlocks(ctx, resetOnParagraphBreak);
    const allRuns = [];

    for (const block of blocks) {
      let currentRun = [];
      const flushRun = () => {
        if (currentRun.length > 0) {
          allRuns.push(currentRun);
          currentRun = [];
        }
      };

      this._scanBlockSentences(
        ctx.text,
        block.start,
        block.end,
        includeDialogue,
        (sentence) => {
          currentRun.push(sentence);
        },
        () => {
          flushRun();
        }
      );

      flushRun();
    }

    return allRuns;
  }

  /**
   * 段落・空行・場面転換・章見出しに基づいて検査ブロックを分割する
   */
  _splitParagraphBlocks(ctx, resetOnParagraphBreak) {
    const lines = ctx.lines;
    if (lines.length === 0) return [];

    if (!resetOnParagraphBreak) {
      return [{ start: 0, end: ctx.text.length }];
    }

    const blocks = [];
    let blockStart = null;
    let blockEnd = null;

    for (const line of lines) {
      if (line.isBlank || line.isSceneBreak || line.isHeading) {
        if (blockStart !== null) {
          blocks.push({ start: blockStart, end: blockEnd });
          blockStart = null;
          blockEnd = null;
        }
      } else {
        if (blockStart === null) {
          blockStart = line.start;
        }
        blockEnd = line.end;
      }
    }
    if (blockStart !== null) {
      blocks.push({ start: blockStart, end: blockEnd });
    }
    return blocks;
  }

  /**
   * 対応括弧の閉じ位置をブロック内で探索する
   */
  _findMatchingClose(text, openIdx, limitEnd) {
    const openCh = text[openIdx];
    const closeCh = BRACKET_PAIRS[openCh];
    if (!closeCh) return -1;

    const stack = [closeCh];
    for (let i = openIdx + 1; i < limitEnd; i++) {
      const ch = text[i];
      if (BRACKET_PAIRS[ch]) {
        stack.push(BRACKET_PAIRS[ch]);
      } else if (CLOSE_TO_OPEN[ch]) {
        if (stack[stack.length - 1] === ch) {
          stack.pop();
          if (stack.length === 0) return i;
        } else {
          const idx = stack.lastIndexOf(ch);
          if (idx !== -1) {
            stack.splice(idx);
            if (stack.length === 0) return i;
          }
        }
      }
    }
    return -1;
  }

  /**
   * 閉じ括弧の後、同じ行（\n まで）に地の文が続いているか判定する
   */
  _hasFollowingNarrativeOnLine(text, afterCloseIdx, limitEnd) {
    for (let i = afterCloseIdx; i < limitEnd; i++) {
      const ch = text[i];
      if (ch === '\n') return false;
      if (!/[ \t\u3000]/.test(ch)) return true;
    }
    return false;
  }

  /**
   * 1ブロック内を走査して文を抽出し、会話文境界でリセットコールバックを呼ぶ
   */
  _scanBlockSentences(text, start, end, includeDialogue, onSentence, onReset, isDialogueCtx = false) {
    const bracketStack = [];
    let segStart = start;

    const skipLeadingWs = (idx) => {
      while (idx < end && /[ \t\u3000\n]/.test(text[idx])) {
        idx++;
      }
      return idx;
    };

    segStart = skipLeadingWs(segStart);
    let i = segStart;

    while (i < end) {
      const ch = text[i];

      // 文先頭で独立会話括弧（`「...」` / `『...』`）に遭遇した場合の特別処理
      if (bracketStack.length === 0 && !isDialogueCtx && DIALOGUE_OPEN_SET.has(ch) && i === segStart) {
        const closePos = this._findMatchingClose(text, i, end);
        if (closePos !== -1 && !this._hasFollowingNarrativeOnLine(text, closePos + 1, end)) {
          if (includeDialogue) {
            this._scanBlockSentences(
              text,
              i + 1,
              closePos,
              true,
              onSentence,
              onReset,
              true
            );
          } else {
            onReset();
          }
          i = skipLeadingWs(closePos + 1);
          segStart = i;
          continue;
        }
      }

      // 独立した丸括弧文（`（〜だった。）`）が単独行にある場合は内部を検査する
      if (bracketStack.length === 0 && (ch === '（' || ch === '(') && i === segStart) {
        const closePos = this._findMatchingClose(text, i, end);
        if (closePos !== -1 && !this._hasFollowingNarrativeOnLine(text, closePos + 1, end)) {
          this._scanBlockSentences(
            text,
            i + 1,
            closePos,
            includeDialogue,
            onSentence,
            onReset,
            isDialogueCtx
          );
          i = skipLeadingWs(closePos + 1);
          segStart = i;
          continue;
        }
      }

      if (BRACKET_PAIRS[ch]) {
        bracketStack.push(BRACKET_PAIRS[ch]);
        i++;
        continue;
      }

      if (CLOSE_TO_OPEN[ch] && bracketStack.length > 0) {
        if (bracketStack[bracketStack.length - 1] === ch) {
          bracketStack.pop();
        } else {
          const idx = bracketStack.lastIndexOf(ch);
          if (idx !== -1) bracketStack.splice(idx);
        }
        i++;
        continue;
      }

      if (bracketStack.length === 0 && TERMINATOR_RE.test(ch)) {
        // 連続する疑問符・感嘆符等を1つの文末区切りとしてまとめる
        let termEnd = i + 1;
        while (termEnd < end && TERMINATOR_RE.test(text[termEnd])) {
          termEnd++;
        }
        // 直後に閉じ括弧のみ続く場合（例: 「〜だ。」）は文末に含め、比較時には除外する
        while (termEnd < end && CLOSE_TO_OPEN[text[termEnd]] && bracketStack.length === 0) {
          termEnd++;
        }

        const rawSentence = text.slice(segStart, termEnd);
        const normalizedEnd = rawSentence.replace(TRAILING_STRIP_RE, '');

        if (normalizedEnd.length > 0) {
          onSentence({
            start: segStart,
            end: termEnd,
            text: rawSentence.trim(),
            normalizedEnd,
            isDialogue: isDialogueCtx,
          });
        }

        i = skipLeadingWs(termEnd);
        segStart = i;
        continue;
      }

      i++;
    }
  }

  /**
   * E01・E06 で共通利用する末尾一致連続区間の抽出ヘルパー
   * @param {any[]} sentences
   * @param {number} threshold
   * @param {number} minLen
   * @param {number} maxLen
   * @returns {Array<{ startIdx: number, endIdx: number, matchText: string, matchLen: number }>}
   */
  findCommonSuffixRuns(sentences, threshold, minLen, maxLen) {
    const candidates = [];
    const safeMin = Math.max(1, minLen);
    const safeMax = Math.max(safeMin, maxLen);

    for (let len = safeMax; len >= safeMin; len--) {
      let runStart = 0;
      let prevSuffix = null;

      const flush = (endIdx) => {
        if (prevSuffix !== null && endIdx - runStart + 1 >= threshold) {
          candidates.push({
            startIdx: runStart,
            endIdx,
            matchText: prevSuffix,
            matchLen: len,
          });
        }
      };

      for (let i = 0; i < sentences.length; i++) {
        const endStr = sentences[i].normalizedEnd;
        const suffix = endStr.length >= len ? endStr.slice(-len) : null;
        if (suffix !== null && suffix === prevSuffix) {
          continue;
        }
        flush(i - 1);
        runStart = i;
        prevSuffix = suffix;
      }
      flush(sentences.length - 1);
    }

    // 同一または包含される重複区間を整理し、最長一致 / 広い連続区間を1件にまとめる
    if (candidates.length <= 1) return candidates;

    // 連続文数が多い区間を優先し、同数なら一致文字数が長いものを優先する
    candidates.sort((a, b) => {
      const spanA = a.endIdx - a.startIdx;
      const spanB = b.endIdx - b.startIdx;
      if (spanB !== spanA) return spanB - spanA;
      return b.matchLen - a.matchLen;
    });

    const selected = [];
    for (const cand of candidates) {
      const overlapsExisting = selected.some(
        (ex) => cand.startIdx <= ex.endIdx && cand.endIdx >= ex.startIdx
      );
      if (!overlapsExisting) {
        selected.push(cand);
      }
    }

    return selected.sort((a, b) => a.startIdx - b.startIdx);
  }

  /**
   * 述語関数（文 → キー文字列または null）により同一キーが threshold 回以上連続する区間を抽出する
   */
  _findKeyRuns(sentences, threshold, keyExtractor) {
    const hits = [];
    let runStart = 0;
    let prevKey = null;

    const flush = (endIdx) => {
      if (prevKey !== null && endIdx - runStart + 1 >= threshold) {
        hits.push({
          startIdx: runStart,
          endIdx,
          key: prevKey,
        });
      }
    };

    for (let i = 0; i < sentences.length; i++) {
      const key = keyExtractor(sentences[i]);
      if (key !== null && key === prevKey) {
        continue;
      }
      flush(i - 1);
      runStart = i;
      prevKey = key;
    }
    flush(sentences.length - 1);
    return hits;
  }

  /**
   * E01〜E07 の全ルールを実行し、同一連続区間の重複を統合した指摘配列を返す
   * @param {import('../core/RuleContext.js').RuleContext} ctx
   * @param {Record<string, any>} globalOpts
   */
  evaluateAll(ctx, globalOpts = {}) {
    const allSettings = ctx.allSettings || {};
    const runs = this.extractSentenceRuns(ctx, globalOpts);
    if (runs.length === 0) return [];

    const ruleConf = (id, defaults) => {
      const st = allSettings[id];
      return {
        enabled: st ? Boolean(st.enabled) : defaults.enabled,
        options: { ...defaults.options, ...(st?.options || {}) },
      };
    };

    const e01 = ruleConf('ending.E01', {
      enabled: true,
      options: { threshold: 3, minLength: 3, maxLength: 6 },
    });
    const e02 = ruleConf('ending.E02', {
      enabled: true,
      options: { threshold: 3, expressions: DEFAULT_E02_EXPRESSIONS.join(', ') },
    });
    const e03 = ruleConf('ending.E03', { enabled: true, options: { threshold: 5 } });
    const e04 = ruleConf('ending.E04', { enabled: false, options: { threshold: 5 } });
    const e05 = ruleConf('ending.E05', { enabled: false, options: { threshold: 5 } });
    const e06 = ruleConf('ending.E06', {
      enabled: false,
      options: { threshold: 3, compareLength: 4 },
    });
    const e07 = ruleConf('ending.E07', { enabled: true, options: { threshold: 4 } });

    const e02List = String(e02.options.expressions || '')
      .split(/[,、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    const rawDetections = [];

    for (const sentences of runs) {
      if (sentences.length < 2) continue;

      const pushHit = (ruleCode, ruleLabel, startIdx, endIdx, matchedPattern) => {
        const slice = sentences.slice(startIdx, endIdx + 1);
        const start = slice[0].start;
        const end = slice[slice.length - 1].end;
        rawDetections.push({
          ruleCode,
          ruleLabel,
          start,
          end,
          count: slice.length,
          matchedPattern,
          sentences: slice.map((s) => s.text),
        });
      };

      // E01: 完全に同じ文末文字列 (3〜6文字)
      if (e01.enabled) {
        const threshold = Math.max(2, Number(e01.options.threshold ?? 3));
        const minLen = Math.max(3, Number(e01.options.minLength ?? 3));
        const maxLen = Math.max(minLen, Number(e01.options.maxLength ?? 6));
        const hits = this.findCommonSuffixRuns(sentences, threshold, minLen, maxLen);
        for (const h of hits) {
          pushHit(
            'E01',
            'E01: 同じ文末文字列の連続',
            h.startIdx,
            h.endIdx,
            `「〜${h.matchText}」（${h.matchLen}文字一致）`
          );
        }
      }

      // E02: 特徴的な文末表現の連続
      if (e02.enabled && e02List.length > 0) {
        const threshold = Math.max(2, Number(e02.options.threshold ?? 3));
        const hits = this._findKeyRuns(sentences, threshold, (s) => {
          for (const expr of e02List) {
            if (s.normalizedEnd.endsWith(expr)) return expr;
          }
          return null;
        });
        for (const h of hits) {
          pushHit(
            'E02',
            'E02: 特徴的な文末表現の連続',
            h.startIdx,
            h.endIdx,
            `「〜${h.key}」`
          );
        }
      }

      // E03: 「た」で終わる文の連続
      if (e03.enabled) {
        const threshold = Math.max(2, Number(e03.options.threshold ?? 5));
        const hits = this._findKeyRuns(sentences, threshold, (s) =>
          s.normalizedEnd.endsWith('た') ? 'た' : null
        );
        for (const h of hits) {
          pushHit('E03', 'E03: 「た」で終わる文の連続', h.startIdx, h.endIdx, '最終文字「た」');
        }
      }

      // E04: 非過去形を示唆する文末の連続
      if (e04.enabled) {
        const threshold = Math.max(2, Number(e04.options.threshold ?? 5));
        const hits = this._findKeyRuns(sentences, threshold, (s) => {
          const last = s.normalizedEnd.slice(-1);
          return NON_PAST_CHARS.has(last) ? 'NON_PAST' : null;
        });
        for (const h of hits) {
          pushHit(
            'E04',
            'E04: 非過去形を示唆する文末の連続',
            h.startIdx,
            h.endIdx,
            '語尾「る/く/す/む/ぶ/ぬ/つ/う/ぐ」'
          );
        }
      }

      // E05: 文末の最終仮名1文字の一致（漢字・記号終わり除外）
      if (e05.enabled) {
        const threshold = Math.max(2, Number(e05.options.threshold ?? 5));
        const hits = this._findKeyRuns(sentences, threshold, (s) => {
          const last = s.normalizedEnd.slice(-1);
          return KANA_END_RE.test(last) ? last : null;
        });
        for (const h of hits) {
          pushHit(
            'E05',
            'E05: 文末の最終仮名の一致',
            h.startIdx,
            h.endIdx,
            `最終仮名「${h.key}」`
          );
        }
      }

      // E06: 同一述語の連続（簡易判定・E01と共通の末尾一致ヘルパーを使用）
      if (e06.enabled) {
        const threshold = Math.max(2, Number(e06.options.threshold ?? 3));
        const compareLen = Math.max(1, Number(e06.options.compareLength ?? 4));
        const hits = this.findCommonSuffixRuns(sentences, threshold, compareLen, compareLen);
        for (const h of hits) {
          pushHit(
            'E06',
            'E06: 同一述語の連続（簡易判定）',
            h.startIdx,
            h.endIdx,
            `「〜${h.matchText}」（末尾${compareLen}文字）`
          );
        }
      }

      // E07: 丁寧体の同一文末形式
      if (e07.enabled) {
        const threshold = Math.max(2, Number(e07.options.threshold ?? 4));
        const hits = this._findKeyRuns(sentences, threshold, (s) => {
          for (const form of POLITE_ENDING_FORMS) {
            if (s.normalizedEnd.endsWith(form)) return form;
          }
          return null;
        });
        for (const h of hits) {
          pushHit(
            'E07',
            'E07: 丁寧体の同一文末形式の連続',
            h.startIdx,
            h.endIdx,
            `丁寧体「〜${h.key}」`
          );
        }
      }
    }

    // 同一箇所 [start, end] に該当する複数ルールの警告を1件に統合する
    const mergedMap = new Map();
    for (const det of rawDetections) {
      const spanKey = `${det.start}:${det.end}`;
      if (!mergedMap.has(spanKey)) {
        mergedMap.set(spanKey, {
          start: det.start,
          end: det.end,
          count: det.count,
          rules: [det.ruleLabel],
          ruleCodes: [det.ruleCode],
          patterns: [det.matchedPattern],
          sentences: det.sentences,
        });
      } else {
        const entry = mergedMap.get(spanKey);
        if (!entry.ruleCodes.includes(det.ruleCode)) {
          entry.ruleCodes.push(det.ruleCode);
          entry.rules.push(det.ruleLabel);
        }
        if (!entry.patterns.includes(det.matchedPattern)) {
          entry.patterns.push(det.matchedPattern);
        }
      }
    }

    return [...mergedMap.values()].map((entry) => {
      const rulesSummary = entry.rules.join(' / ');
      const patternsSummary = entry.patterns.join('・');
      return ctx.createIssue({
        start: entry.start,
        end: entry.end,
        severityOverride: 'warning',
        ruleIdOverride: `ending.${entry.ruleCodes[0]}`,
        ruleNameOverride: rulesSummary,
        message: `[${rulesSummary}] ${entry.count}文連続（一致: ${patternsSummary}）。文末表現が連続しています。意図的な反復でないか確認してください。`,
        suggestions: [],
        extra: {
          endingDetails: {
            rules: entry.rules,
            ruleCodes: entry.ruleCodes,
            count: entry.count,
            patterns: entry.patterns,
            sentences: entry.sentences,
          },
        },
      });
    });
  }
}
