import { DEFAULT_LATEX_OPTIONS } from '../config/constants.js';
import { normalizeLineEndings } from '../utils/textUtils.js';

const LATEX_ESCAPE_MAP = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '$': '\\$',
  '&': '\\&',
  '#': '\\#',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

/**
 * LaTeX 組版用のテキスト変換サービス
 * 元の原稿は変更せず、段落改行整形・重複空行防止・特殊文字エスケープ・青空文庫ルビ変換を行う。
 */
export class LatexConverter {
  /**
   * LaTeX 特殊文字をエスケープする
   * @param {string} str
   * @returns {string}
   */
  escapeLatex(str) {
    return str.replace(/[\\{}%$&#_~^]/g, (ch) => LATEX_ESCAPE_MAP[ch]);
  }

  /**
   * ルビ構文を一時プレースホルダに退避しつつ、本文とルビ内を安全にエスケープする
   * @param {string} str
   * @param {object} options
   * @returns {string}
   */
  _processLineText(str, options) {
    const tokens = [];
    let working = str;

    if (options.convertRuby) {
      const pushToken = (base, reading) => {
        const idx = tokens.length;
        const safeBase = options.escapeSpecialChars ? this.escapeLatex(base) : base;
        const safeReading = options.escapeSpecialChars ? this.escapeLatex(reading) : reading;
        const macro = (options.rubyMacroTemplate || '\\ruby{$1}{$2}')
          .replace(/\$1/g, safeBase)
          .replace(/\$2/g, safeReading);
        tokens.push(macro);
        return `\uE000LATEXRUBY${idx}\uE001`;
      };

      // 明示的ルビ ｜親文字《ルビ》
      working = working.replace(/｜([^\n｜《》]+)《([^\n《》]*)》/g, (_, base, reading) =>
        pushToken(base, reading)
      );

      // 暗黙ルビ 漢字《ルビ》
      working = working.replace(/([一-龠々ヶ〆〇]+)《([^\n《》]*)》/g, (_, base, reading) =>
        pushToken(base, reading)
      );
    }

    if (options.escapeSpecialChars) {
      working = this.escapeLatex(working);
    }

    if (tokens.length > 0) {
      working = working.replace(/\uE000LATEXRUBY(\d+)\uE001/g, (_, idx) => tokens[Number(idx)]);
    }

    return working;
  }

  /**
   * 原稿テキストを LaTeX 向けテキストに変換する（非破壊）
   * @param {string} sourceText
   * @param {Partial<typeof DEFAULT_LATEX_OPTIONS>} userOptions
   * @returns {{ output: string, stats: { inputLines: number, outputLines: number, rubyCount: number, blankBlockCount: number } }}
   */
  convert(sourceText, userOptions = {}) {
    const options = { ...DEFAULT_LATEX_OPTIONS, ...userOptions };
    const normalized = normalizeLineEndings(sourceText);
    const rawLines = normalized.split('\n');

    // ルビ変換件数の概算カウント
    let rubyCount = 0;
    if (options.convertRuby) {
      const explicitMatches = normalized.match(/｜[^\n｜《》]+《[^\n《》]*》/g) || [];
      const implicitMatches = normalized.replace(/｜[^\n｜《》]+《[^\n《》]*》/g, '').match(/[一-龠々ヶ〆〇]+《[^\n《》]*》/g) || [];
      rubyCount = explicitMatches.length + implicitMatches.length;
    }

    // 段落ブロックの構築（空行で区切られる行群、または各行を独立段落とするか）
    // 意図的な改行の扱い:
    // - preserve: 原稿の空行を認識し、重複空行を防ぎつつ、単一改行も段落構造として扱うか選択
    // ここでは空行ブロックを単位とし、ブロック内の改行を lineBreakMode に従って処理する
    const blocks = [];
    let currentLines = [];
    let blankRun = 0;
    let blankBlockCount = 0;

    for (const rawLine of rawLines) {
      const isBlank = rawLine.trim() === '';
      if (isBlank) {
        if (currentLines.length > 0) {
          blocks.push({ type: 'text', lines: currentLines, trailingBlanks: 0 });
          currentLines = [];
        }
        blankRun++;
        if (blankRun === 1) {
          blankBlockCount++;
          blocks.push({ type: 'blank', count: 1 });
        } else {
          const last = blocks[blocks.length - 1];
          if (last && last.type === 'blank') {
            last.count++;
          }
        }
      } else {
        blankRun = 0;
        let line = rawLine;
        if (options.indentHandling === 'strip') {
          line = line.replace(/^　+/, '');
        }
        line = this._processLineText(line, options);
        currentLines.push(line);
      }
    }
    if (currentLines.length > 0) {
      blocks.push({ type: 'text', lines: currentLines });
    }

    // 出力の組み立て
    const sep = options.paragraphSeparator === 'par' ? '\n\\par\n' : '\n\n';
    const parts = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'blank') {
        // 既存の空行の重複を防ぐ場合、複数空行は1つの区切りとして吸収する
        if (!options.preventDuplicateBlankLines) {
          const extra = Math.max(0, block.count - 1);
          if (extra > 0) {
            parts.push('\n'.repeat(extra));
          }
        }
        continue;
      }

      if (options.lineBreakMode === 'preserve') {
        // 小説の1行1段落（空行なし）を活かして、各行を段落区切りまたは改行で保持する
        parts.push(block.lines.join(options.paragraphSeparator === 'par' ? '\n\\par\n' : '\n'));
      } else if (options.lineBreakMode === 'backslash') {
        parts.push(block.lines.join('\\\\\n'));
      } else {
        // 'join': ブロック内の意図的な単一改行を結合し、空行でのみ段落を分ける
        parts.push(block.lines.join(''));
      }
    }

    let output = '';
    if (options.lineBreakMode === 'preserve') {
      // ブロック境界ごとに空行または \par を出力（連続重複を防ぐ）
      const textOutputs = [];
      for (const block of blocks) {
        if (block.type === 'text') {
          textOutputs.push(
            block.lines.join(options.paragraphSeparator === 'par' ? '\n\\par\n' : '\n')
          );
        } else if (!options.preventDuplicateBlankLines && textOutputs.length > 0) {
          const extra = block.count;
          textOutputs[textOutputs.length - 1] += '\n'.repeat(extra);
        }
      }
      output = textOutputs.join(sep);
    } else {
      const textBlocks = blocks.filter((b) => b.type === 'text');
      output = textBlocks
        .map((b) => (options.lineBreakMode === 'backslash' ? b.lines.join('\\\\\n') : b.lines.join('')))
        .join(sep);
    }

    return {
      output,
      stats: {
        inputLines: rawLines.length,
        outputLines: output === '' ? 0 : output.split('\n').length,
        rubyCount,
        blankBlockCount,
      },
    };
  }
}
