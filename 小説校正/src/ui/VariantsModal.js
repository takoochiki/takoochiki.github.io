import { DEFAULT_VARIANT_GROUPS } from '../config/defaultVariants.js';
import { VariantService } from '../services/VariantService.js';
import { escapeHtml } from '../utils/textUtils.js';
import { createModal } from './modalHelper.js';

/**
 * 表記揺れの一括編集・個別除外付き一括置換・変更プレビュー・辞書登録モーダル
 */
export class VariantsModal {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   */
  constructor({ store }) {
    this.store = store;
    this.service = new VariantService();
    this.activeTab = 'unify'; // 'unify' | 'dictionary'
    this.selectedGroupId = null;
    this.targetTerm = '';
    this.excludedIds = new Set();
    this.showOnlyConflicts = false;

    this.modal = createModal({
      id: 'variants-modal',
      title: '表記揺れの一括編集・辞書管理',
      sizeClass: 'modal--xl',
      onOpen: (groupId) => {
        if (groupId) {
          this.activeTab = 'unify';
          this.selectedGroupId = groupId;
          this.targetTerm = '';
          this.excludedIds.clear();
        }
        this.render();
      },
    });

    this.modal.footerEl.innerHTML = `
      <span class="footer-note">※ 一括置換は1回の Undo (Ctrl+Z) で元に戻せます。</span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-secondary" id="btn-close-variants">閉じる</button>
    `;

    this._bindEvents();
  }

  open(groupId = '') {
    this.modal.open(groupId);
  }

