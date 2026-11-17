import { RULE_CATEGORIES } from '../config/constants.js';
import { escapeHtml, extractContextSnippet } from '../utils/textUtils.js';

/**
 * 画面右端/サイドに配置される指摘一覧パネル。
 * 重要度別・状態別（未対応/修正済み/無視済み）・カテゴリ/ルール別フィルタ、
 * クリックでの該当箇所ジャンプ、前後ナビゲーションを提供する。
 */
export class IssueListPanel {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {import('../core/RuleRegistry.js').RuleRegistry} deps.registry
   * @param {HTMLElement} deps.container
   * @param {(issue: any) => void} deps.onJumpToIssue
   * @param {(groupId: string) => void} [deps.onOpenVariants]
   */
  constructor({ store, registry, container, onJumpToIssue, onOpenVariants }) {
    this.store = store;
    this.registry = registry;
    this.container = container;
    this.onJumpToIssue = onJumpToIssue;
    this.onOpenVariants = onOpenVariants || (() => {});

    this._renderShell();
    this._bindEvents();
    this._subscribeStore();
  }

  _renderShell() {
    const categoryOptions = RULE_CATEGORIES.map(
      (c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');

    this.container.innerHTML = `
      <div class="panel-header">
        <div class="panel-title-row">
          <h2 class="panel-title">指摘一覧</h2>
          <div class="panel-nav-btns">
            <button type="button" class="btn btn-xs btn-ghost" id="btn-prev-issue" title="前の指摘へ (Alt+P)">↑ 前へ</button>
            <button type="button" class="btn btn-xs btn-ghost" id="btn-next-issue" title="次の指摘へ (Alt+N)">↓ 次へ</button>
          </div>
        </div>
        <div class="issue-summary-badges" id="issue-summary-badges"></div>
        <div class="issue-filters">
          <div class="filter-tabs" role="tablist" id="issue-status-tabs">
            <button type="button" class="filter-tab is-active" data-status="unhandled">未対応</button>
            <button type="button" class="filter-tab" data-status="resolved">修正済</button>
            <button type="button" class="filter-tab" data-status="ignored">無視済</button>
            <button type="button" class="filter-tab" data-status="all">すべて</button>
          </div>
          <div class="filter-row">
            <select id="filter-severity" aria-label="重要度で絞り込み">
              <option value="all">重要度: すべて</option>
              <option value="error">高確度（赤）のみ</option>
              <option value="warning">低確度（黄）のみ</option>
            </select>
            <select id="filter-category" aria-label="カテゴリで絞り込み">
              <option value="all">分類: すべて</option>
              ${categoryOptions}
            </select>
          </div>
          <div class="filter-row">
            <select id="filter-rule" aria-label="ルールで絞り込み">
              <option value="all">ルール: すべて</option>
            </select>
          </div>
          <input type="search" id="filter-search" class="filter-search" placeholder="指摘文・該当語を検索..." />
        </div>
      </div>
      <div class="issue-list-body" id="issue-list-body" tabindex="0"></div>
    `;

    this.badgesEl = this.container.querySelector('#issue-summary-badges');
    this.listBodyEl = this.container.querySelector('#issue-list-body');
    this.statusTabsEl = this.container.querySelector('#issue-status-tabs');
    this.severityEl = this.container.querySelector('#filter-severity');
    this.categoryEl = this.container.querySelector('#filter-category');
    this.ruleEl = this.container.querySelector('#filter-rule');
    this.searchEl = this.container.querySelector('#filter-search');
  }

  _bindEvents() {
    this.container.querySelector('#btn-prev-issue').addEventListener('click', () => this.moveSelection(-1));
    this.container.querySelector('#btn-next-issue').addEventListener('click', () => this.moveSelection(1));

    this.statusTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      this.store.setFilters({ status: btn.dataset.status });
    });

    this.severityEl.addEventListener('change', () => {
      this.store.setFilters({ severity: this.severityEl.value });
    });

    this.categoryEl.addEventListener('change', () => {
      this.store.setFilters({ category: this.categoryEl.value, ruleId: 'all' });
    });

    this.ruleEl.addEventListener('change', () => {
      this.store.setFilters({ ruleId: this.ruleEl.value });
    });

    this.searchEl.addEventListener('input', () => {
      this.store.setFilters({ search: this.searchEl.value });
    });

    // パネル上でのキーボード上下ナビゲーション
    this.listBodyEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        this.moveSelection(-1);
      }
    });

    this.listBodyEl.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('button[data-action]');
      const card = e.target.closest('.issue-item');
      if (!card) return;
      const issueId = card.dataset.issueId;

      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === 'apply') {
          const idx = Number(actionBtn.dataset.suggestionIdx);
          const issue = this.store.state.issues.find((i) => i.id === issueId);
          if (issue?.suggestions?.[idx]) {
            this.store.applySuggestion(issueId, issue.suggestions[idx].replacement);
          }
        } else if (action === 'ignore') {
          this.store.ignoreIssue(issueId);
        } else if (action === 'unignore') {
          this.store.unignoreIssue(issueId);
        } else if (action === 'open-variants') {
          this.onOpenVariants(actionBtn.dataset.groupId || '');
        }
        return;
      }

      const issue = this.store.state.issues.find((i) => i.id === issueId);
      if (issue) {
        this.store.setActiveIssue(issue.id);
        this.onJumpToIssue(issue);
      }
    });
  }

  _subscribeStore() {
    this.store.bus.on('state:initialized', () => this.render());
    this.store.bus.on('issues:updated', () => this.render());
    this.store.bus.on('filters:updated', () => this.render());
    this.store.bus.on('issue:selected', (issueId) => this._highlightActiveCard(issueId));
  }

  /**
   * 現在のフィルタ結果上で前後の指摘へ移動する
   * @param {1 | -1} delta
   */
  moveSelection(delta) {
    if (this.store.state.filters.status === 'resolved') return;
    const list = this.store.getFilteredIssues();
    if (list.length === 0) return;

    const currentIdx = list.findIndex((i) => i.id === this.store.state.activeIssueId);
    let nextIdx = 0;
    if (currentIdx === -1) {
      nextIdx = delta > 0 ? 0 : list.length - 1;
    } else {
      nextIdx = (currentIdx + delta + list.length) % list.length;
    }

    const target = list[nextIdx];
    this.store.setActiveIssue(target.id);
    this.onJumpToIssue(target);
  }

  _highlightActiveCard(issueId) {
    const cards = this.listBodyEl.querySelectorAll('.issue-item');
    cards.forEach((c) => {
      const match = c.dataset.issueId === issueId;
      c.classList.toggle('is-active', match);
      if (match) {
        c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  _syncRuleFilterDropdown() {
    const selectedCat = this.store.state.filters.category;
    const currentRuleId = this.store.state.filters.ruleId;

    // 検出件数のカウント
    const ruleCounts = new Map();
    for (const issue of this.store.state.issues) {
      if (selectedCat !== 'all' && issue.category !== selectedCat) continue;
      ruleCounts.set(issue.ruleId, (ruleCounts.get(issue.ruleId) || 0) + 1);
    }

    const rules = this.registry
      .getAll()
      .filter((r) => selectedCat === 'all' || r.category === selectedCat);

    const optionsHtml = [
      '<option value="all">ルール: すべて</option>',
      ...rules.map((r) => {
        const cnt = ruleCounts.get(r.id) || 0;
        const countStr = cnt > 0 ? ` (${cnt})` : '';
        return `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}${countStr}</option>`;
      }),
    ].join('');

    this.ruleEl.innerHTML = optionsHtml;
    this.ruleEl.value = ruleCounts.has(currentRuleId) || currentRuleId === 'all' ? currentRuleId : 'all';
  }

  render() {
    const counts = this.store.getIssueCounts();
    const { filters } = this.store.state;

    // ステータスタブ同期
    this.statusTabsEl.querySelectorAll('button[data-status]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.status === filters.status);
    });
    this.severityEl.value = filters.severity;
    this.categoryEl.value = filters.category;
    this._syncRuleFilterDropdown();

    this.badgesEl.innerHTML = `
      <span class="badge badge--error" title="高確度の指摘">赤 ${counts.errorCount}</span>
      <span class="badge badge--warning" title="低確度の指摘">黄 ${counts.warningCount}</span>
      <span class="badge badge--muted" title="無視済み">無視 ${counts.ignoredCount}</span>
      <span class="badge badge--success" title="このセッションで修正済み">修正 ${counts.resolvedCount}</span>
    `;

    const items = this.store.getFilteredIssues();

    if (filters.status === 'resolved') {
      if (items.length === 0) {
        this.listBodyEl.innerHTML = '<div class="empty-list-msg">このセッションで修正済みの指摘はまだありません。</div>';
        return;
      }
      this.listBodyEl.innerHTML = items
        .map(
          (item) => `
          <div class="issue-item issue-item--resolved">
            <div class="issue-item-header">
              <span class="badge badge--success">修正済</span>
              <span class="issue-item-rule">${escapeHtml(item.ruleName)}</span>
              <span class="issue-item-pos">${item.line}行</span>
            </div>
            <div class="issue-item-msg">${escapeHtml(item.message)}</div>
            <div class="issue-item-diff">
              <del>${escapeHtml(item.originalText.replace(/\n/g, '↵'))}</del>
              <span>→</span>
              <ins>${escapeHtml(item.replacement ? item.replacement.replace(/\n/g, '↵') : '(削除)')}</ins>
            </div>
          </div>
        `
        )
        .join('');
      return;
    }

    if (items.length === 0) {
      this.listBodyEl.innerHTML =
        '<div class="empty-list-msg">現在の絞り込み条件に該当する指摘はありません。</div>';
      return;
    }

    const text = this.store.state.text;
    const activeId = this.store.state.activeIssueId;
    // 大量指摘時（数千件）のDOM描画を抑制して快適性を維持
    const maxRender = 500;
    const sliced = items.slice(0, maxRender);

    const html = sliced
      .map((issue) => {
        const snippet = extractContextSnippet(text, issue.start, issue.end, 10);
        const sevClass = issue.severity === 'error' ? 'badge--error' : 'badge--warning';
        const sevLabel = issue.severity === 'error' ? '赤' : '黄';
        const isActive = issue.id === activeId;
        const firstSug = issue.suggestions?.[0];

        return `
          <div class="issue-item ${isActive ? 'is-active' : ''} ${issue.ignored ? 'is-ignored' : ''}" data-issue-id="${escapeHtml(issue.id)}">
            <div class="issue-item-header">
              <span class="badge ${sevClass}">${sevLabel}</span>
              <span class="issue-item-rule">${escapeHtml(issue.ruleName)}</span>
              <span class="issue-item-pos">${issue.line}:${issue.column}</span>
            </div>
            <div class="issue-item-msg">${escapeHtml(issue.message)}</div>
            <div class="issue-item-snippet">
              <span class="snip-ctx">${escapeHtml(snippet.before)}</span><mark class="snip-hit">${escapeHtml(snippet.target)}</mark><span class="snip-ctx">${escapeHtml(snippet.after)}</span>
            </div>
            <div class="issue-item-actions">
              ${
                firstSug
                  ? `<button type="button" class="btn btn-xs btn-primary" data-action="apply" data-suggestion-idx="0">${escapeHtml(firstSug.label)}</button>`
                  : ''
              }
              ${
                issue.extra?.variantGroupId
                  ? `<button type="button" class="btn btn-xs btn-secondary" data-action="open-variants" data-group-id="${escapeHtml(issue.extra.variantGroupId)}">一括統一</button>`
                  : ''
              }
              ${
                issue.ignored
                  ? '<button type="button" class="btn btn-xs btn-ghost" data-action="unignore">解除</button>'
                  : '<button type="button" class="btn btn-xs btn-ghost" data-action="ignore">無視</button>'
              }
            </div>
          </div>
        `;
      })
      .join('');

    const overflowNote =
      items.length > maxRender
        ? `<div class="list-overflow-note">全 ${items.length} 件中、先頭 ${maxRender} 件を表示しています。フィルタで絞り込んでください。</div>`
        : '';

    this.listBodyEl.innerHTML = html + overflowNote;
  }
}
