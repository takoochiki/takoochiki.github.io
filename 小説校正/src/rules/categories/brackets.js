import { forEachMatch } from '../../utils/textUtils.js';

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
  Object.entries(BRACKET_PAIRS).map(([open, close]) => [close, open])
);

const ALL_BRACKET_RE = /[「」『』（）()【】［］〈〉〔〕｛｝“”]/g;

/**
 * 2. 括弧・会話文カテゴリの校正ルール群
 */
export const bracketRules = [
  {
    id: 'bracket.unmatched',
    name: '括弧の開閉数の不一致',
    category: 'brackets',
    description: '閉じられていない開き括弧、または対応する開き括弧がない閉じ括弧を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      const stack = [];

      forEachMatch(ctx.text, ALL_BRACKET_RE, (m) => {
        const ch = m[0];
        const pos = m.index;
        if (BRACKET_PAIRS[ch]) {
          stack.push({ ch, pos });
        } else if (CLOSE_TO_OPEN[ch]) {
          const expectedOpen = CLOSE_TO_OPEN[ch];
          // スタックトップまたは直近一致を探す
          if (stack.length > 0 && stack[stack.length - 1].ch === expectedOpen) {
            stack.pop();
          } else {
            const matchIdx = [...stack].reverse().findIndex((item) => item.ch === expectedOpen);
            if (matchIdx === -1) {
              // スタックに異種括弧がある場合、type-mismatch で扱うか unmatched とする
              if (stack.length === 0) {
                issues.push(
                  ctx.createIssue({
                    start: pos,
                    end: pos + 1,
                    message: `対応する開き括弧「${expectedOpen}」が見つからない閉じ括弧「${ch}」です。`,
                    suggestions: [{ label: `「${ch}」を削除`, replacement: '' }],
                  })
                );
              }
            } else {
              // 間の未閉じをpopして記録
              const actualIdx = stack.length - 1 - matchIdx;
              const unclosed = stack.splice(actualIdx);
              for (let i = 0; i < unclosed.length - 1; i++) {
                const u = unclosed[i];
                issues.push(
                  ctx.createIssue({
                    start: u.pos,
                    end: u.pos + 1,
                    message: `開き括弧「${u.ch}」に対応する閉じ括弧「${BRACKET_PAIRS[u.ch]}」がありません。`,
                    suggestions: [],
                  })
                );
              }
            }
          }
        }
      });

      for (const unclosed of stack) {
        issues.push(
          ctx.createIssue({
            start: unclosed.pos,
            end: unclosed.pos + 1,
            message: `開き括弧「${unclosed.ch}」が閉じられていません。`,
            suggestions: [],
          })
        );
      }
      return issues;
    },
  },
  {
    id: 'bracket.type-mismatch',
    name: '括弧の種類の不一致',
    category: 'brackets',
    description: '「こんにちは』のように開き括弧と閉じ括弧の種類が食い違っている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      const stack = [];

      forEachMatch(ctx.text, ALL_BRACKET_RE, (m) => {
        const ch = m[0];
        const pos = m.index;
        if (BRACKET_PAIRS[ch]) {
          stack.push({ ch, pos });
        } else if (CLOSE_TO_OPEN[ch]) {
          const expectedOpen = CLOSE_TO_OPEN[ch];
          if (stack.length === 0) return;
          const top = stack[stack.length - 1];
          if (top.ch === expectedOpen) {
            stack.pop();
          } else if (!stack.some((s) => s.ch === expectedOpen)) {
            // 直前の開き括弧と種類不一致
            const rightClose = BRACKET_PAIRS[top.ch];
            stack.pop();
            issues.push(
              ctx.createIssue({
                start: pos,
                end: pos + 1,
                message: `開き括弧「${top.ch}」に対して、異なる閉じ括弧「${ch}」が使われています。`,
                suggestions: [{ label: `「${rightClose}」に修正`, replacement: rightClose }],
              })
            );
          }
        }
      });
      return issues;
    },
  },
  {
    id: 'bracket.nesting-invalid',
    name: '括弧の入れ子構造の不整合',
    category: 'brackets',
    description: '括弧の交差や、会話括弧が閉じていないまま次の段落へ跨いでいる不整合を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      // 段落をまたぐ未閉鎖の会話括弧や交差検出
      for (const para of ctx.paragraphs) {
        const stack = [];
        forEachMatch(para.text, /[「」『』（）()]/g, (m) => {
          const ch = m[0];
          const absPos = para.start + m.index;
          if (BRACKET_PAIRS[ch]) {
            stack.push({ ch, pos: absPos });
          } else {
            const exp = CLOSE_TO_OPEN[ch];
            if (stack.length > 0 && stack[stack.length - 1].ch === exp) {
              stack.pop();
            } else if (stack.some((s) => s.ch === exp)) {
              // 交差している（例: 「（」) ）
              issues.push(
                ctx.createIssue({
                  start: absPos,
                  end: absPos + 1,
                  message: `括弧の入れ子構造が交差しています（内側の「${stack[stack.length - 1].ch}」が閉じる前に「${ch}」が来ています）。`,
                  suggestions: [],
                })
              );
              while (stack.length > 0 && stack.pop().ch !== exp) {}
            }
          }
        });
      }
      return issues;
    },
  },
  {
    id: 'bracket.dialogue-end-period',
    name: '会話文末の句点',
    category: 'brackets',
    description: '会話文の閉じ括弧直前の句点（「こんにちは。」）の有無を規則に従って検査します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { policy: 'forbid' },
    optionSchema: [
      {
        key: 'policy',
        label: '会話文末の句点規則',
        type: 'select',
        choices: [
          { value: 'forbid', label: '句点を付けない（日本の小説標準）' },
          { value: 'require', label: '句点を付ける' },
        ],
      },
    ],
    check(ctx, opts) {
      const policy = opts.policy || 'forbid';
      const issues = [];

      if (policy === 'forbid') {
        forEachMatch(ctx.text, /。([」』])/g, (m) => {
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `会話文末の閉じ括弧「${m[1]}」の前に句点「。」があります。`,
              suggestions: [{ label: `句点を削除して「${m[1]}」にする`, replacement: m[1] }],
            })
          );
        });
      } else {
        // policy === 'require'
        forEachMatch(ctx.text, /([^。！？…―\s「『\n])([」』])/g, (m) => {
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `会話文末の閉じ括弧「${m[2]}」の前に句点「。」がありません。`,
              suggestions: [{ label: `「${m[1]}。${m[2]}」にする`, replacement: `${m[1]}。${m[2]}` }],
            })
          );
        });
      }
      return issues;
    },
  },
  {
    id: 'bracket.dialogue-start-space',
    name: '会話文頭の空白',
    category: 'brackets',
    description: '会話文の開き括弧の直後に空白（「　こんにちは」）が入っている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /([「『])[　 \t]+/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `会話括弧「${m[1]}」の直後に不要な空白があります。`,
            suggestions: [{ label: `空白を削除して「${m[1]}」にする`, replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.dialogue-end-space',
    name: '会話文末の空白',
    category: 'brackets',
    description: '会話文の閉じ括弧の直前に空白（「こんにちは　」）が入っている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[　 \t]+([」』])/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `会話括弧「${m[1]}」の直前に不要な空白があります。`,
            suggestions: [{ label: `空白を削除して「${m[1]}」にする`, replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.dialogue-indent',
    name: '会話文行の字下げ',
    category: 'brackets',
    description: '行頭の会話文（「…」）の字下げ（全角空白の有無）を設定規則に従って検査します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { policy: 'no-indent' },
    optionSchema: [
      {
        key: 'policy',
        label: '会話文行の字下げ規則',
        type: 'select',
        choices: [
          { value: 'no-indent', label: '字下げしない（「から始める・標準）' },
          { value: 'indent', label: '全角1文字字下げする（　「から始める）' },
        ],
      },
    ],
    check(ctx, opts) {
      const policy = opts.policy || 'no-indent';
      const issues = [];
      for (const line of ctx.lines) {
        if (line.isBlank) continue;
        if (policy === 'no-indent') {
          const m = /^([　 ]+)([「『])/.exec(line.text);
          if (m) {
            issues.push(
              ctx.createIssue({
                start: line.start,
                end: line.start + m[0].length,
                message: `会話文の行頭に字下げ（空白）が入っています。`,
                suggestions: [{ label: `行頭の空白を削除して「${m[2]}」にする`, replacement: m[2] }],
              })
            );
          }
        } else {
          const m = /^([「『])/.exec(line.text);
          if (m) {
            issues.push(
              ctx.createIssue({
                start: line.start,
                end: line.start + 1,
                message: `会話文の行頭に全角空白の字下げがありません。`,
                suggestions: [{ label: `全角空白を挿入（　${m[1]}）`, replacement: `　${m[1]}` }],
              })
            );
          }
        }
      }
      return issues;
    },
  },
  {
    id: 'bracket.open-after-space',
    name: '開き括弧直後の不要な空白',
    category: 'brackets',
    description: '丸括弧や隅付き括弧などの開き括弧直後の空白（（　など）を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /([（(【［〈〔｛“])[　 \t]+/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `開き括弧「${m[1]}」の直後に不要な空白があります。`,
            suggestions: [{ label: '直後の空白を削除', replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.close-before-space',
    name: '閉じ括弧直前の不要な空白',
    category: 'brackets',
    description: '丸括弧などの閉じ括弧直前の空白（　）など）を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /[　 \t]+([）)】］〉〕｝”])/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `閉じ括弧「${m[1]}」の直前に不要な空白があります。`,
            suggestions: [{ label: '直前の空白を削除', replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.close-after-period',
    name: '閉じ括弧直後の句点',
    category: 'brackets',
    description: '「こんにちは」。のように会話閉じ括弧の直後に句点が付いている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /([」』])。/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `閉じ括弧「${m[1]}」の直後に句点「。」があります。文脈上不要な場合は削除を検討してください。`,
            suggestions: [{ label: `句点を削除して「${m[1]}」にする`, replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.empty',
    name: '空の括弧',
    category: 'brackets',
    description: '中身が空の括弧（「」、『』、（）、() など）を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /(?:「」|『』|（）|\(\)|【】|［］)/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `中身が空の括弧「${m[0]}」があります。`,
            suggestions: [{ label: '空の括弧を削除', replacement: '' }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'bracket.same-type-nesting',
    name: '同種括弧の入れ子',
    category: 'brackets',
    description: '「彼は「はい」と言った」のように同一種類の括弧が入れ子になっている箇所を検出し、『』への変換を提案します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      forEachMatch(ctx.text, /「([^「」\n]*)「([^「」\n]*)」([^「」\n]*)」/g, (m) => {
        const innerStart = m.index + 1 + m[1].length;
        const innerEnd = innerStart + 1 + m[2].length + 1;
        issues.push(
          ctx.createIssue({
            start: innerStart,
            end: innerEnd,
            message: '「」の中に同じ「」が入れ子になっています。内側は二重鉤括弧『』にするのが一般的です。',
            suggestions: [{ label: `『${m[2]}』に変更`, replacement: `『${m[2]}』` }],
          })
        );
      });
      return issues;
    },
  },
];