  _bindEvents() {
    this.modal.footerEl.querySelector('#btn-close-variants').addEventListener('click', () => {
      this.modal.close();
    });

    this.modal.bodyEl.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('button[data-var-tab]');
      if (tabBtn) {
        this.activeTab = tabBtn.dataset.varTab;
        this.render();
        return;
      }

      const groupBtn = e.target.closest('.var-group-item');
      if (groupBtn) {
        this.selectedGroupId = groupBtn.dataset.groupId;
        this.targetTerm = '';
        this.excludedIds.clear();
        this.render();
        return;
      }

      const termBtn = e.target.closest('button[data-target-term]');
      if (termBtn) {
        this.targetTerm = termBtn.dataset.targetTerm;
        this.excludedIds.clear();
        this.render();
        return;
      }

      if (e.target.id === 'btn-var-select-all') {
        this.excludedIds.clear();
        this.render();
        return;
      }
      if (e.target.id === 'btn-var-unselect-all') {
        const analysis = this._getSelectedAnalysis();
        if (analysis) {
          analysis.occurrences
            .filter((o) => o.term !== this.targetTerm)
            .forEach((o) => this.excludedIds.add(o.id));
        }
        this.render();
        return;
      }

      if (e.target.id === 'btn-execute-batch-replace') {
        this._executeBatchReplace();
        return;
      }

      const delGroupBtn = e.target.closest('button[data-delete-group]');
      if (delGroupBtn) {
        const gid = delGroupBtn.dataset.deleteGroup;
        const next = this.store.state.variantGroups.filter((g) => g.id !== gid);
        this.store.updateVariantGroups(next);
        if (this.selectedGroupId === gid) this.selectedGroupId = null;
        this.render();
        return;
      }

      if (e.target.id === 'btn-reset-default-variants') {
        this.store.updateVariantGroups(
          DEFAULT_VARIANT_GROUPS.map((g) => ({ ...g, terms: [...g.terms] }))
        );
        this.render();
      }
    });

    this.modal.bodyEl.addEventListener('change', (e) => {
      const target = e.target;
      if (target.id === 'chk-only-conflicts') {
        this.showOnlyConflicts = target.checked;
        this.render();
        return;
      }
      if (target.dataset.occId) {
        if (target.checked) {
          this.excludedIds.delete(target.dataset.occId);
        } else {
          this.excludedIds.add(target.dataset.occId);
        }
        this._updatePreviewSection();
        return;
      }
      if (target.dataset.dictPref) {
        const gid = target.dataset.dictPref;
        const next = this.store.state.variantGroups.map((g) =>
          g.id === gid ? { ...g, preferred: target.value } : g
        );
        this.store.updateVariantGroups(next);
        return;
      }
      if (target.dataset.dictBoundary) {
        const gid = target.dataset.dictBoundary;
        const next = this.store.state.variantGroups.map((g) =>
          g.id === gid ? { ...g, boundaryCheck: target.checked } : g
        );
        this.store.updateVariantGroups(next);
      }
    });

    this.modal.bodyEl.addEventListener('submit', (e) => {
      if (e.target.id !== 'form-add-variant') return;
      e.preventDefault();
      const termsInput = this.modal.bodyEl.querySelector('#new-var-terms').value;
      const prefInput = this.modal.bodyEl.querySelector('#new-var-preferred').value.trim();
      const boundary = this.modal.bodyEl.querySelector('#new-var-boundary').checked;
      const errEl = this.modal.bodyEl.querySelector('#new-var-error');

      try {
        const created = this.service.createGroup(termsInput, prefInput, boundary);
        const next = [created, ...this.store.state.variantGroups];
        this.store.updateVariantGroups(next);
        this.selectedGroupId = created.id;
        this.render();
      } catch (err) {
        if (errEl) errEl.textContent = err.message;
      }
    });
  }

  _getAnalyses() {
    return this.service.analyzeAllGroups(
      this.store.state.text,
      this.store.state.variantGroups
    );
  }

  _getSelectedAnalysis() {
    const analyses = this._getAnalyses();
    return analyses.find((a) => a.group.id === this.selectedGroupId) || null;
  }

  _executeBatchReplace() {
    const analysis = this._getSelectedAnalysis();
    if (!analysis || !this.targetTerm) return;
    const preview = this.service.buildBatchPreview(
      this.store.state.text,
      analysis,
      this.targetTerm,
      this.excludedIds
    );
    if (preview.activeCount === 0) return;

    this.store.applyBatchTextChange(
      preview.previewText,
      `表記統一 (${analysis.group.label} → ${this.targetTerm})`
    );
    this.excludedIds.clear();
    this.render();
  }

  render() {
    const tabsHtml = `
      <div class="modal-tabs">
        <button type="button" class="cat-tab ${this.activeTab === 'unify' ? 'is-active' : ''}" data-var-tab="unify">表記揺れ一括統一</button>
        <button type="button" class="cat-tab ${this.activeTab === 'dictionary' ? 'is-active' : ''}" data-var-tab="dictionary">辞書管理・固有名詞登録</button>
      </div>
    `;

    if (this.activeTab === 'dictionary') {
      this._renderDictionaryTab(tabsHtml);
      return;
    }

    const analyses = this._getAnalyses();
    // 競合あり → 出現あり → 出現なし の順で並べる
    const sorted = [...analyses].sort((a, b) => {
      if (a.hasConflict !== b.hasConflict) return a.hasConflict ? -1 : 1;
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      return 0;
    });

    const visibleList = this.showOnlyConflicts
      ? sorted.filter((a) => a.hasConflict)
      : sorted;

    if (
      (!this.selectedGroupId || !analyses.some((a) => a.group.id === this.selectedGroupId)) &&
      visibleList.length > 0
    ) {
      this.selectedGroupId = visibleList[0].group.id;
    }

    const selected = analyses.find((a) => a.group.id === this.selectedGroupId) || null;

    if (selected) {
      if (!this.targetTerm || !selected.group.terms.includes(this.targetTerm)) {
        // 出現回数が最多の語または推奨語をデフォルト選択
        if (selected.group.preferred) {
          this.targetTerm = selected.group.preferred;
        } else {
          const top = [...selected.group.terms].sort(
            (a, b) => (selected.termStats[b] || 0) - (selected.termStats[a] || 0)
          )[0];
          this.targetTerm = top || selected.group.terms[0] || '';
        }
      }
    }

    const listHtml =
      visibleList.length > 0
        ? visibleList
            .map((a) => {
              const statsSummary = a.group.terms
                .map((t) => `${t}: ${a.termStats[t] || 0}`)
                .join(' / ');
              return `
                <button type="button" class="var-group-item ${a.group.id === this.selectedGroupId ? 'is-active' : ''} ${a.hasConflict ? 'has-conflict' : ''}" data-group-id="${escapeHtml(a.group.id)}">
                  <div class="var-group-title">
                    <span>${escapeHtml(a.group.label)}</span>
                    ${a.hasConflict ? '<span class="badge badge--warning">揺れ</span>' : ''}
                  </div>
                  <div class="var-group-counts">${escapeHtml(statsSummary)}</div>
                </button>
              `;
            })
            .join('')
        : '<div class="empty-list-msg">該当する表記揺れグループがありません。</div>';

    this.modal.bodyEl.innerHTML = `
      ${tabsHtml}
      <div class="variants-layout">
        <div class="variants-sidebar">
          <div class="variants-filter-bar">
            <label class="check-label">
              <input type="checkbox" id="chk-only-conflicts" ${this.showOnlyConflicts ? 'checked' : ''} />
              <span>揺れがある項目のみ表示</span>
            </label>
          </div>
          <div class="variants-group-list">${listHtml}</div>
        </div>
        <div class="variants-detail" id="variants-detail-pane"></div>
      </div>
    `;

    this._renderDetailPane(selected);
  }

  _renderDetailPane(selected) {
    const pane = this.modal.bodyEl.querySelector('#variants-detail-pane');
    if (!pane) return;

    if (!selected) {
      pane.innerHTML = '<div class="empty-list-msg">左のリストからグループを選択してください。</div>';
      return;
    }

    const termBtnsHtml = selected.group.terms
      .map((t) => {
        const count = selected.termStats[t] || 0;
        const isActive = t === this.targetTerm;
        return `
          <button type="button" class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}" data-target-term="${escapeHtml(t)}">
            ${escapeHtml(t)} (${count}回)
          </button>
        `;
      })
      .join('');

    pane.innerHTML = `
      <div class="var-detail-header">
        <h3>${escapeHtml(selected.group.label)}</h3>
        <div class="var-target-selector">
          <span class="var-step-label">統一先の表記を選択:</span>
          <div class="var-term-buttons">${termBtnsHtml}</div>
        </div>
      </div>
      <div id="variants-preview-section"></div>
    `;

    this._updatePreviewSection();
  }

  _updatePreviewSection() {
    const sec = this.modal.bodyEl.querySelector('#variants-preview-section');
    const selected = this._getSelectedAnalysis();
    if (!sec || !selected) return;

    const preview = this.service.buildBatchPreview(
      this.store.state.text,
      selected,
      this.targetTerm,
      this.excludedIds
    );

    if (preview.targets.length === 0) {
      sec.innerHTML = `
        <div class="empty-list-msg">
          「${escapeHtml(this.targetTerm)}」以外への置換対象箇所は原稿内にありません（出現合計: ${selected.totalCount}回）。
        </div>
      `;
      return;
    }

    const targetsHtml = preview.targets
      .map((occ) => {
        const checked = !this.excludedIds.has(occ.id);
        return `
          <label class="var-occ-row ${checked ? '' : 'is-excluded'}">
            <input type="checkbox" data-occ-id="${escapeHtml(occ.id)}" ${checked ? 'checked' : ''} />
            <span class="var-occ-line">${occ.line}行</span>
            <span class="var-occ-snippet">${escapeHtml(occ.snippet.before)}<mark class="snip-hit">${escapeHtml(occ.snippet.target)}</mark>${escapeHtml(occ.snippet.after)}</span>
            <span class="var-occ-arrow">→ <strong>${escapeHtml(this.targetTerm)}</strong></span>
          </label>
        `;
      })
      .join('');

    const diffsHtml =
      preview.lineDiffs.length > 0
        ? preview.lineDiffs
            .map(
              (d) => `
            <div class="diff-row">
              <div class="diff-line-num">${d.line}行目</div>
              <div class="diff-before">- ${escapeHtml(d.before)}</div>
              <div class="diff-after">+ ${escapeHtml(d.after)}</div>
            </div>
          `
            )
            .join('')
        : '<div class="empty-list-msg">置換対象がすべて除外されています。</div>';

    sec.innerHTML = `
      <div class="var-occ-toolbar">
        <span>置換対象候補（${preview.targets.length}件中 <strong>${preview.activeCount}件</strong> を置換予定）</span>
        <div class="var-occ-btns">
          <button type="button" class="btn btn-xs btn-ghost" id="btn-var-select-all">すべて選択</button>
          <button type="button" class="btn btn-xs btn-ghost" id="btn-var-unselect-all">すべて除外</button>
        </div>
      </div>
      <div class="var-occ-list">${targetsHtml}</div>
      <div class="var-diff-header">変更プレビュー</div>
      <div class="var-diff-box">${diffsHtml}</div>
      <div class="var-execute-bar">
        <button type="button" class="btn btn-primary" id="btn-execute-batch-replace" ${preview.activeCount === 0 ? 'disabled' : ''}>
          選択した ${preview.activeCount} 箇所を「${escapeHtml(this.targetTerm)}」に一括置換
        </button>
      </div>
    `;
  }

  _renderDictionaryTab(tabsHtml) {
    const groups = this.store.state.variantGroups;

    const rowsHtml = groups
      .map(
        (g) => `
        <tr>
          <td><strong>${escapeHtml(g.terms.join(' / '))}</strong></td>
          <td>
            <select data-dict-pref="${escapeHtml(g.id)}">
              <option value="" ${!g.preferred ? 'selected' : ''}>指定なし（混在時に警告）</option>
              ${g.terms
                .map(
                  (t) =>
                    `<option value="${escapeHtml(t)}" ${g.preferred === t ? 'selected' : ''}>${escapeHtml(t)}</option>`
                )
                .join('')}
            </select>
          </td>
          <td>
            <label class="check-label">
              <input type="checkbox" data-dict-boundary="${escapeHtml(g.id)}" ${g.boundaryCheck ? 'checked' : ''} />
              <span>熟語除外</span>
            </label>
          </td>
          <td>
            <button type="button" class="btn btn-xs btn-ghost" data-delete-group="${escapeHtml(g.id)}">削除</button>
          </td>
        </tr>
      `
      )
      .join('');

    this.modal.bodyEl.innerHTML = `
      ${tabsHtml}
      <form id="form-add-variant" class="add-variant-form">
        <div class="form-row-inline">
          <div class="form-field-grow">
            <label for="new-var-terms">表記候補（カンマ・スラッシュ区切りで2つ以上）</label>
            <input type="text" id="new-var-terms" placeholder="例: 紗英, 冴絵 / サーバ, サーバー" required />
          </div>
          <div>
            <label for="new-var-preferred">推奨表記（任意）</label>
            <input type="text" id="new-var-preferred" placeholder="例: 紗英" />
          </div>
          <div class="form-field-check">
            <label class="check-label" title="単漢字の前後に別の漢字が続く熟語を除外します">
              <input type="checkbox" id="new-var-boundary" />
              <span>漢字境界判定</span>
            </label>
          </div>
          <button type="submit" class="btn btn-primary">グループ追加</button>
        </div>
        <div id="new-var-error" class="form-error-msg"></div>
      </form>

      <div class="dict-table-wrap">
        <table class="dict-table">
          <thead>
            <tr>
              <th>表記グループ</th>
              <th>統一推奨表記</th>
              <th>境界判定</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="dict-actions">
        <button type="button" class="btn btn-xs btn-ghost" id="btn-reset-default-variants">初期辞書（22語群）に戻す</button>
      </div>
    `;
  }
}
