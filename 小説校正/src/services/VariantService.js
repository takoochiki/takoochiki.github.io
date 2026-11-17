import { createId, escapeRegExp, extractContextSnippet, forEachMatch } from '../utils/textUtils.js';

const KANJI_CHAR_RE = /[\u4E00-\u9FFF々ヶ〆〇]/;
const ASCII_WORD_RE = /[A-Za-z0-9]/;

/**
 * 表記揺れ辞書の集計・出現箇所抽出・個別除外付き一括置換・プレビューを担当する
 */
export class VariantService {
  /**
   * 境界判定を行い、複合語中の誤検出を抑止するかどうかを判定する
   * @param {string} text
   * @param {number} start
   * @param {number} end
   * @param {string} term
   * @param {boolean} boundaryCheck
   * @returns {boolean}
   */
  isValidMatch(text, start, end, term, boundaryCheck) {
    const prev = start > 0 ? text[start - 1] : '';
    const next = end < text.length ? text[end] : '';

    // 英数字用語は前後に英数字が連続する部分一致を除外
    if (/^[A-Za-z0-9_.\-]+$/.test(term)) {
      if ((prev && ASCII_WORD_RE.test(prev)) || (next && ASCII_WORD_RE.test(next))) {
        return false;
      }
    }

    if (boundaryCheck) {
      // 単漢字語（事・物・時・所・私など）や短い漢字語の前後に漢字がくっついている熟語を除外
      if (KANJI_CHAR_RE.test(term[0]) && prev && KANJI_CHAR_RE.test(prev)) {
        return false;
      }
      if (KANJI_CHAR_RE.test(term[term.length - 1]) && next && KANJI_CHAR_RE.test(next)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 行番号計算用テーブルを構築
   * @param {string} text
   */
  _buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  _getLineNumber(lineStarts, offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) {
        if (mid + 1 >= lineStarts.length || lineStarts[mid + 1] > offset) {
          return mid + 1;
        }
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return 1;
  }

  /**
   * 原稿内の全表記揺れグループの出現状況を集計する
   * @param {string} text
   * @param {any[]} variantGroups
   */
  analyzeAllGroups(text, variantGroups) {
    const lineStarts = this._buildLineStarts(text);

    return variantGroups.map((group) => {
      const terms = (group.terms || []).filter(Boolean);
      const termStats = {};
      for (const term of terms) {
        termStats[term] = 0;
      }
      const occurrences = [];

      if (terms.length > 0) {
        // 長い語を優先してマッチさせ、同一箇所への重複マッチを防ぐ
        const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
        const pattern = new RegExp(sortedTerms.map(escapeRegExp).join('|'), 'g');

        forEachMatch(text, pattern, (m) => {
          const term = m[0];
          const start = m.index;
          const end = start + term.length;
          if (!this.isValidMatch(text, start, end, term, Boolean(group.boundaryCheck))) {
            return;
          }
          termStats[term] = (termStats[term] || 0) + 1;
          occurrences.push({
            id: `${group.id}_${start}_${end}`,
            term,
            start,
            end,
            line: this._getLineNumber(lineStarts, start),
            snippet: extractContextSnippet(text, start, end, 18),
          });
        });
      }

      const activeTerms = Object.entries(termStats)
        .filter(([, count]) => count > 0)
        .map(([term]) => term);
      const totalCount = occurrences.length;
      const hasConflict =
        activeTerms.length > 1 ||
        (Boolean(group.preferred) &&
          activeTerms.some((t) => t !== group.preferred));

      return {
        group,
        termStats,
        activeTerms,
        totalCount,
        hasConflict,
        occurrences,
      };
    });
  }

  /**
   * 指定グループに対して統一先表記を適用した場合の置換対象一覧とプレビューを生成する
   * @param {string} text
   * @param {object} groupAnalysis
   * @param {string} targetTerm
   * @param {Set<string>} excludedOccurrenceIds
   */
  buildBatchPreview(text, groupAnalysis, targetTerm, excludedOccurrenceIds = new Set()) {
    const targets = groupAnalysis.occurrences.filter((occ) => occ.term !== targetTerm);
    const activeReplacements = targets.filter((occ) => !excludedOccurrenceIds.has(occ.id));

    // プレビュー用テキスト生成（後ろから置換）
    let previewText = text;
    const sortedDesc = [...activeReplacements].sort((a, b) => b.start - a.start);
    for (const occ of sortedDesc) {
      previewText =
        previewText.slice(0, occ.start) + targetTerm + previewText.slice(occ.end);
    }

    // 変更行の差分プレビュー配列を生成
    const beforeLines = text.split('\n');
    const afterLines = previewText.split('\n');
    const changedLineNumbers = [...new Set(activeReplacements.map((o) => o.line))].sort((a, b) => a - b);
    const lineDiffs = changedLineNumbers.map((ln) => ({
      line: ln,
      before: beforeLines[ln - 1] ?? '',
      after: afterLines[ln - 1] ?? '',
    }));

    return {
      targets,
      activeCount: activeReplacements.length,
      excludedCount: targets.length - activeReplacements.length,
      previewText,
      lineDiffs,
    };
  }

  /**
   * 新規表記揺れグループ定義を作成する
   * @param {string} termsCsv
   * @param {string} preferred
   * @param {boolean} boundaryCheck
   */
  createGroup(termsCsv, preferred = '', boundaryCheck = false) {
    const terms = termsCsv
      .split(/[,、\/／\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const uniqueTerms = [...new Set(terms)];
    if (uniqueTerms.length < 2) {
      throw new Error('表記揺れグループには2つ以上の異なる表記を指定してください。');
    }
    return {
      id: createId('var'),
      label: uniqueTerms.join(' / '),
      terms: uniqueTerms,
      preferred: uniqueTerms.includes(preferred) ? preferred : '',
      boundaryCheck: Boolean(boundaryCheck),
    };
  }
}
