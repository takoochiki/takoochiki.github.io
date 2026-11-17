/**
 * テキスト処理・文字変換・位置計算ユーティリティ
 * すべてのインデックスは JavaScript の UTF-16 コードユニット単位で統一する。
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML 特殊文字をエスケープする
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * 正規表現特殊文字をエスケープする
 * @param {string} str
 * @returns {string}
 */
export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Unicode コードポイント単位の文字数をカウントする（サロゲートペアを1文字と数える）
 * @param {string} str
 * @returns {number}
 */
export function countCodePoints(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
      }
    }
    count++;
  }
  return count;
}

/**
 * 原稿文字数（改行・空白除外オプション付き）を計算する
 * @param {string} text
 * @returns {{ totalWithBreaks: number, withoutBreaks: number, withoutSpacesAndBreaks: number, lines: number, manuscriptPages: number }}
 */
export function computeCharCounts(text) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  const lines = normalized === '' ? 1 : normalized.split('\n').length;
  const withoutBreaksStr = normalized.replace(/\n/g, '');
  const withoutSpacesStr = withoutBreaksStr.replace(/[ \t\u3000]/g, '');
  const totalWithBreaks = countCodePoints(normalized);
  const withoutBreaks = countCodePoints(withoutBreaksStr);
  const withoutSpacesAndBreaks = countCodePoints(withoutSpacesStr);
  const manuscriptPages = Math.ceil(withoutBreaks / 400) || (withoutBreaks > 0 ? 1 : 0);

  return {
    totalWithBreaks,
    withoutBreaks,
    withoutSpacesAndBreaks,
    lines,
    manuscriptPages,
  };
}

/**
 * 半角英数字を全角英数字に変換する
 * @param {string} str
 * @returns {string}
 */
export function toFullWidthAlnum(str) {
  return str.replace(/[A-Za-z0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

/**
 * 全角英数字を半角英数字に変換する
 * @param {string} str
 * @returns {string}
 */
export function toHalfWidthAlnum(str) {
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const HALFWIDTH_KANA_MAP = {
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
  '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・', 'ｰ': 'ー',
  'ﾞ': '゛', 'ﾟ': '゜',
};

const DAKUTEN_MAP = {
  'ｶ': 'ガ', 'ｷ': 'ギ', 'ｸ': 'グ', 'ｹ': 'ゲ', 'ｺ': 'ゴ',
  'ｻ': 'ザ', 'ｼ': 'ジ', 'ｽ': 'ズ', 'ｾ': 'ゼ', 'ｿ': 'ゾ',
  'ﾀ': 'ダ', 'ﾁ': 'ヂ', 'ﾂ': 'ヅ', 'ﾃ': 'デ', 'ﾄ': 'ド',
  'ﾊ': 'バ', 'ﾋ': 'ビ', 'ﾌ': 'ブ', 'ﾍ': 'ベ', 'ﾎ': 'ボ',
  'ｳ': 'ヴ',
};

const HANDAKUTEN_MAP = {
  'ﾊ': 'パ', 'ﾋ': 'ピ', 'ﾌ': 'プ', 'ﾍ': 'ペ', 'ﾎ': 'ポ',
};

/**
 * 半角カタカナ（濁点・半濁点含む）を全角カタカナへ変換する
 * @param {string} str
 * @returns {string}
 */
export function halfKanaToFullKana(str) {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const next = str[i + 1];
    if (next === 'ﾞ' && DAKUTEN_MAP[ch]) {
      result += DAKUTEN_MAP[ch];
      i++;
    } else if (next === 'ﾟ' && HANDAKUTEN_MAP[ch]) {
      result += HANDAKUTEN_MAP[ch];
      i++;
    } else {
      result += HALFWIDTH_KANA_MAP[ch] ?? ch;
    }
  }
  return result;
}

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 算用数字列を漢数字表記（簡易位取り・または単純置換）へ変換する
 * @param {string} numStr
 * @returns {string}
 */
export function arabicToKanjiSimple(numStr) {
  const half = toHalfWidthAlnum(numStr);
  const n = Number(half);
  if (!Number.isInteger(n) || n < 0 || n >= 10000) {
    return half.replace(/[0-9]/g, (d) => KANJI_DIGITS[Number(d)]);
  }
  if (n === 0) return '〇';
  if (n < 10) return KANJI_DIGITS[n];
  if (n >= 10 && n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens === 1 ? '' : KANJI_DIGITS[tens]}十${ones === 0 ? '' : KANJI_DIGITS[ones]}`;
  }
  if (n >= 100 && n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rem = n % 100;
    const remStr = rem === 0 ? '' : arabicToKanjiSimple(String(rem));
    return `${hundreds === 1 ? '' : KANJI_DIGITS[hundreds]}百${remStr}`;
  }
  const thousands = Math.floor(n / 1000);
  const rem = n % 1000;
  const remStr = rem === 0 ? '' : arabicToKanjiSimple(String(rem));
  return `${thousands === 1 ? '' : KANJI_DIGITS[thousands]}千${remStr}`;
}

/**
 * 漢数字・算用数字を正規化した数値文字列（可能な範囲）に変換する
 * @param {string} token
 * @returns {number | null}
 */
export function parseJapaneseNumberValue(token) {
  const half = toHalfWidthAlnum(token).replace(/,/g, '');
  if (/^\d+$/.test(half)) {
    return Number(half);
  }
  const simpleMap = {
    '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '二十': 20, '三十': 30, '四十': 40, '五十': 50,
    '百': 100, '千': 1000,
  };
  if (Object.prototype.hasOwnProperty.call(simpleMap, token)) {
    return simpleMap[token];
  }
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(token)) {
    const parts = token.split('十');
    const tens = parts[0] ? simpleMap[parts[0]] : 1;
    const ones = parts[1] ? simpleMap[parts[1]] : 0;
    return tens * 10 + ones;
  }
  return null;
}

/**
 * 改行コードを LF (\n) に正規化する
 * @param {string} text
 * @returns {string}
 */
export function normalizeLineEndings(text) {
  return String(text).replace(/\r\n|\r/g, '\n');
}

/**
 * 一意なIDを生成する
 * @param {string} prefix
 * @returns {string}
 */
export function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 正規表現に一致するすべての箇所をコールバックに渡す（無限ループ防止付き）
 * @param {string} text
 * @param {RegExp} regex
 * @param {(match: RegExpExecArray) => void} callback
 */
export function forEachMatch(text, regex, callback) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let match;
  while ((match = re.exec(text)) !== null) {
    callback(match);
    if (match[0].length === 0) {
      re.lastIndex++;
    }
  }
}

/**
 * 前後の文脈スニペットを生成する
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {number} contextChars
 * @returns {{ before: string, target: string, after: string }}
 */
export function extractContextSnippet(text, start, end, contextChars = 16) {
  const beforeStart = Math.max(0, start - contextChars);
  const afterEnd = Math.min(text.length, end + contextChars);
  const before = text.slice(beforeStart, start).replace(/\n/g, '↵');
  const target = text.slice(start, end).replace(/\n/g, '↵');
  const after = text.slice(end, afterEnd).replace(/\n/g, '↵');
  return {
    before: (beforeStart > 0 ? '…' : '') + before,
    target,
    after: after + (afterEnd < text.length ? '…' : ''),
  };
}
