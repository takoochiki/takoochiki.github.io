import {
  createId,
  escapeRegExp,
  extractContextSnippet,
  forEachMatch,
  halfKanaToFullKana,
} from '../utils/textUtils.js';

const KANJI_CHAR_RE = /[\u4E00-\u9FFF々ヶ〆〇]/;
const ASCII_WORD_RE = /[A-Za-z0-9]/;
const URL_SKIP_RE = /https?:\/\/[^\s　」』）)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * URL / メール範囲を保護しつつテキスト変換を適用するヘルパー
 * @param {string} text
 * @param {(segment: string) => string} fn
 * @returns {string}
 */
function transformOutsideUrls(text, fn) {
  let out = '';
  let lastIdx = 0;
  forEachMatch(text, URL_SKIP_RE, (m) => {
    if (m.index > lastIdx) {
      out += fn(text.slice(lastIdx, m.index));
    }
    out += m[0];
    lastIdx = m.index + m[0].length;
  });
  if (lastIdx < text.length) {
    out += fn(text.slice(lastIdx));
  }
  return out;
}

/**
 * 原稿全体の記号・文字種を一括統一する変換カタログ（Undo 1回で復元可能）
 */
export const SYMBOL_TRANSFORMS = [
  {
    id: 'to-fullwidth-tilde',
    label: 'すべて全角チルダ「～」(U+FF5E) に統一',
    description: '原稿内の波ダッシュ「〜」(U+301C) を全角チルダ「～」(U+FF5E) に置換し、標準設定も全角チルダへ変更します。',
    ruleSettingPatch: { ruleId: 'punct.wave-dash-mix', options: { preferredChar: '～' } },
    countMatches(text) {
      return (text.match(/〜/g) || []).length;
    },
    apply(text) {
      return text.replace(/〜/g, '～');
    },
  },
  {
    id: 'to-wave-dash',
    label: 'すべて波ダッシュ「〜」(U+301C) に統一',
    description: '原稿内の全角チルダ「～」(U+FF5E) を波ダッシュ「〜」(U+301C) に置換し、標準設定も波ダッシュへ変更します。',
    ruleSettingPatch: { ruleId: 'punct.wave-dash-mix', options: { preferredChar: '〜' } },
    countMatches(text) {
      return (text.match(/～/g) || []).length;
    },
    apply(text) {
      return text.replace(/～/g, '〜');
    },
  },
  {
    id: 'to-horizontal-bar',
    label: 'ダッシュ類をすべて「―」(U+2015) に統一',
    description: 'EMダッシュ「—」や罫線代用「──」、長音連続「ーー」、ハイフン連続「--」を「―」に統一し、標準設定も「―」にします。',
    ruleSettingPatch: { ruleId: 'punct.dash-mix', options: { preferredChar: '―' } },
    countMatches(text) {
      const m1 = (text.match(/[—─━]/g) || []).length;
      const m2 = (text.match(/(?:ー{2,}|-{2,})/g) || []).length;
      return m1 + m2;
    },
    apply(text) {
      return text
        .replace(/[—─━]/g, '―')
        .replace(/ー{2,}/g, '――')
        .replace(/<!--[\s\S]*?-->|--+/g, (m) => (m.startsWith('<!') ? m : '――'));
    },
  },
  {
    id: 'to-em-dash',
    label: 'ダッシュ類をすべて「—」(U+2014) に統一',
    description: 'ホリゾンタルバー「―」や代用表記を「—」(U+2014) に統一し、標準設定も「—」にします。',
    ruleSettingPatch: { ruleId: 'punct.dash-mix', options: { preferredChar: '—' } },
    countMatches(text) {
      const m1 = (text.match(/[―─━]/g) || []).length;
      const m2 = (text.match(/(?:ー{2,}|-{2,})/g) || []).length;
      return m1 + m2;
    },
    apply(text) {
      return text
        .replace(/[―─━]/g, '—')
        .replace(/ー{2,}/g, '——')
        .replace(/<!--[\s\S]*?-->|--+/g, (m) => (m.startsWith('<!') ? m : '——'));
    },
  },
  {
    id: 'to-std-ellipsis',
    label: '三点リーダーをすべて「…」(U+2026) に統一',
    description: '中線三点リーダー「⋯」および代用表記（・・・、... 等）を標準「…」へ統一します。',
    ruleSettingPatch: { ruleId: 'punct.ellipsis-mix', options: { preferredChar: '…' } },
    countMatches(text) {
      const m1 = (text.match(/⋯/g) || []).length;
      const m2 = (text.match(/(?:[・･]{3,}|\.{3,}|．{2,})/g) || []).length;
      return m1 + m2;
    },
    apply(text) {
      return text
        .replace(/⋯/g, '…')
        .replace(/(?:[・･]{3,}|\.{3,}|．{2,})/g, '……');
    },
  },
  {
    id: 'to-midline-ellipsis',
    label: '三点リーダーをすべて「⋯」(U+22EF) に統一',
    description: '標準三点リーダー「…」および代用表記を「⋯」(U+22EF) へ統一します。',
    ruleSettingPatch: { ruleId: 'punct.ellipsis-mix', options: { preferredChar: '⋯' } },
    countMatches(text) {
      const m1 = (text.match(/…/g) || []).length;
      const m2 = (text.match(/(?:[・･]{3,}|\.{3,}|．{2,})/g) || []).length;
      return m1 + m2;
    },
    apply(text) {
      return text
        .replace(/…/g, '⋯')
        .replace(/(?:[・･]{3,}|\.{3,}|．{2,})/g, '⋯⋯');
    },
  },
  {
    id: 'fix-odd-ellipsis-dash',
    label: '奇数個の三点リーダー・ダッシュをすべて偶数個に揃える',
    description: '1個や3個などの奇数連続になっている「…」「⋯」「―」「—」に1文字補って偶数個にします。',
    ruleSettingPatch: null,
    countMatches(text) {
      const e = (text.match(/[…⋯]+/g) || []).filter((s) => s.length % 2 !== 0).length;
      const d = (text.match(/[―—]+/g) || []).filter((s) => s.length % 2 !== 0).length;
      return e + d;
    },
    apply(text) {
      return text
        .replace(/[…⋯]+/g, (m) => (m.length % 2 !== 0 ? m + m[0] : m))
        .replace(/[―—]+/g, (m) => (m.length % 2 !== 0 ? m + m[0] : m));
    },
  },
  {
    id: 'half-kana-to-full',
    label: '半角カタカナをすべて全角カタカナに変換',
    description: '原稿内の半角カタカナ（濁点・半濁点含む）をすべて全角カタカナに変換します。',
    ruleSettingPatch: null,
    countMatches(text) {
      return (text.match(/[\uFF66-\uFF9F]+/g) || []).length;
    },
    apply(text) {
      return text.replace(/[\uFF66-\uFF9F]+/g, (m) => halfKanaToFullKana(m));
    },
  },
  {
    id: 'half-qe-to-full',
    label: '半角「?」「!」をすべて全角「？」「！」に変換',
    description: 'URL内を除き、半角の疑問符・感嘆符をすべて全角に変換します。',
    ruleSettingPatch: null,
    countMatches(text) {
      let count = 0;
      transformOutsideUrls(text, (seg) => {
        count += (seg.match(/[?!]/g) || []).length;
        return seg;
      });
      return count;
    },
    apply(text) {
      return transformOutsideUrls(text, (seg) =>
        seg.replace(/\?/g, '？').replace(/!/g, '！')
      );
    },
  },
  {
    id: 'half-paren-to-full',
    label: '半角丸括弧「()」をすべて全角「（）」に変換',
    description: 'URL内を除き、半角の丸括弧をすべて全角に変換します。',
    ruleSettingPatch: null,
    countMatches(text) {
      let count = 0;
      transformOutsideUrls(text, (seg) => {
        count += (seg.match(/[()]/g) || []).length;
        return seg;
      });
      return count;
    },
    apply(text) {
      return transformOutsideUrls(text, (seg) =>
        seg.replace(/\(/g, '（').replace(/\)/g, '）')
      );
    },
  },
];

