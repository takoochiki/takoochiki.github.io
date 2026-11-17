import { FONT_FAMILY_MAP } from '../config/constants.js';
import { computeCharCounts } from '../utils/textUtils.js';
import { SegmentRenderer } from './SegmentRenderer.js';

/**
 * 縦書き(上下分割)/横書き(左右分割)の2画面レイアウト、ドラッグによる分割比率変更、
 * スクロール同期(ON/OFF)、編集領域・校正領域の連携を制御する。
 */
export class AppLayout {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {HTMLElement} deps.splitContainer
   * @param {HTMLElement} deps.editorPane
   * @param {HTMLElement} deps.proofreadPane
   * @param {HTMLElement} deps.resizer
   * @param {HTMLTextAreaElement} deps.textarea
   * @param {HTMLElement} deps.proofreadScrollEl
   * @param {HTMLElement} deps.proofreadContentEl
   * @param {HTMLElement} deps.charCountEl
   */
  constructor({
    store,
    splitContainer,
    editorPane,
    proofreadPane,
    resizer,
    textarea,
    proofreadScrollEl,
    proofreadContentEl,
    charCountEl,
  }) {
    this.store = store;
    this.splitContainer = splitContainer;
    this.editorPane = editorPane;
    this.proofreadPane = proofreadPane;
    this.resizer = resizer;
    this.textarea = textarea;
    this.proofreadScrollEl = proofreadScrollEl;
    this.proofreadContentEl = proofreadContentEl;
    this.charCountEl = charCountEl;

    this.renderer = new SegmentRenderer();
    this.activeScrollSource = null;
    this.scrollUnlockTimer = null;
    this.isDraggingSplit = false;
    this.isComposing = false;

    this._bindEvents();
    this._subscribeStore();
  }

