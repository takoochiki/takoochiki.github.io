import { LatexConverter } from '../services/LatexConverter.js';
import { escapeHtml } from '../utils/textUtils.js';
import { createModal } from './modalHelper.js';

/**
 * LaTeX 組版用テキスト変換・前後プレビュー・コピー/保存モーダル
 * 元の原稿は変更しない非破壊変換を提供する。
 */
export class LatexModal {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {import('../services/StorageService.js').StorageService} deps.storage
   */
  constructor({ store, storage }) {
    this.store = store;
    this.storage = storage;
    this.converter = new LatexConverter();
    this.latestOutput = '';

    this.modal = createModal({
      id: 'latex-modal',
      title: 'LaTeX 用テキスト変換（原稿は変更されません）',
      sizeClass: 'modal--xl',
      onOpen: () => this.render(),
    });

    this.modal.footerEl.innerHTML = `
      <span id="latex-copy-feedback" class="footer-note"></span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-secondary" id="btn-latex-copy">変換結果をコピー</button>
      <button type="button" class="btn btn-primary" id="btn-latex-download">.tex ファイルを保存</button>
      <button type="button" class="btn btn-ghost" id="btn-latex-close">閉じる</button>
    `;

    this._bindEvents();
  }

  open() {
    this.modal.open();
  }

