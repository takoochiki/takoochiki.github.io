import {
  arabicToKanjiSimple,
  forEachMatch,
  halfKanaToFullKana,
  parseJapaneseNumberValue,
  toFullWidthAlnum,
  toHalfWidthAlnum,
} from '../../utils/textUtils.js';

const URL_OR_EMAIL_RE = /(?:https?:\/\/[^\s　」』）)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const VERTICAL_COMPAT_MAP = {
  '︵': '（', '︶': '）', '︷': '｛', '︸': '｝', '︹': '〔', '︺': '〕',
  '︻': '【', '︼': '】', '︽': '《', '︾': '》', '︿': '〈', '﹀': '〉',
  '﹁': '「', '﹂': '」', '﹃': '『', '﹄': '』', '︐': '、', '︒': '。',
  '︱': '―', '︙': '…',
};

/**
 * 範囲が URL / メールアドレス内に含まれるか判定する
 */
function buildUrlRanges(text) {
  const ranges = [];
  forEachMatch(text, URL_OR_EMAIL_RE, (m) => {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  });
  return ranges;
}

function isInRanges(ranges, start, end) {
  return ranges.some((r) => start >= r.start && end <= r.end);
}

/**
 * 4. 文字種・縦書きカテゴリの校正ルール群
 */
export const characterRules = [
  {
    id: 'char.halfwidth-alnum',
    name: '半角英数字の出現',
    category: 'characters',
    description: '和文中の半角英数字を検出します（縦書き組版や全角統一の確認用）。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { onlyInVertical: false, ignoreTwoDigits: false },
    optionSchema: [
      { key: 'onlyInVertical', label: '縦書き表示時のみ警告する', type: 'boolean' },
      { key: 'ignoreTwoDigits', label: '2桁以下の半角数字を縦中横候補として除外する', type: 'boolean' },
    ],
    check(ctx, opts) {
      if (opts.onlyInVertical && ctx.display.writingMode !== 'vertical') return [];
      const urlRanges = buildUrlRanges(ctx.text);
      const issues = [];
      forEachMatch(ctx.text, /[A-Za-z0-9]+/g, (m) => {
        const start = m.index;
        const end = start + m[0].length;
        if (isInRanges(urlRanges, start, end)) return;
        if (opts.ignoreTwoDigits && /^\d{1,2}$/.test(m[0])) return;

        const full = toFullWidthAlnum(m[0]);
        const suggestions = [{ label: `全角「${full}」に変換`, replacement: full }];
        if (/^\d+$/.test(m[0])) {
          const kanji = arabicToKanjiSimple(m[0]);
          suggestions.push({ label: `漢数字「${kanji}」に変換`, replacement: kanji });
        }
        issues.push(
          ctx.createIssue({
            start,
            end,
            message: `半角英数字「${m[0]}」が使用されています。`,
            suggestions,
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.fullwidth-alnum',
    name: '全角英数字の出現',
    category: 'characters',
    description: '全角英数字（Ａ〜Ｚ、０〜９）の出現を検出します（半角統一ルール用）。',
    defaultSeverity: 'warning',
    defaultEnabled: false,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[Ａ-Ｚａ-ｚ０-９]+/g, (m) => {
        const half = toHalfWidthAlnum(m[0]);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `全角英数字「${m[0]}」が使用されています。`,
            suggestions: [{ label: `半角「${half}」に変換`, replacement: half }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.alnum-width-mix',
    name: '全角・半角英数字の混在',
    category: 'characters',
    description: '同一原稿内に全角英数字と半角英数字が混在している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const urlRanges = buildUrlRanges(ctx.text);
      const halfMatches = [];
      const fullMatches = [];

      forEachMatch(ctx.text, /[A-Za-z0-9]+/g, (m) => {
        if (!isInRanges(urlRanges, m.index, m.index + m[0].length)) {
          halfMatches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        }
      });
      forEachMatch(ctx.text, /[Ａ-Ｚａ-ｚ０-９]+/g, (m) => {
        fullMatches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      });

      if (halfMatches.length === 0 || fullMatches.length === 0) return [];

      // 少数派側を指摘する
      const issues = [];
      const markFull = fullMatches.length <= halfMatches.length;
      const targets = markFull ? fullMatches : halfMatches;

      for (const item of targets) {
        const rep = markFull ? toHalfWidthAlnum(item.text) : toFullWidthAlnum(item.text);
        issues.push(
          ctx.createIssue({
            start: item.start,
            end: item.end,
            message: `原稿内で全角英数字と半角英数字が混在しています（全角:${fullMatches.length}件 / 半角:${halfMatches.length}件）。`,
            suggestions: [{ label: `「${rep}」に統一`, replacement: rep }],
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'char.halfwidth-kana',
    name: '半角カタカナの出現',
    category: 'characters',
    description: '半角カタカナ（ｱｲｳｴｵ等）の混入を検出し、全角カタカナへの変換を提案します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[\uFF66-\uFF9F]+/g, (m) => {
        const full = halfKanaToFullKana(m[0]);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `半角カタカナ「${m[0]}」が使われています。`,
            suggestions: [{ label: `全角「${full}」に変換`, replacement: full }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.number-kanji-arabic-mix',
    name: '数字の漢数字・算用数字の混在',
    category: 'characters',
    description: '作品全体で漢数字と算用数字が混在している場合に通知します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const urlRanges = buildUrlRanges(ctx.text);
      const arabic = [];
      const kanji = [];

      forEachMatch(ctx.text, /[0-9０-９]+/g, (m) => {
        if (!isInRanges(urlRanges, m.index, m.index + m[0].length)) {
          arabic.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        }
      });

      // 数量・時刻・序数などで使われやすい漢数字（熟語中の「一人」等を避けつつ助数詞・時刻と結びつく漢数字も対象）
      forEachMatch(ctx.text, /[〇一二三四五六七八九十百千万億]+(?=[時分秒日ヶ月年間回番章話人つ個本枚回軒])/g, (m) => {
        kanji.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      });

      if (arabic.length === 0 || kanji.length === 0) return [];

      const issues = [];
      // 少数派側を指摘
      const markArabic = arabic.length <= kanji.length;
      const targets = markArabic ? arabic : kanji;
      for (const item of targets.slice(0, 30)) {
        const suggestions = markArabic
          ? [{ label: `漢数字「${arabicToKanjiSimple(item.text)}」に変換`, replacement: arabicToKanjiSimple(item.text) }]
          : [];
        issues.push(
          ctx.createIssue({
            start: item.start,
            end: item.end,
            message: `原稿内で算用数字（${arabic.length}箇所）と漢数字（${kanji.length}箇所）が混在しています。`,
            suggestions,
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'char.same-number-variant',
    name: '同じ数値の表記揺れ',
    category: 'characters',
    description: '同じ数値に対して「10」「１０」「十」など複数の表記が混在している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const urlRanges = buildUrlRanges(ctx.text);
      const byValue = new Map();

      const addToken = (val, token, start, end) => {
        if (val === null) return;
        if (!byValue.has(val)) byValue.set(val, []);
        byValue.get(val).push({ token, start, end });
      };

      forEachMatch(ctx.text, /[0-9０-９]+/g, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + m[0].length)) return;
        addToken(parseJapaneseNumberValue(m[0]), m[0], m.index, m.index + m[0].length);
      });

      forEachMatch(ctx.text, /[〇一二三四五六七八九十百千]+(?=[時分秒日ヶ月年間回番章話人つ個本枚])/g, (m) => {
        addToken(parseJapaneseNumberValue(m[0]), m[0], m.index, m.index + m[0].length);
      });

      const issues = [];
      for (const [val, items] of byValue.entries()) {
        const forms = [...new Set(items.map((i) => i.token))];
        if (forms.length <= 1) continue;
        for (const item of items) {
          const alts = forms.filter((f) => f !== item.token);
          issues.push(
            ctx.createIssue({
              start: item.start,
              end: item.end,
              message: `同じ数値（${val}）に複数の表記（${forms.join(' / ')}）が混在しています。`,
              suggestions: alts.map((alt) => ({ label: `「${alt}」に統一`, replacement: alt })),
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'char.number-unit-space',
    name: '数字と単位の間の空白',
    category: 'characters',
    description: '「10 km」「3 人」のように数字と単位の間に空白が入っている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      const units = '(?:mm|cm|m|km|mg|g|kg|ml|l|Hz|kHz|MHz|px|pt|%|％|円|人|つ|個|本|枚|冊|回|度|倍|年|月|日|時|分|秒|章|話|階|ｍ|ｋｍ|ｇ|ｋｇ)';
      const re = new RegExp(`([0-9０-９一二三四五六七八九十百千万億]+)([ 　]+)(${units})`, 'g');
      forEachMatch(ctx.text, re, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `数字と単位の間に空白があります（「${m[0]}」）。`,
            suggestions: [{ label: `空白を削除して「${m[1]}${m[3]}」にする`, replacement: `${m[1]}${m[3]}` }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.number-comma',
    name: '数字の桁区切りの有無不統一',
    category: 'characters',
    description: '4桁以上の算用数字でカンマ区切り（1,000 と 1000）が混在している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const urlRanges = buildUrlRanges(ctx.text);
      const withComma = [];
      const withoutComma = [];

      forEachMatch(ctx.text, /\b\d{1,3}(?:,\d{3})+\b/g, (m) => {
        if (!isInRanges(urlRanges, m.index, m.index + m[0].length)) {
          withComma.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
        }
      });

      forEachMatch(ctx.text, /\b\d{4,}\b/g, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + m[0].length)) return;
        // 年号っぽい「2025年」などは除外
        const next = ctx.text[m.index + m[0].length];
        if (next === '年') return;
        withoutComma.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      });

      if (withComma.length === 0 || withoutComma.length === 0) return [];
      const issues = [];
      for (const item of withoutComma) {
        const formatted = Number(item.text).toLocaleString('en-US');
        issues.push(
          ctx.createIssue({
            start: item.start,
            end: item.end,
            message: '4桁以上の数値で桁区切りカンマの有無が混在しています。',
            suggestions: [{ label: `「${formatted}」にする`, replacement: formatted }],
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'char.tcy-digits',
    name: '縦中横の確認対象（2〜3桁以上の半角数字）',
    category: 'characters',
    description: '縦書き時の縦中横（または漢数字・全角化）の要否を確認するため、2桁以上の半角数字を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { minDigits: 2, onlyInVertical: false },
    optionSchema: [
      { key: 'minDigits', label: '検出する最小桁数', type: 'number', min: 2, max: 6 },
      { key: 'onlyInVertical', label: '縦書き表示時のみ検出する', type: 'boolean' },
    ],
    check(ctx, opts) {
      if (opts.onlyInVertical && ctx.display.writingMode !== 'vertical') return [];
      const minDigits = Math.max(2, Number(opts.minDigits ?? 2));
      const urlRanges = buildUrlRanges(ctx.text);
      const issues = [];
      const re = new RegExp(`\\d{${minDigits},}`, 'g');
      forEachMatch(ctx.text, re, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + m[0].length)) return;
        const kanji = arabicToKanjiSimple(m[0]);
        const full = toFullWidthAlnum(m[0]);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `${m[0].length}桁の半角数字「${m[0]}」があります（縦書きでは縦中横・漢数字・全角化の検討対象）。`,
            suggestions: [
              { label: `漢数字「${kanji}」に変換`, replacement: kanji },
              { label: `全角「${full}」に変換`, replacement: full },
            ],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.long-latin',
    name: '長い欧文文字列の検出',
    category: 'characters',
    description: '縦書き時に横倒しになりやすい長い英単語・欧文列を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { minLength: 8 },
    optionSchema: [
      { key: 'minLength', label: '警告する最小文字数', type: 'number', min: 3, max: 50 },
    ],
    check(ctx, opts) {
      const minLen = Math.max(3, Number(opts.minLength ?? 8));
      const urlRanges = buildUrlRanges(ctx.text);
      const issues = [];
      forEachMatch(ctx.text, /[A-Za-z][A-Za-z0-9\-_]{2,}/g, (m) => {
        if (m[0].length < minLen) return;
        if (isInRanges(urlRanges, m.index, m.index + m[0].length)) return;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `${m[0].length}文字の長い欧文文字列「${m[0]}」が含まれています（縦書き時の体裁を確認してください）。`,
            suggestions: [],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.url-email',
    name: 'URL・メールアドレスの検出',
    category: 'characters',
    description: '原稿本文中の URL やメールアドレスを検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, URL_OR_EMAIL_RE, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `URLまたはメールアドレス（${m[0]}）が含まれています。本文中に意図せず残っていないか確認してください。`,
            suggestions: [],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.hyphen-mix',
    name: 'ハイフン類の混在',
    category: 'characters',
    description: '半角ハイフン（-）、Unicodeハイフン（‐）、マイナス（−）等の混在を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '‐' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '統一するハイフン文字',
        type: 'select',
        choices: [
          { value: '‐', label: '‐ (U+2010 全角ハイフン)' },
          { value: '-', label: '- (U+002D 半角ハイフン)' },
          { value: '−', label: '− (U+2212 全角マイナス)' },
        ],
      },
    ],
    check(ctx, opts) {
      const urlRanges = buildUrlRanges(ctx.text);
      const foundChars = new Set();
      const matches = [];
      forEachMatch(ctx.text, /[-‐−–]/g, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + 1)) return;
        // -- ダッシュ代用は除外
        const prev = ctx.text[m.index - 1];
        const next = ctx.text[m.index + 1];
        if (m[0] === '-' && (prev === '-' || next === '-')) return;
        foundChars.add(m[0]);
        matches.push({ start: m.index, end: m.index + 1, ch: m[0] });
      });
      if (foundChars.size <= 1) return [];
      const preferred = opts.preferredChar || '‐';
      const issues = [];
      for (const m of matches) {
        if (m.ch !== preferred) {
          issues.push(
            ctx.createIssue({
              start: m.start,
              end: m.end,
              message: `ハイフン類（${[...foundChars].join(' / ')}）が混在しています。`,
              suggestions: [{ label: `「${preferred}」に統一`, replacement: preferred }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'char.slash-width-mix',
    name: 'スラッシュの全角・半角混在',
    category: 'characters',
    description: '半角スラッシュ「/」と全角スラッシュ「／」の混在を検出します（URL内を除く）。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '／' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '統一するスラッシュ',
        type: 'select',
        choices: [
          { value: '／', label: '／（全角）' },
          { value: '/', label: '/（半角）' },
        ],
      },
    ],
    check(ctx, opts) {
      const urlRanges = buildUrlRanges(ctx.text);
      const half = [];
      const full = [];
      forEachMatch(ctx.text, /[\/／]/g, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + 1)) return;
        // 編集用コメント // は除外
        if (m[0] === '/' && (ctx.text[m.index + 1] === '/' || ctx.text[m.index - 1] === '/')) return;
        if (m[0] === '/') half.push(m.index);
        else full.push(m.index);
      });
      if (half.length === 0 || full.length === 0) return [];
      const preferred = opts.preferredChar || '／';
      const targets = preferred === '／' ? half : full;
      return targets.map((idx) =>
        ctx.createIssue({
          start: idx,
          end: idx + 1,
          message: 'スラッシュの全角「／」と半角「/」が混在しています。',
          suggestions: [{ label: `「${preferred}」に統一`, replacement: preferred }],
        })
      );
    },
  },
  {
    id: 'char.paren-width-mix',
    name: '括弧の全角・半角混在',
    category: 'characters',
    description: '半角丸括弧「()」が使用されている箇所を検出し、全角「（）」への変換を提案します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const urlRanges = buildUrlRanges(ctx.text);
      const issues = [];
      forEachMatch(ctx.text, /[()]/g, (m) => {
        if (isInRanges(urlRanges, m.index, m.index + 1)) return;
        const full = m[0] === '(' ? '（' : '）';
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: `半角括弧「${m[0]}」が使われています。和文中では全角括弧「${full}」を推奨します。`,
            suggestions: [{ label: `全角「${full}」に変換`, replacement: full }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.emoji',
    name: '絵文字の出現',
    category: 'characters',
    description: '原稿内の絵文字（Unicode Emoji）を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /\p{Extended_Pictographic}/gu, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `絵文字「${m[0]}」が含まれています。商業誌・組版用途では使用できない場合があります。`,
            suggestions: [{ label: '絵文字を削除', replacement: '' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.control-char',
    name: 'Unicode制御文字の混入',
    category: 'characters',
    description: '改行・タブ以外の不可視な制御文字（U+0000〜U+001F, U+007F 等）を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, (m) => {
        const hex = m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: `制御文字（U+${hex}）が混入しています。`,
            suggestions: [{ label: '制御文字を削除', replacement: '' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.zero-width',
    name: '不可視文字（ゼロ幅スペース等）の混入',
    category: 'characters',
    description: 'ゼロ幅スペース（U+200B〜U+200D）やワードジョイナー（U+2060）、ソフトハイフン（U+00AD）等を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[\u200B-\u200F\u202A-\u202E\u2060\u00AD]/g, (m) => {
        const hex = m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: `不可視文字（U+${hex}）が混入しています。検索や組版の不具合原因になります。`,
            suggestions: [{ label: '不可視文字を削除', replacement: '' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.bom',
    name: 'BOM（バイトオーダーマーク）の混入',
    category: 'characters',
    description: 'U+FEFF（BOM）がテキスト内に残っている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /\uFEFF/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: 'BOM（U+FEFF）が原稿内に含まれています。',
            suggestions: [{ label: 'BOMを削除', replacement: '' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.unicode-norm',
    name: 'Unicode正規化形式（NFC・NFD）の不統一',
    category: 'characters',
    description: '濁点・半濁点が結合文字として分離しているNFD文字（が＝か+\u3099 等）を検出し、NFC正規化を提案します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[^\u3099\u309A][\u3099\u309A]+/g, (m) => {
        const nfc = m[0].normalize('NFC');
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `結合濁点/半濁点によるNFD形式の文字「${m[0]}」が含まれています。`,
            suggestions: [{ label: `NFC形式「${nfc}」に正規化`, replacement: nfc }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'char.vertical-compat',
    name: '縦組用互換文字の混入',
    category: 'characters',
    description: '縦組み専用の互換文字（︵ ︶ ﹁ ﹂ ︱ 等）が直接入力されている箇所を検出し、標準文字への変換を提案します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const chars = Object.keys(VERTICAL_COMPAT_MAP).join('');
      const re = new RegExp(`[${chars}]`, 'g');
      const issues = [];
      forEachMatch(ctx.text, re, (m) => {
        const std = VERTICAL_COMPAT_MAP[m[0]];
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: `縦組用互換文字「${m[0]}」が使われています。通常の組版では自動縦回転される標準文字「${std}」を使用します。`,
            suggestions: [{ label: `標準文字「${std}」に変換`, replacement: std }],
          })
        );
      });
      return issues;
    },
  },
];
