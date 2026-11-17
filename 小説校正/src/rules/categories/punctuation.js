import { forEachMatch } from '../../utils/textUtils.js';

const PREFERRED_DASH_LABEL = {
  '―': '― (U+2015 ホリゾンタルバー)',
  '—': '— (U+2014 EMダッシュ)',
};

/**
 * 1. 約物・記号カテゴリの校正ルール群
 */
export const punctuationRules = [
  {
    id: 'punct.ellipsis-even',
    name: '三点リーダーの偶数個使用',
    category: 'punctuation',
    description: '三点リーダー（… / ⋯）の連続数が奇数（1個や3個など）になっている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { requireEven: true },
    optionSchema: [
      { key: 'requireEven', label: '2個単位の偶数個を要求する', type: 'boolean' },
    ],
    check(ctx, opts) {
      if (!opts.requireEven) return [];
      const issues = [];
      forEachMatch(ctx.text, /[…⋯]+/g, (m) => {
        const len = m[0].length;
        if (len % 2 !== 0) {
          const ch = m[0][0];
          const evenUp = ch.repeat(len + 1);
          const suggestions = [{ label: `${evenUp}（${len + 1}個）にする`, replacement: evenUp }];
          if (len >= 3) {
            const evenDown = ch.repeat(len - 1);
            suggestions.push({ label: `${evenDown}（${len - 1}個）にする`, replacement: evenDown });
          }
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + len,
              message: `三点リーダーが奇数個（${len}個）です。組版慣例では偶数個（2個など）を使用します。`,
              suggestions,
            })
          );
        }
      });
      return issues;
    },
  },
  {
    id: 'punct.dash-even',
    name: 'ダッシュの偶数個使用',
    category: 'punctuation',
    description: 'ダッシュ（― / —）の連続数が奇数になっている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { requireEven: true },
    optionSchema: [
      { key: 'requireEven', label: '2個単位の偶数個を要求する', type: 'boolean' },
    ],
    check(ctx, opts) {
      if (!opts.requireEven) return [];
      const issues = [];
      forEachMatch(ctx.text, /[―—]+/g, (m) => {
        const len = m[0].length;
        if (len % 2 !== 0) {
          const ch = m[0][0];
          const evenUp = ch.repeat(len + 1);
          const suggestions = [{ label: `${evenUp}（${len + 1}個）にする`, replacement: evenUp }];
          if (len >= 3) {
            const evenDown = ch.repeat(len - 1);
            suggestions.push({ label: `${evenDown}（${len - 1}個）にする`, replacement: evenDown });
          }
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + len,
              message: `ダッシュが奇数個（${len}個）です。小説組版では通常2個（――）などの偶数個を使用します。`,
              suggestions,
            })
          );
        }
      });
      return issues;
    },
  },
  {
    id: 'punct.ellipsis-sub',
    name: '三点リーダーの代用表記',
    category: 'punctuation',
    description: '「・・・」「･･･」「...」「。。。」など三点リーダーの代用表記を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '…' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '変換先のリーダー文字',
        type: 'select',
        choices: [
          { value: '…', label: '… (U+2026)' },
          { value: '⋯', label: '⋯ (U+22EF)' },
        ],
      },
    ],
    check(ctx, opts) {
      const target = (opts.preferredChar || '…').repeat(2);
      const issues = [];
      forEachMatch(ctx.text, /(?:[・･]{3,}|\.{3,}|．{2,})/g, (m) => {
        // URL内ピリオド連続はほぼないが念のため確認
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `三点リーダーの代用表記「${m[0]}」が使われています。`,
            suggestions: [{ label: `「${target}」に置換`, replacement: target }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.dash-sub',
    name: 'ダッシュの代用表記',
    category: 'punctuation',
    description: '「──」（罫線）、「ーー」（長音連続）、「--」（ハイフン連続）などの代用ダッシュを検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '―' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '変換先のダッシュ文字',
        type: 'select',
        choices: [
          { value: '―', label: '― (U+2015)' },
          { value: '—', label: '— (U+2014)' },
        ],
      },
    ],
    check(ctx, opts) {
      const target = (opts.preferredChar || '―').repeat(2);
      const issues = [];
      forEachMatch(ctx.text, /(?:[─━]{2,}|ー{2,}|-{2,})/g, (m) => {
        // HTMLコメント <!-- --> 内を除外
        const before = ctx.text.slice(Math.max(0, m.index - 2), m.index);
        const after = ctx.text.slice(m.index + m[0].length, m.index + m[0].length + 1);
        if (before.endsWith('<!') || after === '>') return;

        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `ダッシュの代用表記「${m[0]}」が使われています。`,
            suggestions: [{ label: `「${target}」に置換`, replacement: target }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.ellipsis-mix',
    name: '三点リーダーの異体字混在',
    category: 'punctuation',
    description: '標準の三点リーダー「…」(U+2026) と中線三点「⋯」(U+22EF) の混在を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '…' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '統一する文字',
        type: 'select',
        choices: [
          { value: '…', label: '… (U+2026 標準)' },
          { value: '⋯', label: '⋯ (U+22EF 中線)' },
        ],
      },
    ],
    check(ctx, opts) {
      const preferred = opts.preferredChar || '…';
      const other = preferred === '…' ? '⋯' : '…';
      if (!ctx.text.includes(preferred) && !ctx.text.includes(other)) return [];
      const hasBoth = ctx.text.includes('…') && ctx.text.includes('⋯');
      if (!hasBoth && !ctx.text.includes(other)) return [];

      const issues = [];
      forEachMatch(ctx.text, new RegExp(`${other}+`, 'g'), (m) => {
        const rep = preferred.repeat(m[0].length);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: hasBoth
              ? `三点リーダーの異体字（… と ⋯）が混在しています。`
              : `設定された標準文字「${preferred}」と異なる三点リーダー「${other}」が使われています。`,
            suggestions: [{ label: `「${rep}」に統一`, replacement: rep }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.dash-mix',
    name: 'ダッシュの文字種混在',
    category: 'punctuation',
    description: 'ダッシュ類（― U+2015 / — U+2014 / ─ U+2500 / ━ U+2501）の混在を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '―' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '統一するダッシュ文字',
        type: 'select',
        choices: [
          { value: '―', label: PREFERRED_DASH_LABEL['―'] },
          { value: '—', label: PREFERRED_DASH_LABEL['—'] },
        ],
      },
    ],
    check(ctx, opts) {
      const preferred = opts.preferredChar || '―';
      const variants = ['―', '—', '─', '━'].filter((c) => c !== preferred);
      const re = new RegExp(`[${variants.join('')}]+`, 'g');
      const issues = [];
      forEachMatch(ctx.text, re, (m) => {
        const rep = preferred.repeat(m[0].length);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `ダッシュ文字種「${m[0][0]}」が使用されています（標準設定: 「${preferred}」）。`,
            suggestions: [{ label: `「${rep}」に統一`, replacement: rep }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.period-comma-width',
    name: '句読点の全角・半角混在',
    category: 'punctuation',
    description: '和文中の全角ピリオド・カンマ（．，）や半角（.,）と標準句読点（。、）の混在を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { style: 'japanese' },
    optionSchema: [
      {
        key: 'style',
        label: '標準の句読点スタイル',
        type: 'select',
        choices: [
          { value: 'japanese', label: '「。」と「、」（小説標準）' },
          { value: 'mixed-ten-period', label: '「。」と「，」' },
          { value: 'fullwidth-western', label: '「．」と「，」' },
        ],
      },
    ],
    check(ctx, opts) {
      const issues = [];
      const style = opts.style || 'japanese';
      const targetPeriod = style === 'fullwidth-western' ? '．' : '。';
      const targetComma = style === 'japanese' ? '、' : '，';

      // 和文文字に隣接する「．，.,」またはスタイル外の句読点を検出（URL・小数点を除外）
      forEachMatch(ctx.text, /[。、．，.,]/g, (m) => {
        const ch = m[0];
        const idx = m.index;
        const prev = idx > 0 ? ctx.text[idx - 1] : '';
        const next = idx + 1 < ctx.text.length ? ctx.text[idx + 1] : '';

        // 英数字に挟まれたドット・カンマ（3.14, 1,000, example.com）は除外
        if ((ch === '.' || ch === ',') && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) {
          return;
        }
        // 半角の文脈（英字の直後のカンマ/ピリオド+スペース/英字）は除外
        if ((ch === '.' || ch === ',') && /[A-Za-z0-9]/.test(prev) && (!next || /[ \nA-Za-z0-9]/.test(next))) {
          return;
        }
        // 連続ピリオド ... は ellipsis-sub で扱う
        if (ch === '.' && (prev === '.' || next === '.')) return;
        if (ch === '．' && (prev === '．' || next === '．')) return;

        const isPeriodFamily = ch === '。' || ch === '．' || ch === '.';
        const expected = isPeriodFamily ? targetPeriod : targetComma;

        if (ch !== expected) {
          // 半角 . , は前後に日本語文字がある場合のみ検出
          if ((ch === '.' || ch === ',') && !(/[\u3040-\u30FF\u4E00-\u9FFF「」『』]/.test(prev) || /[\u3040-\u30FF\u4E00-\u9FFF「」『』]/.test(next))) {
            return;
          }
          issues.push(
            ctx.createIssue({
              start: idx,
              end: idx + 1,
              message: `句読点「${ch}」が標準形式（「${expected}」）と異なっています。`,
              suggestions: [{ label: `「${expected}」に置換`, replacement: expected }],
            })
          );
        }
      });
      return issues;
    },
  },
  {
    id: 'punct.question-exclaim-width',
    name: '疑問符・感嘆符の全角・半角混在',
    category: 'punctuation',
    description: '半角の「?」「!」が使用されている箇所を検出し、全角「？」「！」への修正を提案します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { preferredWidth: 'full' },
    optionSchema: [
      {
        key: 'preferredWidth',
        label: '統一する文字幅',
        type: 'select',
        choices: [
          { value: 'full', label: '全角（？！）' },
          { value: 'half', label: '半角（?!）' },
        ],
      },
    ],
    check(ctx, opts) {
      const issues = [];
      const full = (opts.preferredWidth || 'full') === 'full';
      const re = full ? /[?!]+/g : /[？！]+/g;

      forEachMatch(ctx.text, re, (m) => {
        // URL内のクエリパラメータ (?key=val) は除外
        const around = ctx.text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20);
        if (/https?:\/\/[^\s]+/.test(around)) return;

        const rep = m[0]
          .replace(/\?/g, '？')
          .replace(/!/g, '！')
          .replace(/？/g, full ? '？' : '?')
          .replace(/！/g, full ? '！' : '!');

        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: full
              ? `半角の疑問符・感嘆符「${m[0]}」が使用されています。`
              : `全角の疑問符・感嘆符「${m[0]}」が使用されています。`,
            suggestions: [{ label: `「${rep}」に置換`, replacement: rep }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.wave-dash-mix',
    name: '波ダッシュの文字種混在',
    category: 'punctuation',
    description: '「〜」(U+301C) と全角チルダ「～」(U+FF5E) の混在を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredChar: '〜' },
    optionSchema: [
      {
        key: 'preferredChar',
        label: '統一する波ダッシュ文字',
        type: 'select',
        choices: [
          { value: '〜', label: '〜 (U+301C 波ダッシュ)' },
          { value: '～', label: '～ (U+FF5E 全角チルダ)' },
        ],
      },
    ],
    check(ctx, opts) {
      const preferred = opts.preferredChar || '〜';
      const other = preferred === '〜' ? '～' : '〜';
      const issues = [];
      forEachMatch(ctx.text, new RegExp(other, 'g'), (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 1,
            message: `波ダッシュ「${other}」が使われています（標準設定: 「${preferred}」）。混在に注意してください。`,
            suggestions: [{ label: `「${preferred}」に置換`, replacement: preferred }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.nakaguro-width',
    name: '中黒の全角・半角混在',
    category: 'punctuation',
    description: '半角中黒「･」を検出し、全角中黒「・」への修正を提案します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /･+/g, (m) => {
        const rep = '・'.repeat(m[0].length);
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: '半角の中黒「･」が使われています。',
            suggestions: [{ label: `「${rep}」に置換`, replacement: rep }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.consecutive',
    name: '句読点の連続・不自然な組合せ',
    category: 'punctuation',
    description: '「。。」「、、」「、。」「。、」などの重複・不自然な句読点の連続を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[。、]{2,}/g, (m) => {
        const first = m[0][0];
        const last = m[0][m[0].length - 1];
        const suggestions = [{ label: `「${first}」1文字にする`, replacement: first }];
        if (first !== last) {
          suggestions.push({ label: `「${last}」1文字にする`, replacement: last });
        }
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `句読点が連続しています（「${m[0]}」）。`,
            suggestions,
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.question-exclaim-order',
    name: '疑問符・感嘆符の並び順不統一',
    category: 'punctuation',
    description: '「！？」「？！」や「⁉」「⁈」の順序不統一を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredOrder: '！？' },
    optionSchema: [
      {
        key: 'preferredOrder',
        label: '統一する組合せ',
        type: 'select',
        choices: [
          { value: '！？', label: '！？（感嘆符＋疑問符）' },
          { value: '？！', label: '？！（疑問符＋感嘆符）' },
          { value: '⁉', label: '⁉（1文字合字 U+2049）' },
          { value: '⁈', label: '⁈（1文字合字 U+2048）' },
        ],
      },
    ],
    check(ctx, opts) {
      const preferred = opts.preferredOrder || '！？';
      const patterns = ['！？', '？！', '⁉', '⁈', '!?', '?!'].filter((p) => p !== preferred);
      const re = new RegExp(patterns.map((p) => p.replace(/[?!]/g, '\\$&')).join('|'), 'g');
      const issues = [];
      forEachMatch(ctx.text, re, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `感嘆符と疑問符の表記「${m[0]}」が設定形式（「${preferred}」）と異なっています。`,
            suggestions: [{ label: `「${preferred}」に統一`, replacement: preferred }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.question-exclaim-space',
    name: '疑問符・感嘆符の直後の全角空白',
    category: 'punctuation',
    description: '文中の「？」「！」の直後の全角空白の有無（文末や閉じ括弧直前を除く）を検査します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { spacePolicy: 'require' },
    optionSchema: [
      {
        key: 'spacePolicy',
        label: '直後の空白ルール',
        type: 'select',
        choices: [
          { value: 'require', label: '直後に全角空白「　」を入れる（小説標準）' },
          { value: 'forbid', label: '直後に空白を入れない' },
        ],
      },
    ],
    check(ctx, opts) {
      const policy = opts.spacePolicy || 'require';
      const issues = [];
      // 閉じ括弧・句読点・同じ記号・改行の直前でない「？」「！」を検索
      forEachMatch(ctx.text, /([？！⁉⁈]+)(?![？！⁉⁈\n」』）)】］〉》"'\s　])/g, (m) => {
        if (policy !== 'require') return;
        const end = m.index + m[0].length;
        const nextChar = ctx.text[end];
        if (!nextChar) return;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end,
            message: `「${m[0]}」の直後に全角空白がありません。小説組版では文中に1文字アキを入れるのが一般的です。`,
            suggestions: [{ label: `「${m[0]}　」にする`, replacement: `${m[0]}　` }],
          })
        );
      });

      if (policy === 'forbid') {
        forEachMatch(ctx.text, /([？！⁉⁈]+)[　 ]+/g, (m) => {
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `「${m[1]}」の直後に空白があります。`,
              suggestions: [{ label: '直後の空白を削除', replacement: m[1] }],
            })
          );
        });
      }
      return issues;
    },
  },
  {
    id: 'punct.question-exclaim-multi-space',
    name: '疑問符・感嘆符直後の過剰な空白',
    category: 'punctuation',
    description: '「？」「！」の直後に空白が2文字以上続いている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /([？！⁉⁈]+)([　 ]{2,})/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `「${m[1]}」の直後に空白が2文字以上続いています。`,
            suggestions: [
              { label: `全角空白1文字（「${m[1]}　」）にする`, replacement: `${m[1]}　` },
              { label: '空白をすべて削除', replacement: m[1] },
            ],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.line-start-punct',
    name: '行頭の句読点',
    category: 'punctuation',
    description: '行頭（改行直後）に句読点「。」「、」が置かれている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        const m = /^[ 　]*([。、．，])/.exec(line.text);
        if (m) {
          const offset = line.start + m[0].length - 1;
          issues.push(
            ctx.createIssue({
              start: offset,
              end: offset + 1,
              message: `行頭に句読点「${m[1]}」があります（禁則処理違反・誤改行の可能性）。`,
              suggestions: [{ label: `行頭の「${m[1]}」を削除`, replacement: '' }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'punct.line-start-close-bracket',
    name: '行頭の閉じ括弧',
    category: 'punctuation',
    description: '行頭に閉じ括弧（「」のうちの」や』、）など）が単独で置かれている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        const m = /^([」』）)】］〉》〕｝])/.exec(line.text);
        if (m) {
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: line.start + 1,
              message: `行頭に閉じ括弧「${m[1]}」があります。不要な改行の可能性があります。`,
              suggestions: [],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'punct.line-end-open-bracket',
    name: '行末の開き括弧',
    category: 'punctuation',
    description: '行末が開き括弧（「『（など）で終わっている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        const m = /([「『（(【［〈《〔｛])$/.exec(line.text);
        if (m) {
          const idx = line.end - 1;
          issues.push(
            ctx.createIssue({
              start: idx,
              end: line.end,
              message: `行末が開き括弧「${m[1]}」で終わっています。改行位置を確認してください。`,
              suggestions: [],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'punct.space-before-punct',
    name: '句読点の直前の空白',
    category: 'punctuation',
    description: '句読点「。」「、」の直前に全角・半角空白が入っている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /([　 ]+)([。、．，])/g, (m) => {
        // 行頭の空白＋句読点は line-start-punct で扱うため除外
        if (m.index === 0 || ctx.text[m.index - 1] === '\n') return;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `句読点「${m[2]}」の直前に不要な空白があります。`,
            suggestions: [{ label: '直前の空白を削除', replacement: m[2] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.unnatural-space',
    name: '約物の前後の不自然な空白',
    category: 'punctuation',
    description: '中黒「・」や三点リーダー「…」、ダッシュ「―」の前後に不自然な空白が入っていないか検査します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /(?:[　 ]+・|・[　 ]+)/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: '中黒「・」の前後に不自然な空白があります。',
            suggestions: [{ label: '空白を削除して「・」にする', replacement: '・' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'punct.excessive-repeat',
    name: '同一記号の過剰な連続',
    category: 'punctuation',
    description: '「！！！」「？？？」など同一記号の過剰な連続を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxRepeat: 2 },
    optionSchema: [
      { key: 'maxRepeat', label: '許容する最大連続数', type: 'number', min: 1, max: 10 },
    ],
    check(ctx, opts) {
      const maxRepeat = Math.max(1, Number(opts.maxRepeat ?? 2));
      const issues = [];
      forEachMatch(ctx.text, /([！!？?・〜～])\1+/g, (m) => {
        if (m[0].length > maxRepeat) {
          const reduced = m[1].repeat(maxRepeat);
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `記号「${m[1]}」が${m[0].length}回連続しています（許容上限: ${maxRepeat}回）。`,
              suggestions: [{ label: `「${reduced}」に短縮`, replacement: reduced }],
            })
          );
        }
      });
      return issues;
    },
  },
];
