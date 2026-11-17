import { StatsService } from '../services/StatsService.js';
import { escapeHtml } from '../utils/textUtils.js';
import { createModal } from './modalHelper.js';

/**
 * 原稿の文字数・文字種・約物頻度・特定文字列出現回数の集計モーダル
 */
export class StatsModal {
  /**
   * @param {object} deps
   * @param {import('../core/Store.js').Store} deps.store
   */
  constructor({ store }) {
    this.store = store;
    this.service = new StatsService();
    this.customQuery = '';

    this.modal = createModal({
      id: 'stats-modal',
      title: '原稿統計・文字種・約物頻度',
      sizeClass: 'modal--lg',
      onOpen: () => this.render(),
    });

    this.modal.footerEl.innerHTML = `
      <div class="spacer"></div>
      <button type="button" class="btn btn-primary" id="btn-stats-close">閉じる</button>
    `;

    this.modal.footerEl.querySelector('#btn-stats-close').addEventListener('click', () => {
      this.modal.close();
    });

    this.modal.bodyEl.addEventListener('input', (e) => {
      if (e.target.id === 'stats-query-input') {
        this.customQuery = e.target.value;
        this._renderQueryResult();
      }
    });
  }

  open() {
    this.modal.open();
  }

  render() {
    const data = this.service.analyze(this.store.state.text, this.customQuery);
    const { counts, charTypes, punctCounts, lineBreakdown } = data;

    const typeItems = [
      { label: '漢字', count: charTypes.kanji },
      { label: 'ひらがな', count: charTypes.hiragana },
      { label: '全角カタカナ', count: charTypes.katakana },
      { label: '半角カタカナ', count: charTypes.halfKana },
      { label: '全角英数字', count: charTypes.fullAlnum },
      { label: '半角英数字', count: charTypes.halfAlnum },
      { label: '約物・記号', count: charTypes.punctuationAndSymbols },
      { label: '空白（全/半）', count: charTypes.whitespace },
    ];
    const totalTyped = Math.max(
      1,
      typeItems.reduce((sum, item) => sum + item.count, 0) + charTypes.other
    );

    const typeBarsHtml = typeItems
      .map((item) => {
        const pct = ((item.count / totalTyped) * 100).toFixed(1);
        return `
          <div class="stat-bar-row">
            <span class="stat-bar-label">${escapeHtml(item.label)}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>
            <span class="stat-bar-val">${item.count.toLocaleString()} (${pct}%)</span>
          </div>
        `;
      })
      .join('');

    const punctHtml = Object.entries(punctCounts)
      .map(
        ([ch, cnt]) =>
          `<div class="punct-chip"><code>${escapeHtml(ch)}</code><span>${cnt.toLocaleString()}</span></div>`
      )
      .join('');

    this.modal.bodyEl.innerHTML = `
      <div class="stats-cards">
        <div class="stat-card">
          <div class="stat-card-num">${counts.withoutBreaks.toLocaleString()}</div>
          <div class="stat-card-label">総文字数（改行除く）</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num">${counts.withoutSpacesAndBreaks.toLocaleString()}</div>
          <div class="stat-card-label">正味文字数（空白・改行除く）</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num">${counts.manuscriptPages.toLocaleString()} 枚</div>
          <div class="stat-card-label">400字詰原稿用紙換算</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num">${lineBreakdown.dialogueLines} / ${lineBreakdown.narrativeLines}</div>
          <div class="stat-card-label">会話行 / 地の文行</div>
        </div>
      </div>

      <div class="stats-section">
        <h3 class="sub-heading">特定文字列の出現回数集計</h3>
        <div class="stats-query-row">
          <input type="text" id="stats-query-input" value="${escapeHtml(this.customQuery)}" placeholder="数えたい語句や記号を入力（例: 彼、しかし、……）" />
        </div>
        <div id="stats-query-result" class="stats-query-result"></div>
      </div>

      <div class="stats-section">
        <h3 class="sub-heading">使用文字種の構成比</h3>
        <div class="stat-bars">${typeBarsHtml}</div>
      </div>

      <div class="stats-section">
        <h3 class="sub-heading">主要約物・記号の使用頻度</h3>
        <div class="punct-grid">${punctHtml}</div>
      </div>
    `;

    this._renderQueryResult();
  }

  _renderQueryResult() {
    const box = this.modal.bodyEl.querySelector('#stats-query-result');
    if (!box) return;
    if (!this.customQuery) {
      box.textContent = '語句を入力すると出現回数と該当行番号を表示します。';
      return;
    }
    const res = this.service.countOccurrences(this.store.state.text, this.customQuery);
    const linesStr = res.lines.length > 0 ? `（出現行: ${res.lines.join(', ')}行目${res.lines.length >= 50 ? '…' : ''}）` : '';
    box.innerHTML = `「<strong>${escapeHtml(res.query)}</strong>」の出現回数: <strong>${res.count}回</strong> ${escapeHtml(linesStr)}`;
  }
}