  _bindEvents() {
    this.modal.footerEl.querySelector('#btn-latex-close').addEventListener('click', () => {
      this.modal.close();
    });

    this.modal.footerEl.querySelector('#btn-latex-copy').addEventListener('click', async () => {
      const fb = this.modal.footerEl.querySelector('#latex-copy-feedback');
      try {
        await navigator.clipboard.writeText(this.latestOutput);
        fb.textContent = 'クリップボードにコピーしました。';
      } catch {
        fb.textContent = 'コピーに失敗しました。プレビュー欄から手動コピーしてください。';
      }
      setTimeout(() => {
        fb.textContent = '';
      }, 3000);
    });

    this.modal.footerEl.querySelector('#btn-latex-download').addEventListener('click', () => {
      const base = (this.store.state.fileName || 'manuscript').replace(/\.[^.]+$/, '');
      this.storage.downloadFile(`${base}.tex`, this.latestOutput, 'application/x-tex;charset=utf-8');
    });

    this.modal.bodyEl.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'paragraphSeparator') {
        this.store.updateLatexOptions({ paragraphSeparator: t.value });
      } else if (t.id === 'ltx-prevent-dup-blanks') {
        this.store.updateLatexOptions({ preventDuplicateBlankLines: t.checked });
      } else if (t.id === 'ltx-linebreak-mode') {
        this.store.updateLatexOptions({ lineBreakMode: t.value });
      } else if (t.id === 'ltx-indent-handling') {
        this.store.updateLatexOptions({ indentHandling: t.value });
      } else if (t.id === 'ltx-escape-chars') {
        this.store.updateLatexOptions({ escapeSpecialChars: t.checked });
      } else if (t.id === 'ltx-convert-ruby') {
        this.store.updateLatexOptions({ convertRuby: t.checked });
      } else if (t.id === 'ltx-macro-preset') {
        if (t.value !== 'custom') {
          this.store.updateLatexOptions({ rubyMacroTemplate: t.value });
          const input = this.modal.bodyEl.querySelector('#ltx-macro-template');
          if (input) input.value = t.value;
        }
      }
      this._updatePreview();
    });

    this.modal.bodyEl.addEventListener('input', (e) => {
      if (e.target.id === 'ltx-macro-template') {
        this.store.updateLatexOptions({ rubyMacroTemplate: e.target.value });
        this._updatePreview();
      }
    });
  }

  render() {
    const opt = this.store.state.latexOptions;

    this.modal.bodyEl.innerHTML = `
      <div class="latex-layout">
        <div class="latex-options">
          <div class="form-group">
            <label class="form-label">段落区切り形式</label>
            <div class="radio-group">
              <label class="radio-pill">
                <input type="radio" name="paragraphSeparator" value="blank-line" ${opt.paragraphSeparator === 'blank-line' ? 'checked' : ''} />
                <span>空行（\\n\\n）</span>
              </label>
              <label class="radio-pill">
                <input type="radio" name="paragraphSeparator" value="par" ${opt.paragraphSeparator === 'par' ? 'checked' : ''} />
                <span>\\par コマンド</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="ltx-linebreak-mode">ブロック内の改行処理</label>
            <select id="ltx-linebreak-mode">
              <option value="preserve" ${opt.lineBreakMode === 'preserve' ? 'selected' : ''}>意図的な改行をそのまま保持する</option>
              <option value="join" ${opt.lineBreakMode === 'join' ? 'selected' : ''}>空行間の単一改行を結合して1段落にする</option>
              <option value="backslash" ${opt.lineBreakMode === 'backslash' ? 'selected' : ''}>段落内改行に \\\\（強制改行）を付与する</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="ltx-indent-handling">行頭の全角空白（字下げ）</label>
            <select id="ltx-indent-handling">
              <option value="strip" ${opt.indentHandling === 'strip' ? 'selected' : ''}>除去する（LaTeX側の \\parindent に任せる）</option>
              <option value="keep" ${opt.indentHandling === 'keep' ? 'selected' : ''}>そのまま残す</option>
            </select>
          </div>

          <div class="form-group">
            <label class="check-label">
              <input type="checkbox" id="ltx-prevent-dup-blanks" ${opt.preventDuplicateBlankLines ? 'checked' : ''} />
              <span>既存の連続空行を正規化し、空行の重複を防ぐ</span>
            </label>
          </div>

          <div class="form-group">
            <label class="check-label">
              <input type="checkbox" id="ltx-escape-chars" ${opt.escapeSpecialChars ? 'checked' : ''} />
              <span>LaTeX特殊文字（\\ { } % $ & # _ ~ ^）をエスケープする</span>
            </label>
          </div>

          <div class="form-group">
            <label class="check-label">
              <input type="checkbox" id="ltx-convert-ruby" ${opt.convertRuby ? 'checked' : ''} />
              <span>青空文庫形式のルビを LaTeX マクロに変換する</span>
            </label>
          </div>

          <div class="form-group">
            <label class="form-label" for="ltx-macro-preset">ルビマクロ書式（$1=親文字, $2=ルビ）</label>
            <select id="ltx-macro-preset">
              <option value="\\ruby{$1}{$2}" ${opt.rubyMacroTemplate === '\\ruby{$1}{$2}' ? 'selected' : ''}>pxrubrica / okurigana 標準: \\ruby{$1}{$2}</option>
              <option value="\\kana{$1}{$2}" ${opt.rubyMacroTemplate === '\\kana{$1}{$2}' ? 'selected' : ''}>jlreq / luatexja: \\kana{$1}{$2}</option>
              <option value="\\furigana{$1}{$2}" ${opt.rubyMacroTemplate === '\\furigana{$1}{$2}' ? 'selected' : ''}>カスタム: \\furigana{$1}{$2}</option>
              <option value="custom">カスタム入力</option>
            </select>
            <input type="text" id="ltx-macro-template" value="${escapeHtml(opt.rubyMacroTemplate)}" placeholder="\\ruby{$1}{$2}" />
          </div>

          <div id="latex-stats-box" class="latex-stats-box"></div>
        </div>

        <div class="latex-preview-panes">
          <div class="latex-pane">
            <div class="latex-pane-title">変換前（原稿）</div>
            <textarea class="latex-preview-text" id="latex-before-preview" readonly></textarea>
          </div>
          <div class="latex-pane">
            <div class="latex-pane-title">変換後（LaTeX出力プレビュー）</div>
            <textarea class="latex-preview-text" id="latex-after-preview" readonly></textarea>
          </div>
        </div>
      </div>
    `;

    this._updatePreview();
  }

  _updatePreview() {
    const res = this.converter.convert(
      this.store.state.text,
      this.store.state.latexOptions
    );
    this.latestOutput = res.output;

    const beforeEl = this.modal.bodyEl.querySelector('#latex-before-preview');
    const afterEl = this.modal.bodyEl.querySelector('#latex-after-preview');
    const statsEl = this.modal.bodyEl.querySelector('#latex-stats-box');

    if (beforeEl) beforeEl.value = this.store.state.text;
    if (afterEl) afterEl.value = res.output;
    if (statsEl) {
      statsEl.innerHTML = `
        <div>入力行数: <strong>${res.stats.inputLines}</strong> 行 → 出力行数: <strong>${res.stats.outputLines}</strong> 行</div>
        <div>変換ルビ数: <strong>${res.stats.rubyCount}</strong> 件 / 空行ブロック: <strong>${res.stats.blankBlockCount}</strong> 箇所</div>
      `;
    }
  }
}
