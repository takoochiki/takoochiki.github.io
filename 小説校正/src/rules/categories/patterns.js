import { escapeRegExp, forEachMatch } from '../../utils/textUtils.js';

const DEFAULT_REPEATED_WORDS = [
  '彼は', '彼女は', '私は', '僕は', '俺は', 'それは', 'これは', 'あれは',
  'しかし', 'けれど', 'そして', 'だから', 'つまり',
];

const SENTENCE_ENDING_RE = /(だった|ていた|である|であった|ました|ません|でした|ない|だ|た|る)。$/;

const CONJUNCTION_START_RE = /^(?:[　 ]*)(しかし|だが|けれど|けれども|そして|また|それで|だから|つまり|ところが|もっとも|なお|ちなみに)[、,\s　]/;

/**
 * 6. 単純な文字列パターンカテゴリの校正ルール群
 */
export const patternRules = [
  {
    id: 'pattern.repeated-word',
    name: '同一単語・助詞の重複連続',
    category: 'patterns',
    description: '「彼は彼は」「のの」「がが」など同一語句・助詞の連続出現を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { customWords: '' },
    optionSchema: [
      {
        key: 'customWords',
        label: '追加で検査する単語（カンマ区切り）',
        type: 'text',
        placeholder: '例: 少年は, 剣を',
      },
    ],
    check(ctx, opts) {
      const issues = [];
      // 助詞の同一連続（「のの」「がが」「をを」「にに」「へへ」「でで」「とと」）※「はは(母)」「ここ」「もも」等は誤検出防止のため対象限定
      forEachMatch(ctx.text, /([がをにへでと])\1/g, (m) => {
        // 擬音・語彙の一部（はは、ここ、やや、など）は対象外にしてあるが「がが」等も「がらがら」等と区別するため前後が漢字/仮名の特定ケースを注意
        const prev = m.index > 0 ? ctx.text[m.index - 1] : '';
        const next = ctx.text[m.index + 2] || '';
        if (/[ァ-ヶー]/.test(prev) || /[ァ-ヶー]/.test(next)) return; // カタカナ擬音を除外
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + 2,
            message: `助詞「${m[1]}」が2回連続しています。`,
            suggestions: [{ label: `「${m[1]}」1つにする`, replacement: m[1] }],
          })
        );
      });

      // 「のの」は「小野の」等を誤検出しないよう、ひらがな直後以外または3連続や助詞パターン限定ではなく2-6文字語句反復を優先
      const customList = String(opts.customWords || '')
        .split(/[,、\s]+/)
        .map((w) => w.trim())
        .filter(Boolean);
      const wordList = [...new Set([...DEFAULT_REPEATED_WORDS, ...customList])];

      if (wordList.length > 0) {
        const re = new RegExp(`(${wordList.map(escapeRegExp).join('|')})\\1`, 'g');
        forEachMatch(ctx.text, re, (m) => {
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `同じ語句「${m[1]}」が連続して重複しています。`,
              suggestions: [{ label: `1つ目の重複を削除（「${m[1]}」）`, replacement: m[1] }],
            })
          );
        });
      }

      // 任意の2〜8文字のひらがな・漢字フレーズの直後反復（例：「とてもとても」等を除き、助詞付き反復「雨が雨が」など）
      forEachMatch(ctx.text, /([\u4E00-\u9FFF\u3040-\u309F]{1,5}[はがをにでと])\1/g, (m) => {
        // 既に DEFAULT_REPEATED_WORDS で拾われていたら重複させない
        if (wordList.includes(m[1])) return;
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `語句「${m[1]}」が連続して重複しています。`,
            suggestions: [{ label: `「${m[1]}」1つにする`, replacement: m[1] }],
          })
        );
      });

      return issues;
    },
  },
  {
    id: 'pattern.repeated-char',
    name: '同一文字の異常な連続',
    category: 'patterns',
    description: '同じひらがな・カタカナ・漢字が設定回数以上異常に連続している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { threshold: 5 },
    optionSchema: [
      { key: 'threshold', label: '検出する連続文字数', type: 'number', min: 3, max: 20 },
    ],
    check(ctx, opts) {
      const threshold = Math.max(3, Number(opts.threshold ?? 5));
      const issues = [];
      const re = new RegExp(`([\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FFF])\\1{${threshold - 1},}`, 'g');
      forEachMatch(ctx.text, re, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `文字「${m[1]}」が${m[0].length}回連続しています（タイプミス・長押し入力の可能性があります）。`,
            suggestions: [{ label: `「${m[1]}」1文字にする`, replacement: m[1] }],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'pattern.repeated-sentence',
    name: '同一文の連続',
    category: 'patterns',
    description: 'まったく同じ文が続けて書かれている箇所を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      let prevSentence = '';
      forEachMatch(ctx.text, /([^。！？\n]+[。！？])/g, (m) => {
        const sentence = m[1].trim();
        if (sentence.length >= 4 && sentence === prevSentence) {
          issues.push(
            ctx.createIssue({
              start: m.index,
              end: m.index + m[0].length,
              message: `直前の文と同じ文（「${sentence}」）が連続しています。`,
              suggestions: [{ label: '重複している文を削除', replacement: '' }],
            })
          );
        }
        prevSentence = sentence;
      });
      return issues;
    },
  },
  {
    id: 'pattern.sentence-ending-repeat',
    name: '特定の文末表現の連続',
    category: 'patterns',
    description: '「〜だった。」「〜ていた。」など同じ文末表現が設定回数以上連続した場合に通知します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: { maxConsecutive: 3 },
    optionSchema: [
      { key: 'maxConsecutive', label: '警告する連続文数', type: 'number', min: 2, max: 10 },
    ],
    check(ctx, opts) {
      const threshold = Math.max(2, Number(opts.maxConsecutive ?? 3));
      const issues = [];
      let lastEnding = '';
      let run = [];

      const flushRun = () => {
        if (run.length >= threshold) {
          const lastItem = run[run.length - 1];
          issues.push(
            ctx.createIssue({
              start: lastItem.start,
              end: lastItem.end,
              message: `同じ文末表現「〜${lastEnding}。」が${run.length}文連続しています。単調さを避けるため語尾の変化を検討してください。`,
              suggestions: [],
            })
          );
        }
        run = [];
      };

      forEachMatch(ctx.text, /([^。\n「」『』]+。)/g, (m) => {
        const s = m[1].trim();
        const endMatch = SENTENCE_ENDING_RE.exec(s);
        if (!endMatch) {
          lastEnding = '';
          flushRun();
          return;
        }
        const ending = endMatch[1];
        const endStart = m.index + m[0].length - (ending.length + 1);
        const endEnd = m.index + m[0].length;

        if (ending === lastEnding) {
          run.push({ start: endStart, end: endEnd });
        } else {
          flushRun();
          lastEnding = ending;
          run = [{ start: endStart, end: endEnd }];
        }
      });
      flushRun();
      return issues;
    },
  },
  {
    id: 'pattern.conjunction-repeat',
    name: '特定の接続詞の連続使用',
    category: 'patterns',
    description: '連続する文や行の冒頭で同じ接続詞（「しかし」「そして」等）が続けて使われている箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      let prevConj = '';
      forEachMatch(ctx.text, /([^。！？\n]+[。！？]?)/g, (m) => {
        const segment = m[1];
        const conjMatch = CONJUNCTION_START_RE.exec(segment);
        if (!conjMatch) {
          if (segment.trim().length > 0) prevConj = '';
          return;
        }
        const conj = conjMatch[1];
        const conjOffset = m.index + conjMatch[0].indexOf(conj);
        if (conj === prevConj) {
          issues.push(
            ctx.createIssue({
              start: conjOffset,
              end: conjOffset + conj.length,
              message: `接続詞「${conj}」が連続する文の冒頭で使われています。`,
              suggestions: [],
            })
          );
        }
        prevConj = conj;
      });
      return issues;
    },
  },
  {
    id: 'pattern.forbidden-words',
    name: '禁止語・非推奨語の出現',
    category: 'patterns',
    description: '設定画面で登録した禁止語・非推奨語が原稿内に出現した場合に検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: { words: '' },
    optionSchema: [
      {
        key: 'words',
        label: '禁止語・非推奨語リスト（カンマ区切り）',
        type: 'text',
        placeholder: '例: めっちゃ, 超, っていうか',
      },
    ],
    check(ctx, opts) {
      const words = String(opts.words || '')
        .split(/[,、\n]+/)
        .map((w) => w.trim())
        .filter(Boolean);
      if (words.length === 0) return [];

      const re = new RegExp(words.map(escapeRegExp).join('|'), 'g');
      const issues = [];
      forEachMatch(ctx.text, re, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `禁止語・非推奨語に登録されている「${m[0]}」が出現しました。`,
            suggestions: [],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'pattern.placeholder-text',
    name: '仮置きテキストの残存',
    category: 'patterns',
    description: '「TODO」「FIXME」「XXX」「（仮）」「【仮】」「〇〇」など未完成の仮置きテキスト残存を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      const re = /(?:TODO|FIXME|XXX|WIP|[（(【]仮[）)】]|〇〇|××|△△|□□)/gi;
      forEachMatch(ctx.text, re, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: `仮置きテキスト「${m[0]}」が残っています。本文への確定・削除を確認してください。`,
            suggestions: [],
          })
        );
      });
      return issues;
    },
  },
  {
    id: 'pattern.editor-comment',
    name: '編集用コメント・マーカーの残存',
    category: 'patterns',
    description: '「// ...」「<!-- ... -->」「【注：...】」「※...」などの編集用メモ・コメント残存を検出します。',
    defaultSeverity: 'error',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const issues = [];
      // 行コメント（URLの http:// は除外）
      forEachMatch(ctx.text, /(^|[^:])(\/\/[^\n]*)/gm, (m) => {
        const start = m.index + m[1].length;
        const end = start + m[2].length;
        issues.push(
          ctx.createIssue({
            start,
            end,
            message: '編集用コメント（// ...）が残っています。',
            suggestions: [{ label: 'コメントを削除', replacement: '' }],
          })
        );
      });
      // HTML コメント
      forEachMatch(ctx.text, /<!--[\s\S]*?-->/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: '編集用HTMLコメント（<!-- ... -->）が残っています。',
            suggestions: [{ label: 'コメントを削除', replacement: '' }],
          })
        );
      });
      // 【注：...】など
      forEachMatch(ctx.text, /【注[:：][^】\n]*】/g, (m) => {
        issues.push(
          ctx.createIssue({
            start: m.index,
            end: m.index + m[0].length,
            message: '編集用注記マーカーが残っています。',
            suggestions: [],
          })
        );
      });
      return issues;
    },
  },
];
