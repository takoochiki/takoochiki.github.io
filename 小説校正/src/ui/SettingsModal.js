import { RULE_CATEGORIES } from '../config/constants.js';
import { escapeHtml } from '../utils/textUtils.js';
import { createModal } from './modalHelper.js';

/**
 * 校正ルール設定モーダル
 * RuleRegistry の optionSchema を読み取り、ルールごとの ON/OFF・重要度・個別オプションを自動描画する。
 */
export class SettingsModal {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   * @param {import('../core/RuleRegistry.js').RuleRegistry} deps.registry
   */
  constructor({ store, registry }) {
    this.store = store;
    this.registry = registry;
    this.activeCategory = 'all';
    this.searchQuery = '';

    this.modal = createModal({
      id: 'settings-modal',
      title: '校正ルール設定',
      sizeClass: 'modal--xl',
      onOpen: () => this.render(),
    });

    this._renderFooter();
    this._bindEvents();
  }

  open() {
    this.modal.open();
  }

  _renderFooter() {
    this.modal.footerEl.innerHTML = `
      <button type="button" class="btn btn-ghost" id="btn-reset-rules">初期設定に戻す</button>
      <div class="spacer"></div>
      <button type="button" class="btn btn-primary" id="btn-close-settings">閉じる</button>
    `;
  }

  _bindEvents() {
    this.modal.footerEl.querySelector('#btn-reset-rules').addEventListener('click', () => {
      this.store.resetRuleSettings();
      this.render();
    });
    this.modal.footerEl.querySelector('#btn-close-settings').addEventListener('click', () => {
      this.modal.close();
    });

    this.modal.bodyEl.addEventListener('click', (e) => {
      const tab = e.target.closest('button[data-cat]');
      if (tab) {
        this.activeCategory = tab.dataset.cat;
        this.render();
        return;
      }
      const unignoreBtn = e.target.closest('button[data-unignore-rule]');
      if (unignoreBtn) {
        this.store.unignoreRule(unignoreBtn.dataset.unignoreRule);
        this.render();
      }
    });

    this.modal.bodyEl.addEventListener('input', (e) => {
      if (e.target.id === 'settings-search-input') {
        this.searchQuery = e.target.value;
        this._renderRulesList();
        return;
      }
      const optInput = e.target.closest('[data-rule-opt]');
      if (optInput && (optInput.type === 'text' || optInput.type === 'number')) {
        const ruleId = optInput.dataset.ruleId;
        const optKey = optInput.dataset.ruleOpt;
        const val = optInput.type === 'number' ? Number(optInput.value) : optInput.value;
        this.store.updateRuleSetting(ruleId, { options: { [optKey]: val } });
      }
    });

    this.modal.bodyEl.addEventListener('change', (e) => {
      const target = e.target;
      if (target.dataset.role === 'toggle-rule') {
        this.store.updateRuleSetting(target.dataset.ruleId, { enabled: target.checked });
        return;
      }
      if (target.dataset.role === 'severity-rule') {
        this.store.updateRuleSetting(target.dataset.ruleId, { severity: target.value });
        return;
      }
      if (target.dataset.ruleOpt) {
        const ruleId = target.dataset.ruleId;
        const optKey = target.dataset.ruleOpt;
        const val =
          target.type === 'checkbox'
            ? target.checked
            : target.type === 'number'
            ? Number(target.value)
            : target.value;
        this.store.updateRuleSetting(ruleId, { options: { [optKey]: val } });
      }
    });
  }

  render() {
    const ignoredRuleIds = [...this.store.ignores.ignoredRuleIds];
    const tabsHtml = [
      `<button type="button" class="cat-tab ${this.activeCategory === 'all' ? 'is-active' : ''}" data-cat="all">すべて (${this.registry.getAll().length})</button>`,
      ...RULE_CATEGORIES.map((c) => {
        const count = this.registry.getAll().filter((r) => r.category === c.id).length;
        return `<button type="button" class="cat-tab ${this.activeCategory === c.id ? 'is-active' : ''}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${count})</button>`;
      }),
    ].join('');

    const ignoredNoticeHtml =
      ignoredRuleIds.length > 0
        ? `<div class="ignored-rules-banner">
            <span>ルール単位で非表示中:</span>
            ${ignoredRuleIds
              .map((rid) => {
                const rule = this.registry.get(rid);
                return `<button type="button" class="btn btn-xs btn-secondary" data-unignore-rule="${escapeHtml(rid)}">${escapeHtml(rule ? rule.name : rid)} の無視を解除 ✕</button>`;
              })
              .join('')}
          </div>`
        : '';

    this.modal.bodyEl.innerHTML = `
      <div class="settings-toolbar">
        <div class="settings-tabs">${tabsHtml}</div>
        <input type="search" id="settings-search-input" class="settings-search" value="${escapeHtml(this.searchQuery)}" placeholder="ルール名や説明を検索..." />
      </div>
      ${ignoredNoticeHtml}
      <div id="settings-rules-list" class="settings-rules-list"></div>
    `;

    this._renderRulesList();
  }

