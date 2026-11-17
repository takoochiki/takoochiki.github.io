import { computeCharCounts, escapeRegExp } from '../utils/textUtils.js';

/**
 * 原稿の文字数・文字種比率・約物頻度・特定文字列の出現回数集計サービス
 * （校正ルール.md 第6章「特定文字列の出現回数の集計」「使用文字種・約物の頻度集計」に対応）
 */
export class StatsService {
  /**
   * 原稿全体の統計情報を計算する
   * @param {string} text
   * @param {string} [customQuery]
   */
  analyze(text, customQuery = '') {
    const counts = computeCharCounts(text);

    const charTypes = {
      kanji: 0,
      hiragana: 0,
      katakana: 0,
      halfKana: 0,
      fullAlnum: 0,
      halfAlnum: 0,
      punctuationAndSymbols: 0,
      whitespace: 0,
      other: 0,
    };

    const targetPuncts = [
      '。', '、', '！', '？', '…', '―', '「', '」', '『', '』',
      '（', '）', '・', '《', '》', '〜', '～',
    ];
    const punctCounts = {};
    for (const p of targetPuncts) {
      punctCounts[p] = 0;
    }

    for (const ch of text) {
      if (ch === '\n' || ch === '\r') continue;

      if (Object.prototype.hasOwnProperty.call(punctCounts, ch)) {
        punctCounts[ch]++;
      }

      if (/[\u4E00-\u9FFF\u3400-\u4DBF々ヶ〆〇]/.test(ch)) {
        charTypes.kanji++;
      } else if (/[\u3040-\u309F]/.test(ch)) {
        charTypes.hiragana++;
      } else if (/[\u30A0-\u30FF]/.test(ch)) {
        charTypes.katakana++;
      } else if (/[\uFF65-\uFF9F]/.test(ch)) {
        charTypes.halfKana++;
      } else if (/[Ａ-Ｚａ-ｚ０-９]/.test(ch)) {
        charTypes.fullAlnum++;
      } else if (/[A-Za-z0-9]/.test(ch)) {
        charTypes.halfAlnum++;
      } else if (/[\s\u3000]/.test(ch)) {
        charTypes.whitespace++;
      } else if (/[。、．，,.!！?？…⋯―—─━「」『』（）()［］\[\]《》・･〜～：；""'']/.test(ch)) {
        charTypes.punctuationAndSymbols++;
      } else {
        charTypes.other++;
      }
    }

    // 段落・会話行割合の集計
    const lines = text.replace(/\r\n|\r/g, '\n').split('\n').filter((l) => l.trim().length > 0);
    let dialogueLines = 0;
    let narrativeLines = 0;
    for (const l of lines) {
      const trimmed = l.replace(/^[ \t\u3000]+/, '');
      if (/^[「『（(“]/.test(trimmed)) {
        dialogueLines++;
      } else {
        narrativeLines++;
      }
    }

    const queryResult = customQuery ? this.countOccurrences(text, customQuery) : null;

    return {
      counts,
      charTypes,
      punctCounts,
      lineBreakdown: {
        nonBlankLines: lines.length,
        dialogueLines,
        narrativeLines,
      },
      queryResult,
    };
  }

  /**
   * 特定文字列の出現回数と出現行リストを返す
   * @param {string} text
   * @param {string} query
   */
  countOccurrences(text, query) {
    if (!query) return { query: '', count: 0, lines: [] };
    const re = new RegExp(escapeRegExp(query), 'g');
    let count = 0;
    const matchedLines = new Set();
    const normalized = text.replace(/\r\n|\r/g, '\n');
    const lines = normalized.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineMatches = lines[i].match(re);
      if (lineMatches) {
        count += lineMatches.length;
        matchedLines.add(i + 1);
      }
    }
    return {
      query,
      count,
      lines: [...matchedLines].slice(0, 50),
    };
  }
}