/**
 * ID からシンボル変換定義を取得する
 * @param {string} id
 */
export function getSymbolTransform(id) {
  return SYMBOL_TRANSFORMS.find((t) => t.id === id) || null;
}

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
      // 単漢字語（事・時・所・私など）や短い漢字語の前後に漢字がくっついている熟語を除外
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
   * 原稿内の全表記揺れグループの出現状況を集計する。
   * ignoreManager が渡された場合、無視済み箇所を除いた有効表記のみで揺れ競合を判定する。
   * @param {string} text
   * @param {any[]} variantGroups
   * @param {import('../core/IgnoreManager.js').IgnoreManager | null} [ignoreManager]
   */
  analyzeAllGroups(text, variantGroups, ignoreManager = null) {
    const lineStarts = this._buildLineStarts(text);

    return variantGroups.map((group) => {
      const terms = (group.terms || []).filter(Boolean);
      const termStats = {};
      const activeTermStats = {};
      const ignoredTermStats = {};
      for (const term of terms) {
        termStats[term] = 0;
        activeTermStats[term] = 0;
        ignoredTermStats[term] = 0;
      }
      const occurrences = [];
      const groupIgnored = ignoreManager
        ? ignoreManager.isVariantGroupIgnored(group.id)
        : false;

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

          const isOccIgnored =
            groupIgnored ||
            (ignoreManager
              ? Boolean(
                  ignoreManager.findMatchingEntry(
                    { ruleId: 'variant.inconsistency', start, end, matchedText: term },
                    text
                  )
                )
              : false);

          termStats[term] = (termStats[term] || 0) + 1;
          if (isOccIgnored) {
            ignoredTermStats[term] = (ignoredTermStats[term] || 0) + 1;
          } else {
            activeTermStats[term] = (activeTermStats[term] || 0) + 1;
          }

          occurrences.push({
            id: `${group.id}_${start}_${end}`,
            term,
            start,
            end,
            line: this._getLineNumber(lineStarts, start),
            ignored: isOccIgnored,
            snippet: extractContextSnippet(text, start, end, 18),
          });
        });
      }

      const allPresentTerms = Object.entries(termStats)
        .filter(([, count]) => count > 0)
        .map(([term]) => term);
      const activeTerms = Object.entries(activeTermStats)
        .filter(([, count]) => count > 0)
        .map(([term]) => term);

      const totalCount = occurrences.length;
      const activeCount = occurrences.filter((o) => !o.ignored).length;
      const ignoredCount = totalCount - activeCount;

      const hasConflict =
        !groupIgnored &&
        (activeTerms.length > 1 ||
          (Boolean(group.preferred) &&
            activeTerms.some((t) => t !== group.preferred)));

      const hasRawConflict =
        allPresentTerms.length > 1 ||
        (Boolean(group.preferred) &&
          allPresentTerms.some((t) => t !== group.preferred));

      return {
        group,
        termStats,
        activeTermStats,
        ignoredTermStats,
        allPresentTerms,
        activeTerms,
        totalCount,
        activeCount,
        ignoredCount,
        groupIgnored,
        hasConflict,
        hasRawConflict,
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