  _renderRulesList() {
    const container = this.modal.bodyEl.querySelector('#settings-rules-list');
    if (!container) return;

    const query = this.searchQuery.trim().toLowerCase();
    const groups = this.registry.getGroupedByCategory();
    const { ruleSettings } = this.store.state;

    const blocks = [];
    for (const group of groups) {
      if (this.activeCategory !== 'all' && group.category.id !== this.activeCategory) continue;
      const filteredRules = group.rules.filter((r) => {
        if (!query) return true;
        return (
          r.name.toLowerCase().includes(query) ||
          r.description.toLowerCase().includes(query) ||
          r.id.toLowerCase().includes(query)
        );
      });
      if (filteredRules.length === 0) continue;

      const itemsHtml = filteredRules
        .map((rule) => {
          const st = ruleSettings[rule.id] || {
            enabled: rule.defaultEnabled,
            severity: rule.defaultSeverity,
            options: { ...rule.defaultOptions },
          };

          const optionsHtml = (rule.optionSchema || [])
            .map((field) => {
              const val = st.options?.[field.key] ?? rule.defaultOptions?.[field.key];
              if (field.type === 'boolean') {
                return `
                  <label class="rule-opt-item rule-opt-check">
                    <input type="checkbox" data-rule-id="${escapeHtml(rule.id)}" data-rule-opt="${escapeHtml(field.key)}" ${val ? 'checked' : ''} />
                    <span>${escapeHtml(field.label)}</span>
                  </label>
                `;
              }
              if (field.type === 'select') {
                const choicesHtml = (field.choices || [])
                  .map(
                    (c) =>
                      `<option value="${escapeHtml(c.value)}" ${String(val) === String(c.value) ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
                  )
                  .join('');
                return `
                  <label class="rule-opt-item">
                    <span>${escapeHtml(field.label)}:</span>
                    <select data-rule-id="${escapeHtml(rule.id)}" data-rule-opt="${escapeHtml(field.key)}">${choicesHtml}</select>
                  </label>
                `;
              }
              if (field.type === 'number') {
                return `
                  <label class="rule-opt-item">
                    <span>${escapeHtml(field.label)}:</span>
                    <input type="number" data-rule-id="${escapeHtml(rule.id)}" data-rule-opt="${escapeHtml(field.key)}" value="${escapeHtml(val)}" min="${field.min ?? 0}" max="${field.max ?? 9999}" />
                  </label>
                `;
              }
              return `
                <label class="rule-opt-item rule-opt-wide">
                  <span>${escapeHtml(field.label)}:</span>
                  <input type="text" data-rule-id="${escapeHtml(rule.id)}" data-rule-opt="${escapeHtml(field.key)}" value="${escapeHtml(val ?? '')}" placeholder="${escapeHtml(field.placeholder || '')}" />
                </label>
              `;
            })
            .join('');

          return `
            <div class="rule-setting-card ${st.enabled ? '' : 'is-disabled'}">
              <div class="rule-setting-main">
                <label class="rule-toggle">
                  <input type="checkbox" data-role="toggle-rule" data-rule-id="${escapeHtml(rule.id)}" ${st.enabled ? 'checked' : ''} />
                  <span class="rule-setting-name">${escapeHtml(rule.name)}</span>
                </label>
                <span class="rule-id-tag">${escapeHtml(rule.id)}</span>
                <select class="rule-sev-select" data-role="severity-rule" data-rule-id="${escapeHtml(rule.id)}" aria-label="重要度">
                  <option value="error" ${st.severity === 'error' ? 'selected' : ''}>高確度（赤）</option>
                  <option value="warning" ${st.severity === 'warning' ? 'selected' : ''}>低確度（黄）</option>
                </select>
              </div>
              <p class="rule-setting-desc">${escapeHtml(rule.description)}</p>
              ${optionsHtml ? `<div class="rule-setting-options">${optionsHtml}</div>` : ''}
            </div>
          `;
        })
        .join('');

      blocks.push(`
        <section class="settings-cat-section">
          <h3 class="settings-cat-heading">${escapeHtml(group.category.name)}</h3>
          ${itemsHtml}
        </section>
      `);
    }

    container.innerHTML =
      blocks.length > 0
        ? blocks.join('')
        : '<div class="empty-list-msg">一致するルールが見つかりませんでした。</div>';
  }
}
