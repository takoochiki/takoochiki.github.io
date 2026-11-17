import { escapeHtml } from '../utils/textUtils.js';

/**
 * 校正マーカーのホバー（ツールチップ表示）およびクリック（修正候補適用・無視操作）を制御するポップオーバー UI。
 * 複数の指摘が重複した箇所でも、すべての指摘を切り替えて／並べて操作できる。
 */
export class IssuePopover {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {HTMLElement} deps.proofreadContainer
   * @param {(groupId: string) => void} [deps.onOpenVariants]
   */
  constructor({ store, proofreadContainer, onOpenVariants }) {
    this.store = store;
    this.proofreadContainer = proofreadContainer;
    this.onOpenVariants = onOpenVariants || (() => {});

    this.el = document.createElement('div');
    this.el.className = 'issue-popover hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', '校正指摘の詳細');
    document.body.appendChild(this.el);

    this.mode = 'closed'; // 'closed' | 'hover' | 'pinned'
    this.currentIssueIds = [];
    this.hoverHideTimer = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.proofreadContainer.addEventListener('mouseover', (e) => {
      if (this.mode === 'pinned') return;
      const mark = e.target.closest('mark.issue-mark');
      if (!mark) return;
      clearTimeout(this.hoverHideTimer);
      const ids = this._extractIds(mark);
      if (ids.length > 0) {
        this.show(ids, mark, 'hover');
      }
    });

    this.proofreadContainer.addEventListener('mouseout', (e) => {
      if (this.mode !== 'hover') return;
      const related = e.relatedTarget;
      if (related && (this.el.contains(related) || related.closest?.('mark.issue-mark'))) {
        return;
      }
      this.hoverHideTimer = setTimeout(() => {
        if (this.mode === 'hover') this.hide();
      }, 160);
    });

    this.proofreadContainer.addEventListener('click', (e) => {
      const mark = e.target.closest('mark.issue-mark');
      if (!mark) return;
      e.stopPropagation();
      const ids = this._extractIds(mark);
      if (ids.length > 0) {
        this.store.setActiveIssue(ids[0]);
        this.show(ids, mark, 'pinned');
      }
    });

    this.el.addEventListener('mouseenter', () => {
      clearTimeout(this.hoverHideTimer);
    });

    this.el.addEventListener('mouseleave', () => {
      if (this.mode === 'hover') {
        this.hoverHideTimer = setTimeout(() => {
          if (this.mode === 'hover') this.hide();
        }, 140);
      }
    });

    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const issueId = btn.dataset.issueId;