  _bindEvents() {
    // IME 変換中は入力確定後に反映しても自然だが、textarea.value との一貫性を保つため
    // compositionend でも明示反映する
    this.textarea.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });
    this.textarea.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.store.setText(this.textarea.value, {
        source: 'typing',
        selectionStart: this.textarea.selectionStart,
        selectionEnd: this.textarea.selectionEnd,
      });
    });

    this.textarea.addEventListener('input', () => {
      if (this.isComposing) return;
      this.store.setText(this.textarea.value, {
        source: 'typing',
        selectionStart: this.textarea.selectionStart,
        selectionEnd: this.textarea.selectionEnd,
      });
    });

    // スクロール双方向同期・縦書きホイール横スクロール変換
    this._bindScrollPane(this.textarea, this.proofreadScrollEl);
    this._bindScrollPane(this.proofreadScrollEl, this.textarea);

    // スプリッタードラッグ
    this.resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.isDraggingSplit = true;
      this.resizer.setPointerCapture(e.pointerId);
      document.body.classList.add('is-resizing');
    });

    this.resizer.addEventListener('pointermove', (e) => {
      if (!this.isDraggingSplit) return;
      const rect = this.splitContainer.getBoundingClientRect();
      const isVertical = this.store.state.displaySettings.writingMode === 'vertical';
      let ratio = 0.5;
      if (isVertical) {
        ratio = (e.clientY - rect.top) / Math.max(1, rect.height);
      } else {
        ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
      }
      ratio = Math.max(0.2, Math.min(0.8, ratio));
      this._applySplitRatio(ratio);
    });

    const endDrag = () => {
      if (!this.isDraggingSplit) return;
      this.isDraggingSplit = false;
      document.body.classList.remove('is-resizing');
      const curRatio = parseFloat(this.editorPane.dataset.ratio || '0.5');
      this.store.updateDisplaySettings({ splitRatio: curRatio });
    };

    this.resizer.addEventListener('pointerup', endDrag);
    this.resizer.addEventListener('pointercancel', endDrag);
  }

  _subscribeStore() {
    this.store.bus.on('state:initialized', () => {
      this.textarea.value = this.store.state.text;
      this.applyDisplaySettings(this.store.state.displaySettings);
      this.updateCharCount();
      this.renderProofread();
    });

    this.store.bus.on('document:loaded', ({ text }) => {
      this.textarea.value = text;
      this.updateCharCount();
      this.renderProofread();
    });

    this.store.bus.on('text:changed', ({ text, source }) => {
      if (source !== 'typing' && this.textarea.value !== text) {
        this.textarea.value = text;
      }
      this.updateCharCount();
      // 編集直後にも仮表示を更新し、直後の再検査でマーカーが追従する
      this.renderProofread();
    });

    this.store.bus.on('editor:restore-selection', ({ start, end }) => {
      this.textarea.focus();
      this.textarea.setSelectionRange(start, end);
    });

    this.store.bus.on('issues:updated', () => {
      this.renderProofread();
    });

    this.store.bus.on('filters:updated', () => {
      this.renderProofread();
    });

    this.store.bus.on('issue:selected', () => {
      this.renderProofread();
    });

    this.store.bus.on('display:updated', (settings) => {
      this.applyDisplaySettings(settings);
    });
  }

  /**
   * 縦書き・横書き・フォント・テーマ・分割比率を DOM へ適用する
   * @param {object} display
   */
  applyDisplaySettings(display) {
    const isVertical = display.writingMode === 'vertical';

    document.documentElement.dataset.theme = display.theme === 'dark' ? 'dark' : 'light';
    this.splitContainer.classList.toggle('is-vertical', isVertical);
    this.splitContainer.classList.toggle('is-horizontal', !isVertical);

    const fontStack = FONT_FAMILY_MAP[display.fontFamily] || FONT_FAMILY_MAP.serif;
    document.documentElement.style.setProperty('--manuscript-font', fontStack);
    document.documentElement.style.setProperty('--manuscript-font-size', `${display.fontSize}px`);
    document.documentElement.style.setProperty('--manuscript-line-height', String(display.lineHeight));

    this._applySplitRatio(display.splitRatio ?? 0.5);
  }

  _applySplitRatio(ratio) {
    const clamped = Math.max(0.2, Math.min(0.8, ratio));
    this.editorPane.dataset.ratio = clamped.toFixed(4);
    this.editorPane.style.flex = `0 0 ${(clamped * 100).toFixed(2)}%`;
    this.proofreadPane.style.flex = `1 1 0%`;
  }

  /**
   * ペインごとのスクロール・ホイールイベントを登録する
   * @param {HTMLElement} el
   * @param {HTMLElement} otherEl
   */
  _bindScrollPane(el, otherEl) {
    el.addEventListener('wheel', (e) => this._handleWheel(e, el), { passive: false });
    el.addEventListener('pointerdown', () => this._setActiveScrollSource(el));
    el.addEventListener('touchstart', () => this._setActiveScrollSource(el), { passive: true });
    el.addEventListener('keydown', () => this._setActiveScrollSource(el));
    el.addEventListener('scroll', () => this._syncScroll(el, otherEl), { passive: true });
  }

  /**
   * 現在ユーザーが操作中のスクロール元ペインを記録し、停止後に解除する
   * @param {HTMLElement} el
   */
  _setActiveScrollSource(el) {
    this.activeScrollSource = el;
    clearTimeout(this.scrollUnlockTimer);
    this.scrollUnlockTimer = setTimeout(() => {
      this.activeScrollSource = null;
    }, 200);
  }

  /**
   * 縦書きモード時に縦ホイール(deltaY)を横スクロール(scrollLeft)へ変換する
   * @param {WheelEvent} e
   * @param {HTMLElement} el
   */
  _handleWheel(e, el) {
    this._setActiveScrollSource(el);
    const isVertical = this.store.state.displaySettings.writingMode === 'vertical';
    if (!isVertical || e.ctrlKey) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    if (el.scrollWidth <= el.clientWidth) return;

    let deltaPx = e.deltaY;
    if (e.deltaMode === 1) {
      deltaPx *= 32;
    } else if (e.deltaMode === 2) {
      deltaPx *= el.clientWidth;
    }

    e.preventDefault();
    el.scrollLeft -= deltaPx;
  }

  /**
   * スクロール位置を横書き/縦書き両方に対応した正規化比率で一方向に同期する。
   * 受動側ペインの遅延 scroll イベントで操作側へ書き戻さないことで端のもっさり感を防ぐ。
   * @param {HTMLElement} source
   * @param {HTMLElement} target
   */
  _syncScroll(source, target) {
    if (!this.store.state.displaySettings.syncScroll) return;

    if (!this.activeScrollSource) {
      this._setActiveScrollSource(source);
    } else if (this.activeScrollSource !== source) {
      return;
    } else {
      this._setActiveScrollSource(source);
    }

    const isVertical = this.store.state.displaySettings.writingMode === 'vertical';
    if (!isVertical) {
      const srcMax = source.scrollHeight - source.clientHeight;
      if (srcMax <= 0) return;
      const tgtMax = Math.max(0, target.scrollHeight - target.clientHeight);
      let ratio = source.scrollTop / srcMax;
      if (source.scrollTop <= 1) ratio = 0;
      else if (srcMax - source.scrollTop <= 1) ratio = 1;
      const nextTop = Math.round(ratio * tgtMax);
      if (Math.abs(target.scrollTop - nextTop) >= 1) {
        target.scrollTop = nextTop;
      }
    } else {
      // vertical-rl では Chrome/Edge/Firefox ともに scrollLeft が 0 から負方向へ動く
      const srcMax = source.scrollWidth - source.clientWidth;
      if (srcMax <= 0) return;
      const tgtMax = Math.max(0, target.scrollWidth - target.clientWidth);
      const srcAbs = Math.abs(source.scrollLeft);
      let ratio = srcAbs / srcMax;
      if (srcAbs <= 1) ratio = 0;
      else if (srcMax - srcAbs <= 1) ratio = 1;
      const nextLeft = -Math.round(ratio * tgtMax);
      if (Math.abs(target.scrollLeft - nextLeft) >= 1) {
        target.scrollLeft = nextLeft;
      }
    }
  }

  /**
   * 文字数・原稿用紙換算ステータスを更新する
   */
  updateCharCount() {
    const counts = computeCharCounts(this.store.state.text);
    this.charCountEl.textContent = `${counts.withoutBreaks.toLocaleString()}字（空白除 ${counts.withoutSpacesAndBreaks.toLocaleString()}字 / 400字詰 ${counts.manuscriptPages}枚 / ${counts.lines}行）`;
  }

  /**
   * 校正プレビュー領域を最新の指摘情報で再描画する
   */
  renderProofread() {
    const { text, issues, activeIssueId, filters } = this.store.state;
    const showIgnoredOnly = filters.status === 'ignored';
    const scrollTop = this.proofreadScrollEl.scrollTop;
    const scrollLeft = this.proofreadScrollEl.scrollLeft;

    this.proofreadContentEl.innerHTML = this.renderer.renderHtml(text, issues, {
      activeIssueId,
      showIgnoredOnly,
    });

    this.proofreadScrollEl.scrollTop = scrollTop;
    this.proofreadScrollEl.scrollLeft = scrollLeft;
  }

  /**
   * 指定された指摘の箇所へ編集領域・校正領域の双方をジャンプさせる
   * @param {any} issue
   */
  jumpToIssue(issue) {
    if (!issue) return;

    // 1. 編集領域に選択範囲を設定し、概算位置へスクロール
    this.textarea.focus();
    this.textarea.setSelectionRange(issue.start, issue.end);

    const textLen = Math.max(1, this.store.state.text.length);
    const ratio = issue.start / textLen;
    const isVertical = this.store.state.displaySettings.writingMode === 'vertical';

    this._setActiveScrollSource(this.textarea);
    if (!isVertical) {
      const maxTop = Math.max(0, this.textarea.scrollHeight - this.textarea.clientHeight);
      this.textarea.scrollTop = Math.max(0, ratio * maxTop - this.textarea.clientHeight * 0.25);
    } else {
      const maxLeft = Math.max(0, this.textarea.scrollWidth - this.textarea.clientWidth);
      this.textarea.scrollLeft = -Math.max(0, ratio * maxLeft - this.textarea.clientWidth * 0.25);
    }

    // 2. 校正領域の対応マーカーを中央へスクロール
    const mark = this.proofreadContentEl.querySelector(
      `mark.issue-mark[data-issue-ids*="${CSS.escape(issue.id)}"]`
    );
    if (mark) {
      this._setActiveScrollSource(this.proofreadScrollEl);
      mark.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    }
  }
}
