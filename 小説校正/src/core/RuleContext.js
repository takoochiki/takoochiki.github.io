import { forEachMatch, normalizeLineEndings } from '../utils/textUtils.js';

const DIALOGUE_START_RE = /^[「『（(“"'≪《]/;
const HEADING_RE = /^(?:第[一二三四五六七八九十百千0-9０-９]+[章話部節編幕]|序章|終章|プロローグ|エピローグ|#+[ 　]+.*|[0-9０-９]+[．.][ 　]+.*)$/;
const SCENE_BREAK_RE = /^[＊*◇◆○●◎□■☆★※\-―ー＝=・･　 ]{1,20}$/;
const SCENE_SYMBOL_RE = /[＊*◇◆○●◎□■☆★※]/;

/**
 * 1回の校正パスで各ルールが共有する事前解析済みコンテキスト。
 * 行構造・段落・ルビ・会話文・UTF-16オフセットの行/列変換をキャッシュして高速化する。
 */
export class RuleContext {
  /**
   * @param {string} text - エディタ上の正規化済みテキスト
   * @param {object} config
   * @param {string} [config.rawText] - ファイル読込時の生の改行コードを含む文字列
   * @param {any[]} [config.variantGroups] - 表記揺れ辞書
   * @param {Record<string, any>} [config.display] - 表示設定（縦書き/横書き等）
   * @param {Record<string, any>} [config.allSettings] - ルール設定全体
   * @param {import('./IgnoreManager.js').IgnoreManager | null} [config.ignoreManager] - 無視状態マネージャー
   */
  constructor(text, config = {}) {
    this.text = normalizeLineEndings(text);
    this.rawText = typeof config.rawText === 'string' ? config.rawText : this.text;
    this.variantGroups = Array.isArray(config.variantGroups) ? config.variantGroups : [];
    this.display = config.display || {};
    this.allSettings = config.allSettings || {};
    this.ignoreManager = config.ignoreManager || null;

    this.lines = this._parseLines(this.text);
    this.paragraphs = this._parseParagraphs(this.lines);
    this.rubyTokens = this._parseRubyTokens(this.text);
    this.aozoraNoteRanges = this._parseAozoraNotes(this.text);
  }

  /**
   * テキストを行単位に分解し、開始/終了 UTF-16 オフセットと行種別を付与する
   * @param {string} text
   */
  _parseLines(text) {
    const lines = [];
    let offset = 0;
    let lineNumber = 1;
    const rawLines = text.split('\n');

    for (let i = 0; i < rawLines.length; i++) {
      const lineText = rawLines[i];
      const start = offset;
      const end = start + lineText.length;
      const trimmed = lineText.replace(/^[ \t\u3000]+|[ \t\u3000]+$/g, '');
      const isBlank = trimmed.length === 0;
      const isDialogue = !isBlank && DIALOGUE_START_RE.test(trimmed);
      const isHeading = !isBlank && HEADING_RE.test(trimmed);
      const isSceneBreak =
        !isBlank &&
        !isHeading &&
        SCENE_BREAK_RE.test(trimmed) &&
        SCENE_SYMBOL_RE.test(trimmed);

      lines.push({
        lineNumber,
        index: i,
        text: lineText,
        trimmed,
        start,
        end,
        isBlank,
        isDialogue,
        isHeading,
        isSceneBreak,
      });

      offset = end + 1; // '\n' 分
      lineNumber++;
    }
    return lines;
  }

  /**
   * 連続する非空行ブロックを段落として抽出する
   * @param {any[]} lines
   */
  _parseParagraphs(lines) {
    const paragraphs = [];
    let current = null;

    for (const line of lines) {
      if (line.isBlank) {
        if (current) {
          paragraphs.push(current);
          current = null;
        }
        continue;
      }
      if (!current) {
        current = {
          lines: [line],
          start: line.start,
          end: line.end,
          text: line.text,
          startLine: line.lineNumber,
          endLine: line.lineNumber,
        };
      } else {
        current.lines.push(line);
        current.end = line.end;
        current.text += '\n' + line.text;
        current.endLine = line.lineNumber;
      }
    }
    if (current) {
      paragraphs.push(current);
    }
    return paragraphs;
  }

  /**
   * 青空文庫形式のルビトークンを抽出する
   * @param {string} text
   */
  _parseRubyTokens(text) {
    const tokens = [];
    const seen = new Set();

    // 明示的親文字: ｜親文字《ルビ》
    forEachMatch(text, /｜([^\n｜《》]+)《([^\n《》]*)》/g, (m) => {
      const key = `${m.index}:${m[0].length}`;
      seen.add(key);
      tokens.push({
        explicit: true,
        base: m[1],
        reading: m[2],
        start: m.index,
        end: m.index + m[0].length,
        readingStart: m.index + 1 + m[1].length + 1,
        readingEnd: m.index + m[0].length - 1,
      });
    });

    // 漢字連続の暗黙ルビ: 漢字《ルビ》
    forEachMatch(text, /([一-龠々ヶ〆〇]+)《([^\n《》]*)》/g, (m) => {
      const start = m.index;
      // 直前が '｜' の場合は既に明示的親文字として収集済み
      if (start > 0 && text[start - 1] === '｜') return;
      // 既に明示ルビに含まれていればスキップ
      if (tokens.some((t) => start >= t.start && start < t.end)) return;
      tokens.push({
        explicit: false,
        base: m[1],
        reading: m[2],
        start,
        end: start + m[0].length,
        readingStart: start + m[1].length + 1,
        readingEnd: start + m[0].length - 1,
      });
    });

    tokens.sort((a, b) => a.start - b.start);
    return tokens;
  }

  /**
   * 青空文庫注記範囲 ［＃...］ を抽出する
   * @param {string} text
   */
  _parseAozoraNotes(text) {
    const ranges = [];
    forEachMatch(text, /［＃[^\n］]*］/g, (m) => {
      ranges.push({ start: m.index, end: m.index + m[0].length });
    });
    return ranges;
  }

  /**
   * UTF-16 オフセットから 1始まりの { line, column } を二分探索で返す
   * @param {number} offset
   * @returns {{ line: number, column: number }}
   */
  getLineAndCol(offset) {
    const lines = this.lines;
    if (lines.length === 0) return { line: 1, column: 1 };
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const l = lines[mid];
      if (offset < l.start) {
        hi = mid - 1;
      } else if (offset > l.end) {
        lo = mid + 1;
      } else {
        return { line: l.lineNumber, column: offset - l.start + 1 };
      }
    }
    const last = lines[lines.length - 1];
    return { line: last.lineNumber, column: Math.max(1, offset - last.start + 1) };
  }

  /**
   * 指定範囲がルビ内部（《...》や｜）または注記内部に重なるか判定する
   * @param {number} start
   * @param {number} end
   * @returns {boolean}
   */
  isInsideRubyReading(start, end) {
    return this.rubyTokens.some((t) => start >= t.readingStart - 1 && end <= t.readingEnd + 1);
  }

  /**
   * 指定位置が注記タグ内か判定する
   * @param {number} start
   * @param {number} end
   * @returns {boolean}
   */
  isInsideNote(start, end) {
    return this.aozoraNoteRanges.some((r) => start >= r.start && end <= r.end);
  }

  /**
   * ルールが指摘オブジェクトを生成するための標準ファクトリ
   * @param {object} params
   */
  createIssue({
    start,
    end,
    message,
    suggestions = [],
    severityOverride,
    ruleIdOverride,
    ruleNameOverride,
    extra,
  }) {
    const safeStart = Math.max(0, Math.min(start, this.text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, this.text.length));
    const { line, column } = this.getLineAndCol(safeStart);
    return {
      start: safeStart,
      end: safeEnd,
      line,
      column,
      message,
      matchedText: this.text.slice(safeStart, safeEnd),
      suggestions,
      severityOverride,
      ruleIdOverride,
      ruleNameOverride,
      extra,
    };
  }
}
