import { DEFAULT_DISPLAY_SETTINGS } from '../config/constants.js';
import { escapeHtml } from '../utils/textUtils.js';
import { createModal } from './modalHelper.js';

/**
 * 表示設定・テーマ・フォント・文字サイズ・行間・ショートカット一覧モーダル
 */
export class DisplayModal {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {import('../services/ShortcutManager.js').ShortcutManager} deps.shortcuts
   */
  constructor({ store, shortcuts }) {
    this.store = store;
    this.shortcuts = shortcuts;

    this.modal = createModal({
      id: 'display-modal',
      title: '表示設定・ショートカット',
      sizeClass: 'modal--md',
      onOpen: () => this.render(),
    });

    this.modal.footerEl.innerHTML = `
      <button type="button" class="btn btn-ghost" id="btn-reset-display">標準に戻す</button>
      <div class="spacer"></div>
      <button type="button" class="btn btn-primary" id="btn-close-display">閉じる</button>
    `;

    this._bindEvents();
  }

  open() {
    this.modal.open();
  }

  _bindEvents() {
    this.modal.footerEl.querySelector('#btn-reset-display').addEventListener('click', () => {
      this.store.updateDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS });
      this.render();
    });
    this.modal.footerEl.querySelector('#btn-close-display').addEventListener('click', () => {
      this.modal.close();
    });

    this.modal.bodyEl.addEventListener('change', (e) => {
      const target = e.target;
      if (target.name === 'writingMode') {
        this.store.updateDisplaySettings({ writingMode: target.value });
      } else if (target.name === 'theme') {
        this.store.updateDisplaySettings({ theme: target.value });
      } else if (target.id === 'disp-font-family') {
        this.store.updateDisplaySettings({ fontFamily: target.value });
      } else if (target.id === 'disp-sync-scroll') {
        this.store.updateDisplaySettings({ syncScroll: target.checked });
      }
    });

    this.modal.bodyEl.addEventListener('input', (e) => {
      const target = e.target;
      if (target.id === 'disp-font-size') {
        const val = Number(target.value);
        this.modal.bodyEl.querySelector('#disp-font-size-val').textContent = `${val}px`;
        this.store.updateDisplaySettings({ fontSize: val });
      } else if (target.id === 'disp-line-height') {
        const val = Number(target.value);
        this.modal.bodyEl.querySelector('#disp-line-height-val').textContent = val.toFixed(2);
        this.store.updateDisplaySettings({ lineHeight: val });
      }
    });
  }

  render() {
    const d = this.store.state.displaySettings;
    const shortcutRows = this.shortcuts
      .getList()
      .map(
        (s) =>
          `<tr><td><kbd>${escapeHtml(s.combo)}</kbd></td><td>${escapeHtml(s.description)}</td></tr>`
      )
      .join('');

    this.modal.bodyEl.innerHTML = `
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">組版方向（画面分割）</label>
          <div class="radio-group">
            <label class="radio-pill">
              <input type="radio" name="writingMode" value="horizontal" ${d.writingMode === 'horizontal' ? 'checked' : ''} />
              <span>横書き（左右分割）</span>
            </label>
            <label class="radio-pill">
              <input type="radio" name="writingMode" value="vertical" ${d.writingMode === 'vertical' ? 'checked' : ''} />
              <span>縦書き（上下分割）</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">テーマ</label>
          <div class="radio-group">
            <label class="radio-pill">
              <input type="radio" name="theme" value="light" ${d.theme === 'light' ? 'checked' : ''} />
              <span>ライト</span>
            </label>
            <label class="radio-pill">
              <input type="radio" name="theme" value="dark" ${d.theme === 'dark' ? 'checked' : ''} />
              <span>ダーク</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="disp-font-family">原稿フォント</label>
          <select id="disp-font-family">
            <option value="serif" ${d.fontFamily === 'serif' ? 'selected' : ''}>明朝体（小説向け標準）</option>
            <option value="sans" ${d.fontFamily === 'sans' ? 'selected' : ''}>ゴシック体（視認性重視）</option>
            <option value="mono" ${d.fontFamily === 'mono' ? 'selected' : ''}>等幅フォント（文字幅均一）</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="disp-font-size">文字サイズ: <strong id="disp-font-size-val">${d.fontSize}px</strong></label>
          <input type="range" id="disp-font-size" min="13" max="26" step="1" value="${d.fontSize}" />
        </div>

        <div class="form-group">
          <label class="form-label" for="disp-line-height">行間: <strong id="disp-line-height-val">${Number(d.lineHeight).toFixed(2)}</strong></label>
          <input type="range" id="disp-line-height" min="1.4" max="2.6" step="0.05" value="${d.lineHeight}" />
        </div>

        <div class="form-group">
          <label class="check-label">
            <input type="checkbox" id="disp-sync-scroll" ${d.syncScroll ? 'checked' : ''} />
            <span>編集領域と校正領域のスクロールを同期する</span>
          </label>
        </div>
      </div>

      <div class="shortcuts-section">
        <h3 class="sub-heading">キーボードショートカット</h3>
        <table class="shortcuts-table">
          <tbody>${shortcutRows}</tbody>
        </table>
      </div>
    `;
  }
}
