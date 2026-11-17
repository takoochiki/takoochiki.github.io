import { countCodePoints, forEachMatch } from '../../utils/textUtils.js';

/**
 * 7. ルビ・特殊記法（青空文庫形式など）カテゴリの校正ルール群
 */
export const rubyRules = [
  {
    id: 'ruby.unmatched-brackets',
    name: 'ルビ括弧《》の開閉不一致',
    category: 'ruby',
    description: '青空文庫形式のルビ括弧「《」と「》」の開閉が対応していない箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      let openPos = null;

      forEachMatch(ctx.text, /[《》]/g, (m) => {
        if (m[0] === '《') {
          if (openPos !== null) {
            issues.push(
              ctx.createIssue({
                start: openPos,
                end: openPos + 1,
                message: 'ルビ括弧「《」が閉じる前に次の「《」が現れました。',
                suggestions: [],
              })
            );
          }
          openPos = m.index;
        } else {
          if (openPos === null) {
            issues.push(
              ctx.createIssue({
                start: m.index,
                end: m.index + 1,
                message: '対応する開き括弧「《」のないルビ閉じ括弧「》」です。',
                suggestions: [],
              })
            );
          } else {
            openPos = null;
          }
        }
      });

      if (openPos !== null) {
        issues.push(
          ctx.createIssue({
            start: openPos,
            end: openPos + 1,
            message: 'ルビ括弧「《」に対応する閉じ括弧「》」がありません。',
            suggestions: [],
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'ruby.empty-reading',
    name: '空のルビ本文（漢字《》）',
    category: 'ruby',
    description: 'ルビ括弧の中身が空（《》）になっている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /(｜?)([^《》\n]*)《》/g, (m) => {
        const isExplicit = m[1] === '｜';
        const fullStart = m.index;
        const fullEnd = m.index + m[0].length;
        const bracketStart = fullEnd - 2;
        const replacement = isExplicit ? m[2] : m[2];
        issues.push(
          ctx.createIssue({
            start: isExplicit ? fullStart : bracketStart,
            end: fullEnd,
            message: 'ルビ本文が空（《》）になっています。',
            suggestions: [
              {
                label: isExplicit ? 'ルビ記法「｜」と「《》」を削除' : '空の「《》」を削除',
                replacement: isExplicit ? replacement : '',
              },
            ],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'ruby.empty-base',
    name: '明示的なルビ親文字が空（｜《よみ》）',
    category: 'ruby',
    description: '「｜《よみ》」のようにルビ開始記号の直後に親文字がなくルビ括弧が続いている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /｜[ 　\t]*《([^《》\n]*)》/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: 'ルビ指定記号「｜」と「《》」の間に親文字がありません。',
            suggestions: [{ label: 'ルビ記法を削除して本文のみにする', replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'ruby.newline-inside',
    name: 'ルビ内の改行',
    category: 'ruby',
    description: 'ルビ括弧《...》の途中に改行が含まれている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /《([^《》]*\n[^《》]*)》/g, (m) => {
        const cleaned = `《${m[1].replace(/\n+/g, '')}》`;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: 'ルビ括弧《》の内部に改行が含まれています。',
            suggestions: [{ label: 'ルビ内の改行を削除', replacement: cleaned }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'ruby.space-inside',
    name: 'ルビ内の不要な空白',
    category: 'ruby',
    description: 'ルビ括弧《...》の前後または内部に空白が入っている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /《([ 　\t]+[^\n《》]*|[^\n《》]*[ 　\t]+)》/g, (m) => {
        const trimmed = m[1].replace(/[ 　\t]+/g, '');
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `ルビ「《${m[1]}》」の中に不要な空白が含まれています。`,
            suggestions: [{ label: `空白を削除して「《${trimmed}》」にする`, replacement: `《${trimmed}》` }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'ruby.max-length',
    name: 'ルビ文字数の超過',
    category: 'ruby',
    description: 'ルビの長さが設定上限を超えている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxLength: 20 },
    optionSchema: [
      { key: 'maxLength', label: 'ルビの最大文字数', type: 'number', min: 5, max: 60 },
    ],
    check(ctx, opts) {
      const maxLength = Math.max(5, Number(opts.maxLength ?? 20));
      const issues = [];
      for (const token of ctx.rubyTokens) {
        const len = countCodePoints(token.reading);
        if (len > maxLength) {
          issues.push(
            ctx.createIssue({
              start: token.start,
              end: token.end,
              message: `ルビ「${token.reading}」が${len}文字あり、設定上限（${maxLength}文字）を超えています。`,
              suggestions: [],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'ruby.inconsistent-reading',
    name: '同一親文字に対するルビの表記揺れ',
    category: 'ruby',
    description: '同じ漢字・親文字に対して作品内で異なるルビ（例：私《わたし》と私《わたくし》）が振られている場合に検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const byBase = new Map();
      for (const token of ctx.rubyTokens) {
        if (!token.reading) continue;
        if (!byBase.has(token.base)) byBase.set(token.base, []);
        byBase.get(token.base).push(token);
      }

      const issues = [];
      for (const [base, tokens] of byBase.entries()) {
        const readings = [...new Set(tokens.map((t) => t.reading))];
        if (readings.length <= 1) continue;

        for (const t of tokens) {
          const alts = readings.filter((r) => r !== t.reading);
          issues.push(
            ctx.createIssue({
              start: t.start,
              end: t.end,
              message: `親文字「${base}」のルビが複数通り（${readings.join(' / ')}）に分かれています。意図的な振り分けか確認してください。`,
              suggestions: alts.map((alt) => ({
                label: `「${t.explicit ? '｜' : ''}${base}《${alt}》」に統一`,
                replacement: `${t.explicit ? '｜' : ''}${base}《${alt}》`,
              })),
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'ruby.mixed-notation',
    name: 'ルビ記法の混在',
    category: 'ruby',
    description: '青空文庫形式（《》）以外の丸括弧ルビ（｜漢字（よみ））や HTML <ruby> タグの出現・混在を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      // 縦棒＋親文字＋全角/半角丸括弧ルビ（カクヨム/小説家になろう等の別記法）
      forEachMatch(ctx.text, /｜([^\n｜《》（()）]+)（([^\n（）]+)）/g, (m) => {
        const aozora = `｜${m[1]}《${m[2]}》`;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `丸括弧形式のルビ記法（${m[0]}）が使われています。青空文庫形式（《》）と混在する可能性があります。`,
            suggestions: [{ label: `青空文庫形式「${aozora}」に変換`, replacement: aozora }],
          })
        );
      });

      // HTML <ruby> タグ
      forEachMatch(ctx.text, /<ruby>([^<\n]+)<rt>([^<\n]+)<\/rt><\/ruby>/gi, (m) => {
        const aozora = `｜${m[1]}《${m[2]}》`;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: 'HTMLの <ruby> タグが含まれています。',
            suggestions: [{ label: `青空文庫形式「${aozora}」に変換`, replacement: aozora }],
          })
        );
      });

      return issues;
    },
  },
  {
    id: 'ruby.aozora-note-unmatched',
    name: '青空文庫注記タグ［＃...］の開閉不一致',
    category: 'ruby',
    description: '青空文庫の注記タグ「［＃」と「］」の開閉が一致していない箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      let openPos = null;
      forEachMatch(ctx.text, /［＃|］/g, (m) => {
        if (m[0] === '［＃') {
          if (openPos !== null) {
            issues.push(
              ctx.createIssue({
                start: openPos,
                end: openPos + 2,
                message: '注記タグ「［＃」が閉じる前に次の「［＃」が始まっています。',
                suggestions: [],
              })
            );
          }
          openPos = m.index;
        } else if (m[0] === '］') {
          if (openPos !== null) {
            openPos = null;
          }
        }
      });
      if (openPos !== null) {
        issues.push(
          ctx.createIssue({
            start: openPos,
            end: openPos + 2,
            message: '注記タグ「［＃」に対応する閉じ括弧「］」がありません。',
            suggestions: [],
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'ruby.unsupported-notation',
    name: '不正または未対応のルビ特殊記法',
    category: 'ruby',
    description: '連続したルビ指定記号「｜｜」や、後ろに《ルビ》が続かない単独「｜」を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      // 連続する縦棒
      forEachMatch(ctx.text, /｜{2,}/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: 'ルビ親文字指定記号「｜」が連続しています。',
            suggestions: [{ label: '「｜」1文字にする', replacement: '｜' }],
          })
        );
      });

      // 行内に《》がないのに「｜」が孤立している（ただし「｜漢字（よみ）」は mixed-notation で扱う）
      for (const line of ctx.lines) {
        forEachMatch(line.text, /｜/g, (m) => {
          const rest = line.text.slice(m.index + 1);
          if (!/^[^\n｜《》]+(?:《[^\n《》]*》|（[^\n（）]+）)/.test(rest)) {
            issues.push(
              ctx.createIssue({
                start: line.start + m.index,
                end: line.start + m.index + 1,
                message: '後ろにルビ《》が続かないルビ指定記号「｜」があります。',
                suggestions: [{ label: '単独の「｜」を削除', replacement: '' }],
              })
            );
          }
        });
      }

      return issues;
    },
  },
];
