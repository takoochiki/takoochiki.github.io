/**
 * 原稿の Undo / Redo を統一管理する履歴マネージャー
 * 通常入力の自動マージと、個別修正・一括置換の単一トランザクション対応を兼ね備える。
 */
export class HistoryManager {
  /**
   * @param {string} initialText
   * @param {number} maxEntries
   */
  constructor(initialText = '', maxEntries = 200) {
    this.maxEntries = maxEntries;
    this.mergeWindowMs = 900;
    /** @type {{ text: string, selectionStart: number, selectionEnd: number, source: string, label: string, timestamp: number }[]} */
    this.undoStack = [];
    /** @type {{ text: string, selectionStart: number, selectionEnd: number, source: string, label: string, timestamp: number }[]} */
    this.redoStack = [];
    this.current = {
      text: initialText,
      selectionStart: 0,
      selectionEnd: 0,
      source: 'init',
      label: '初期状態',
      timestamp: Date.now(),
    };
  }

  /**
   * 履歴を初期化する
   * @param {string} text
   */
  reset(text = '') {
    this.undoStack = [];
    this.redoStack = [];
    this.current = {
      text,
      selectionStart: 0,
      selectionEnd: 0,
      source: 'init',
      label: '初期状態',
      timestamp: Date.now(),
    };
  }

  /**
   * 新しいテキスト変更を記録する
   * @param {string} nextText
   * @param {{ source?: 'typing'|'fix'|'batch'|'paste'|'load', label?: string, selectionStart?: number, selectionEnd?: number, prevSelectionStart?: number, prevSelectionEnd?: number }} meta
   * @returns {boolean} 実際に変更が記録されたか
   */
  record(nextText, meta = {}) {
    if (nextText === this.current.text) {
      return false;
    }

    const now = Date.now();
    const source = meta.source || 'typing';
    const label = meta.label || (source === 'batch' ? '一括置換' : source === 'fix' ? '修正適用' : '編集');

    // 直前の入力操作が短時間内の連続タイピングであれば1ステップに統合する
    const canMergeWithPrev =
      source === 'typing' &&
      this.current.source === 'typing' &&
      this.undoStack.length > 0 &&
      now - this.current.timestamp <= this.mergeWindowMs;

    if (!canMergeWithPrev) {
      this.undoStack.push({
        ...this.current,
        selectionStart: meta.prevSelectionStart ?? this.current.selectionStart,
        selectionEnd: meta.prevSelectionEnd ?? this.current.selectionEnd,
      });
      if (this.undoStack.length > this.maxEntries) {
        this.undoStack.shift();
      }
    }

    this.current = {
      text: nextText,
      selectionStart: meta.selectionStart ?? 0,
      selectionEnd: meta.selectionEnd ?? 0,
      source,
      label,
      timestamp: now,
    };

    this.redoStack = [];
    return true;
  }

  /**
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * 元に戻す
   * @returns {{ text: string, selectionStart: number, selectionEnd: number, label: string } | null}
   */
  undo() {
    if (!this.canUndo()) return null;
    this.redoStack.push({ ...this.current });
    this.current = this.undoStack.pop();
    return { ...this.current };
  }

  /**
   * やり直す
   * @returns {{ text: string, selectionStart: number, selectionEnd: number, label: string } | null}
   */
  redo() {
    if (!this.canRedo()) return null;
    this.undoStack.push({ ...this.current });
    this.current = this.redoStack.pop();
    return { ...this.current };
  }
}