      if (action === 'close') {
        this.hide();
        return;
      }
      if (action === 'apply') {
        const idx = Number(btn.dataset.suggestionIdx);
        const issue = this.store.state.issues.find((i) => i.id === issueId);
        const suggestion = issue?.suggestions?.[idx];
        if (issue && suggestion) {
          this.store.applySuggestion(issueId, suggestion.replacement);
          this.hide();
        }
        return;
      }
      if (action === 'ignore-issue') {
        this.store.ignoreIssue(issueId);
        this.hide();
        return;
      }
      if (action === 'unignore-issue') {
        this.store.unignoreIssue(issueId);
        this.hide();
        return;
      }
      if (action === 'ignore-rule') {
        const ruleId = btn.dataset.ruleId;
        if (ruleId) {
          this.store.ignoreRule(ruleId);
          this.hide();
        }
        return;
      }
      if (action === 'open-variants') {
        const groupId = btn.dataset.groupId || '';
        this.hide();
        this.onOpenVariants(groupId);
        return;
      }
      if (action === 'batch-transform') {
        const transformId = btn.dataset.transformId || '';
        if (transformId) {
          this.store.runSymbolTransform(transformId);
          this.hide();
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (this.mode === 'pinned' && !this.el.contains(e.target)) {
        this.hide();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.mode !== 'closed') {
        this.hide();
      }
    });
  }

  _extractIds(markEl) {
    const raw = markEl.dataset.issueIds || '';
    return raw.split(',').filter(Boolean);
  }

  /**
   * ポップオーバーを表示する
   * @param {string[]} issueIds
   * @param {HTMLElement} anchorEl
   * @param {'hover'|'pinned'} mode
   */
  show(issueIds, anchorEl, mode = 'pinned') {
    const issues = issueIds
      .map((id) => this.store.state.issues.find((i) => i.id === id))
      .filter(Boolean);

    if (issues.length === 0) {
      this.hide();
      return;
    }

    this.mode = mode;
    this.currentIssueIds = issueIds;
    this._render(issues, mode);
    this.el.classList.remove('hidden');
    this._positionNear(anchorEl);
  }

  hide() {
    this.mode = 'closed';
    this.currentIssueIds = [];
    this.el.classList.add('hidden');
  }

  _render(issues, mode) {
    const headerTitle =
      issues.length > 1
        ? `重複している指摘（${issues.length}件）`
        : `${issues[0].ruleName}`;

    const cardsHtml = issues
      .map((issue) => {
        const sevLabel = issue.severity === 'error' ? '高確度' : '低確度';
        const sevClass = issue.severity === 'error' ? 'badge--error' : 'badge--warning';

        const suggestionsHtml =
          issue.suggestions.length > 0
            ? `<div class="popover-suggestions">
                ${issue.suggestions
                  .map(
                    (s, idx) =>
                      `<button type="button" class="btn btn-xs btn-primary" data-action="apply" data-issue-id="${escapeHtml(issue.id)}" data-suggestion-idx="${idx}">${escapeHtml(s.label)}</button>`
                  )
                  .join('')}
              </div>`
            : `<p class="popover-no-suggestion">自動修正候補はありません（文脈を確認して手動で編集してください）</p>`;

        const variantBtn = issue.extra?.variantGroupId
          ? `<button type="button" class="btn btn-xs btn-secondary" data-action="open-variants" data-group-id="${escapeHtml(issue.extra.variantGroupId)}">一括統一を開く</button>`
          : '';

        const batchTransformsHtml =
          mode === 'pinned' && Array.isArray(issue.extra?.batchTransforms) && issue.extra.batchTransforms.length > 0
            ? `<div class="popover-batch-transforms">
                ${issue.extra.batchTransforms
                  .map(
                    (bt) =>
                      `<button type="button" class="btn btn-xs btn-secondary" data-action="batch-transform" data-transform-id="${escapeHtml(bt.id)}">${escapeHtml(bt.label)}</button>`
                  )
                  .join('')}
              </div>`
            : '';

        const ignoreControls =
          mode === 'pinned'
            ? `<div class="popover-actions">
                ${variantBtn}
                ${
                  issue.ignored
                    ? `<button type="button" class="btn btn-xs btn-ghost" data-action="unignore-issue" data-issue-id="${escapeHtml(issue.id)}">無視を解除</button>`
                    : `<button type="button" class="btn btn-xs btn-ghost" data-action="ignore-issue" data-issue-id="${escapeHtml(issue.id)}">この指摘を無視</button>
                       <button type="button" class="btn btn-xs btn-ghost" data-action="ignore-rule" data-issue-id="${escapeHtml(issue.id)}" data-rule-id="${escapeHtml(issue.ruleId)}">同ルールをすべて無視</button>`
                }
              </div>`
            : '';

        return `
          <div class="popover-issue-card">
            <div class="popover-issue-meta">
              <span class="badge ${sevClass}">${sevLabel}</span>
              <span class="popover-rule-name">${escapeHtml(issue.ruleName)}</span>
              <span class="popover-pos">${issue.line}行 ${issue.column}列</span>
            </div>
            <p class="popover-message">${escapeHtml(issue.message)}</p>
            <div class="popover-matched">対象: <code>${escapeHtml(issue.matchedText.replace(/\n/g, '↵'))}</code></div>
            ${mode === 'pinned' ? suggestionsHtml : this._renderHoverSuggestionHint(issue)}
            ${batchTransformsHtml}
            ${ignoreControls}
          </div>
        `;
      })
      .join('');

    this.el.innerHTML = `
      <div class="popover-header">
        <span class="popover-title">${escapeHtml(headerTitle)}</span>
        ${
          mode === 'pinned'
            ? '<button type="button" class="icon-btn" data-action="close" aria-label="閉じる">✕</button>'
            : '<span class="popover-hint">クリックで修正・無視</span>'
        }
      </div>
      <div class="popover-body">${cardsHtml}</div>
    `;
  }

  _renderHoverSuggestionHint(issue) {
    if (!issue.suggestions || issue.suggestions.length === 0) return '';
    const labels = issue.suggestions.map((s) => s.label).join(' / ');
    return `<div class="popover-hover-candidates">修正候補: ${escapeHtml(labels)}</div>`;
  }

  _positionNear(anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const popRect = this.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let top = rect.bottom + margin;
    if (top + popRect.height > vh - 12) {
      top = Math.max(12, rect.top - popRect.height - margin);
    }

    let left = rect.left;
    if (left + popRect.width > vw - 12) {
      left = Math.max(12, vw - popRect.width - 12);
    }

    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.left = `${Math.round(left)}px`;
  }
}
