/**
 * アプリケーション全体のキーボードショートカット登録・ディスパッチ管理
 */
export class ShortcutManager {
  constructor() {
    /** @type {{ combo: string, description: string, handler: (e: KeyboardEvent) => void, allowInInput?: boolean }[]} */
    this.bindings = [];
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  /**
   * ショートカットを登録する
   * @param {string} combo 例: 'Ctrl+Z', 'Ctrl+Shift+Z', 'Alt+N', 'F8'
   * @param {string} description
   * @param {(e: KeyboardEvent) => void} handler
   * @param {{ allowInInput?: boolean }} [opts]
   */
  register(combo, description, handler, opts = {}) {
    this.bindings.push({
      combo: combo.toLowerCase(),
      displayCombo: combo,
      description,
      handler,
      allowInInput: opts.allowInInput !== false,
    });
  }

  getList() {
    return this.bindings.map((b) => ({
      combo: b.displayCombo,
      description: b.description,
    }));
  }

  attach(target = window) {
    target.addEventListener('keydown', this._onKeyDown);
  }

  detach(target = window) {
    target.removeEventListener('keydown', this._onKeyDown);
  }

  /**
   * @param {KeyboardEvent} e
   */
  _formatEventCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    const key = e.key.toLowerCase();
    if (!['control', 'meta', 'alt', 'shift'].includes(key)) {
      parts.push(key);
    }
    return parts.join('+');
  }

  /**
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    const combo = this._formatEventCombo(e);
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isInput = activeTag === 'input' || activeTag === 'select';

    for (const binding of this.bindings) {
      if (binding.combo === combo) {
        if (isInput && !binding.allowInInput) continue;
        e.preventDefault();
        binding.handler(e);
        return;
      }
    }
  }
}
