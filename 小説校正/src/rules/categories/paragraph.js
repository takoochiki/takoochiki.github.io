import { countCodePoints, forEachMatch } from '../../utils/textUtils.js';

const NO_INDENT_LINE_START_RE = /^[　 \t「『（(“"'≪《［＃*＊◇◆○●◎□■☆★※\-―ー＝=#]/;

/**
 * 3. 段落・改行・空白カテゴリの校正ルール群
 */
export const paragraphRules = [
  {
    id: 'para.missing-indent',
    name: '地の文の段落頭の字下げ忘れ',
    category: 'paragraph',
    description: '地の文の段落先頭に全角空白「　」の字下げが入っていない箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { mode: 'paragraph-start' },
    optionSchema: [
      {
        key: 'mode',
        label: '字下げチェックの対象',
        type: 'select',
        choices: [
          { value: 'paragraph-start', label: '段落頭（空行後・会話後・句点改行後）' },
          { value: 'all-narrative', label: 'すべての地の文行' },
        ],
      },
    ],
    check(ctx, opts) {
      const mode = opts.mode || 'paragraph-start';
      const issues = [];

      for (let i = 0; i < ctx.lines.length; i++) {
        const line = ctx.lines[i];
        if (line.isBlank || line.isHeading || line.isSceneBreak || line.isDialogue) continue;
        if (NO_INDENT_LINE_START_RE.test(line.text)) continue;

        let shouldIndent = false;
        if (mode === 'all-narrative') {
          shouldIndent = true;
        } else {
          if (i === 0) {
            shouldIndent = true;
          } else {
            const prev = ctx.lines[i - 1];
            if (
              prev.isBlank ||
              prev.isHeading ||
              prev.isSceneBreak ||
              prev.isDialogue ||
              /[。！？!?…―」』）)]$/.test(prev.trimmed)
            ) {
              shouldIndent = true;
            }
          }
        }

        if (shouldIndent) {
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: Math.min(line.end, line.start + 1),
              message: '地の文の段落頭に全角空白の字下げがありません。',
              suggestions: [
                {
                  label: '行頭に全角空白「　」を挿入',
                  replacement: `　${line.text.slice(0, 1)}`,
                },
              ],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.multi-indent',
    name: '段落頭の過剰な字下げ',
    category: 'paragraph',
    description: '行頭の全角空白が2文字以上連続している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxIndent: 1 },
    optionSchema: [
      { key: 'maxIndent', label: '許容する字下げ文字数', type: 'number', min: 1, max: 4 },
    ],
    check(ctx, opts) {
      const maxIndent = Math.max(1, Number(opts.maxIndent ?? 1));
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank || line.isSceneBreak) continue;
        const m = /^　+/.exec(line.text);
        if (m && m[0].length > maxIndent) {
          const target = '　'.repeat(maxIndent);
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: line.start + m[0].length,
              message: `段落頭の字下げが${m[0].length}文字あります（設定上限: ${maxIndent}文字）。`,
              suggestions: [{ label: `「${target}」(${maxIndent}文字)に修正`, replacement: target }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.halfwidth-indent',
    name: '段落頭の半角空白',
    category: 'paragraph',
    description: '行頭の字下げに半角スペースが使われている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank) continue;
        const m = /^[ ]+/.exec(line.text);
        if (m) {
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: line.start + m[0].length,
              message: '行頭の字下げに半角スペースが使われています。',
              suggestions: [
                { label: '全角空白「　」に置換', replacement: '　' },
                { label: '行頭の半角空白を削除', replacement: '' },
              ],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.tab-char',
    name: 'タブ文字の混入',
    category: 'paragraph',
    description: '原稿内のタブ文字（\\t）を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /\t+/g, (m) => {
        const isLineHead = m.index === 0 || ctx.text[m.index - 1] === '\n';
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: isLineHead ? '行頭にタブ文字が使用されています。' : '行中にタブ文字が混入しています。',
            suggestions: [
              { label: '全角空白「　」に置換', replacement: '　' },
              { label: 'タブ文字を削除', replacement: '' },
            ],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'para.trailing-space',
    name: '行末の不要な空白',
    category: 'paragraph',
    description: '行末に残っている全角・半角空白やタブを検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank) continue;
        const m = /[ \t　]+$/.exec(line.text);
        if (m) {
          const start = line.end - m[0].length;
          issues.push(
            ctx.createIssue({
              start,
              end: line.end,
              message: '行末に不要な空白が残っています。',
              suggestions: [{ label: '行末の空白を削除', replacement: '' }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.inline-half-space',
    name: '行中の不要な半角空白',
    category: 'paragraph',
    description: '和文文字間に半角スペースが紛れ込んでいる箇所を検出します（英文中のスペースは除外）。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      const jpChar = '[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF。、！？「」『』（）]';
      const re = new RegExp(`(${jpChar})( +)(${jpChar})`, 'g');
      forEachMatch(ctx.text, re, (m) => {
        const spaceStart = m.index + m[1].length;
        const spaceEnd = spaceStart + m[2].length;
        issues.push(
          ctx.createIssue({
            start: spaceStart,
            end: spaceEnd,
            message: '日本語文字の間に半角スペースが入っています。',
            suggestions: [
              { label: '半角空白を削除', replacement: '' },
              { label: '全角空白「　」に置換', replacement: '　' },
            ],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'para.inline-multi-full-space',
    name: '行中の全角空白の連続',
    category: 'paragraph',
    description: '行中（字下げ以外）で全角空白が2文字以上連続している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank || line.isSceneBreak) continue;
        forEachMatch(line.text, /　{2,}/g, (m) => {
          if (m.index === 0) return; // 行頭は multi-indent で扱う
          issues.push(
            ctx.createIssue({
              start: line.start + m.index,
              end: line.start + m.index + m[0].length,
              message: `行中で全角空白が${m[0].length}文字連続しています。`,
              suggestions: [
                { label: '全角空白1文字にする', replacement: '　' },
                { label: '空白をすべて削除', replacement: '' },
              ],
            })
          );
        });
      }
      return issues;
    },
  },
  {
    id: 'para.whitespace-only-line',
    name: '空白文字だけの行',
    category: 'paragraph',
    description: '見た目は空行に見えるが空白文字やタブだけが残っている行を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (const line of ctx.lines) {
        if (line.text.length > 0 && /^[ \t　]+$/.test(line.text)) {
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: line.end,
              message: '空白文字のみを含む行です。純粋な空行に整理することを推奨します。',
              suggestions: [{ label: '行内の空白を削除して空行にする', replacement: '' }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.excessive-blank-lines',
    name: '空行の過剰な連続',
    category: 'paragraph',
    description: '空行が設定行数を超えて連続している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxBlankLines: 2 },
    optionSchema: [
      { key: 'maxBlankLines', label: '許容する連続空行数', type: 'number', min: 1, max: 10 },
    ],
    check(ctx, opts) {
      const maxBlank = Math.max(1, Number(opts.maxBlankLines ?? 2));
      const issues = [];
      let runStartLine = null;
      let runCount = 0;

      const flushRun = (lastLineIdx) => {
        if (runCount > maxBlank && runStartLine !== null) {
          const startOffset = ctx.lines[runStartLine].start;
          const endOffset = ctx.lines[lastLineIdx].end;
          const keepNewlines = '\n'.repeat(Math.max(0, maxBlank - 1));
          issues.push(
            ctx.createIssue({
              start: startOffset,
              end: endOffset,
              message: `空行が${runCount}行連続しています（許容上限: ${maxBlank}行）。`,
              suggestions: [{ label: `空行を${maxBlank}行に圧縮`, replacement: keepNewlines }],
            })
          );
        }
        runStartLine = null;
        runCount = 0;
      };

      for (let i = 0; i < ctx.lines.length; i++) {
        if (ctx.lines[i].isBlank) {
          if (runStartLine === null) runStartLine = i;
          runCount++;
        } else {
          flushRun(i - 1);
        }
      }
      flushRun(ctx.lines.length - 1);
      return issues;
    },
  },
  {
    id: 'para.mixed-line-endings',
    name: '改行コード（LF・CRLF・CR）の混在',
    category: 'paragraph',
    description: '読み込んだ原稿内に異なる改行コード（LF / CRLF / CR）が混在している場合に検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const raw = ctx.rawText;
      const hasCRLF = /\r\n/.test(raw);
      const withoutCRLF = raw.replace(/\r\n/g, '');
      const hasLF = /\n/.test(withoutCRLF);
      const hasCR = /\r/.test(withoutCRLF);
      const kindCount = [hasCRLF, hasLF, hasCR].filter(Boolean).length;
      if (kindCount <= 1) return [];

      const kinds = [
        hasCRLF ? 'CRLF' : null,
        hasLF ? 'LF' : null,
        hasCR ? 'CR' : null,
      ].filter(Boolean);

      return [
        ctx.createIssue({
          start: 0,
          end: Math.min(ctx.text.length, 1),
          message: `原稿内で複数の改行コード（${kinds.join(' / ')}）が混在しています。保存時にLFへ統一されます。`,
          suggestions: [],
        }),
      ];
    },
  },
  {
    id: 'para.eof-newline',
    name: 'ファイル末尾の改行の有無',
    category: 'paragraph',
    description: '原稿末尾の改行の有無を規則に合わせて検査します。',
    defaultSeverity: 'warning',
    defaultEnabled: false,
    defaultOptions: { policy: 'require' },
    optionSchema: [
      {
        key: 'policy',
        label: 'ファイル末尾の改行規則',
        type: 'select',
        choices: [
          { value: 'require', label: '末尾に改行を含める' },
          { value: 'forbid', label: '末尾に空行を残さない' },
        ],
      },
    ],
    check(ctx, opts) {
      if (ctx.text.length === 0) return [];
      const policy = opts.policy || 'require';
      if (policy === 'require' && !ctx.text.endsWith('\n')) {
        const end = ctx.text.length;
        return [
          ctx.createIssue({
            start: Math.max(0, end - 1),
            end,
            message: '原稿の末尾に改行がありません。',
            suggestions: [
              { label: '末尾に改行を追加', replacement: `${ctx.text.slice(-1)}\n` },
            ],
          }),
        ];
      }
      if (policy === 'forbid' && ctx.text.endsWith('\n')) {
        const m = /\n+$/.exec(ctx.text);
        if (m) {
          return [
            ctx.createIssue({
              start: ctx.text.length - m[0].length,
              end: ctx.text.length,
              message: '原稿の末尾に余分な改行があります。',
              suggestions: [{ label: '末尾の改行を削除', replacement: '' }],
            }),
          ];
        }
      }
      return [];
    },
  },
  {
    id: 'para.max-length',
    name: '段落の文字数超過',
    category: 'paragraph',
    description: '1段落の文字数が設定上限を超えている箇所を検出します（読みやすさ確認用）。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxChars: 250 },
    optionSchema: [
      { key: 'maxChars', label: '1段落の最大文字数', type: 'number', min: 50, max: 2000 },
    ],
    check(ctx, opts) {
      const maxChars = Math.max(50, Number(opts.maxChars ?? 250));
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank) continue;
        const len = countCodePoints(line.text);
        if (len > maxChars) {
          issues.push(
            ctx.createIssue({
              start: line.start,
              end: Math.min(line.end, line.start + 12),
              message: `この段落は${len}文字あり、設定上限（${maxChars}文字）を超えています。改行して分割することを検討してください。`,
              suggestions: [],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.duplicate-line',
    name: '同一行の連続',
    category: 'paragraph',
    description: 'まったく同じ内容の行が2行連続している箇所を検出します（コピペミスの防止）。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (let i = 1; i < ctx.lines.length; i++) {
        const prev = ctx.lines[i - 1];
        const cur = ctx.lines[i];
        if (cur.isBlank || cur.isSceneBreak) continue;
        if (cur.trimmed.length >= 2 && cur.trimmed === prev.trimmed) {
          issues.push(
            ctx.createIssue({
              start: cur.start,
              end: cur.end,
              message: `直前の行（${prev.lineNumber}行目）とまったく同じ内容が連続しています。`,
              suggestions: [{ label: '重複行を削除', replacement: '' }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.duplicate-paragraph',
    name: '同一段落の連続',
    category: 'paragraph',
    description: '空行で区切られた同じ段落ブロックが連続している箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      for (let i = 1; i < ctx.paragraphs.length; i++) {
        const prev = ctx.paragraphs[i - 1];
        const cur = ctx.paragraphs[i];
        if (cur.lines.length <= 1 && prev.lines.length <= 1) continue; // 単一行は duplicate-line に任せる
        const normPrev = prev.text.trim();
        const normCur = cur.text.trim();
        if (normCur.length >= 4 && normCur === normPrev) {
          issues.push(
            ctx.createIssue({
              start: cur.start,
              end: cur.end,
              message: `直前の段落（${prev.startLine}〜${prev.endLine}行目）と同一内容の段落が連続しています。`,
              suggestions: [{ label: '重複段落を削除', replacement: '' }],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.heading-style',
    name: '章見出しの形式不統一',
    category: 'paragraph',
    description: '「第一章」と「第2章」「第３章」など章見出しの数字形式が作品内で混在している場合に検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { preferredNumberStyle: 'auto' },
    optionSchema: [
      {
        key: 'preferredNumberStyle',
        label: '章見出しの数字形式',
        type: 'select',
        choices: [
          { value: 'auto', label: '最初に出現した形式に統一' },
          { value: 'kanji', label: '漢数字（第一章）に統一' },
          { value: 'half-arabic', label: '半角算用数字（第1章）' },
          { value: 'full-arabic', label: '全角算用数字（第１章）' },
        ],
      },
    ],
    check(ctx, opts) {
      const headings = [];
      for (const line of ctx.lines) {
        const m = /^第([一二三四五六七八九十百千]+|[0-9]+|[０-９]+)([章話部節編幕])/.exec(line.trimmed);
        if (!m) continue;
        let style = 'kanji';
        if (/^[0-9]+$/.test(m[1])) style = 'half-arabic';
        else if (/^[０-９]+$/.test(m[1])) style = 'full-arabic';
        headings.push({ line, numStr: m[1], unit: m[2], style });
      }
      if (headings.length === 0) return [];

      let targetStyle = opts.preferredNumberStyle || 'auto';
      if (targetStyle === 'auto') {
        const styles = new Set(headings.map((h) => h.style));
        if (styles.size <= 1) return [];
        targetStyle = headings[0].style;
      }

      const labelMap = {
        kanji: '漢数字',
        'half-arabic': '半角数字',
        'full-arabic': '全角数字',
      };

      const issues = [];
      for (const h of headings) {
        if (h.style !== targetStyle) {
          issues.push(
            ctx.createIssue({
              start: h.line.start,
              end: h.line.end,
              message: `章見出しの表記形式（${labelMap[h.style]}）が、作品内の統一形式（${labelMap[targetStyle]}）と異なっています。`,
              suggestions: [],
            })
          );
        }
      }
      return issues;
    },
  },
  {
    id: 'para.scene-break-mix',
    name: '場面転換記号の混在',
    category: 'paragraph',
    description: '「＊」「◇」「○」などの場面転換記号が作品内で複数種類使われている場合に検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const breaks = [];
      for (const line of ctx.lines) {
        if (line.isSceneBreak) {
          breaks.push({ line, symbol: line.trimmed });
        }
      }
      const uniqueSymbols = [...new Set(breaks.map((b) => b.symbol))];
      if (uniqueSymbols.length <= 1) return [];

      const primary = breaks[0].symbol;
      const issues = [];
      for (const b of breaks) {
        if (b.symbol !== primary) {
          issues.push(
            ctx.createIssue({
              start: b.line.start,
              end: b.line.end,
              message: `場面転換記号「${b.symbol}」が最初に使用された「${primary}」と異なっています。`,
              suggestions: [{ label: `「${primary}」に統一`, replacement: primary }],
            })
          );
        }
      }
      return issues;
    },
  },
];
