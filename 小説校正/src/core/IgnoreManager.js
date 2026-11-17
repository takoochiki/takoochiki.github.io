import { createId } from '../utils/textUtils.js';

const CONTEXT_LEN = 12;

/**
 * 無視された指摘・無視されたルールを管理し、編集後も可能な限り無視状態を追跡する。
 */
export class IgnoreManager {
  constructor() {
    /** @type {{ id: string, ruleId: string, matchedText: string, prefix: string, suffix: string, start: number, end: number }[]} */
    this.items = [];
    /** @type {Set<string>} */
    this.ignoredRuleIds = new Set();
  }

  /**
   * 永続化データから復元する
   * @param {{ items?: any[], ignoredRuleIds?: string[] } | null} data
   */
  load(data) {
    if (!data || typeof data !== 'object') {
      this.clear();
      return;
    }
    this.items = Array.isArray(data.items)
      ? data.items.map((item) => ({
          id: String(item.id || createId('ign')),
          ruleId: String(item.ruleId || ''),
          matchedText: String(item.matchedText || ''),
          prefix: String(item.prefix || ''),
          suffix: String(item.suffix || ''),
          start: Number(item.start || 0),
          end: Number(item.end || 0),
        }))
      : [];
    this.ignoredRuleIds = new Set(Array.isArray(data.ignoredRuleIds) ? data.ignoredRuleIds : []);
  }

  /**
   * 永続化・プロジェクト保存用にシリアライズする
   * @returns {{ items: any[], ignoredRuleIds: string[] }}
   */
  serialize() {
    return {
      items: this.items.map((item) => ({ ...item })),
      ignoredRuleIds: [...this.ignoredRuleIds],
    };
  }

  clear() {
    this.items = [];
    this.ignoredRuleIds = new Set();
  }

  /**
   * 指摘を個別に無視リストへ追加する
   * @param {{ ruleId: string, start: number, end: number, matchedText?: string }} issue
   * @param {string} text
   */
  ignoreIssue(issue, text) {
    const matchedText = issue.matchedText ?? text.slice(issue.start, issue.end);
    const prefix = text.slice(Math.max(0, issue.start - CONTEXT_LEN), issue.start);
    const suffix = text.slice(issue.end, Math.min(text.length, issue.end + CONTEXT_LEN));

    const existing = this.items.find(
      (item) =>
        item.ruleId === issue.ruleId &&
        item.matchedText === matchedText &&
        item.start === issue.start &&
        item.end === issue.end
    );
    if (existing) return;

    this.items.push({
      id: createId('ign'),
      ruleId: issue.ruleId,
      matchedText,
      prefix,
      suffix,
      start: issue.start,
      end: issue.end,
    });
  }

  /**
   * 同一ルールの指摘をまとめて無視する
   * @param {string} ruleId
   */
  ignoreRule(ruleId) {
    this.ignoredRuleIds.add(ruleId);
  }

  /**
   * ルール単位の無視を解除する
   * @param {string} ruleId
   */
  unignoreRule(ruleId) {
    this.ignoredRuleIds.delete(ruleId);
  }

  /**
   * 個別の無視を解除する
   * @param {{ ruleId: string, start: number, end: number, matchedText?: string }} issue
   * @param {string} text
   */
  unignoreIssue(issue, text) {
    if (this.ignoredRuleIds.has(issue.ruleId)) {
      this.ignoredRuleIds.delete(issue.ruleId);
    }
    const matched = this.findMatchingEntry(issue, text);
    if (matched) {
      this.items = this.items.filter((item) => item.id !== matched.id);
    }
  }

  /**
   * 指摘が無視状態かどうかを判定し、一致エントリを返す
   * @param {{ ruleId: string, start: number, end: number, matchedText?: string }} issue
   * @param {string} text
   * @returns {object | null}
   */
  findMatchingEntry(issue, text) {
    const matchedText = issue.matchedText ?? text.slice(issue.start, issue.end);
    const prefix = text.slice(Math.max(0, issue.start - CONTEXT_LEN), issue.start);
    const suffix = text.slice(issue.end, Math.min(text.length, issue.end + CONTEXT_LEN));

    let bestEntry = null;
    let bestScore = -1;

    for (const entry of this.items) {
      if (entry.ruleId !== issue.ruleId) continue;
      if (entry.matchedText !== matchedText) continue;

      let score = 0;
      if (entry.prefix === prefix && entry.suffix === suffix) {
        score += 100;
      } else if (
        (entry.prefix && prefix.endsWith(entry.prefix.slice(-6))) ||
        (entry.suffix && suffix.startsWith(entry.suffix.slice(0, 6)))
      ) {
        score += 50;
      }

      if (entry.start === issue.start && entry.end === issue.end) {
        score += 40;
      } else {
        const dist = Math.abs(entry.start - issue.start);
        if (dist <= 300) {
          score += Math.max(0, 30 - Math.floor(dist / 10));
        }
      }

      if (score >= 40 && score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  /**
   * 校正結果一覧に対して無視フラグを付与し、位置を追跡更新する
   * @param {any[]} issues
   * @param {string} text
   * @returns {any[]}
   */
  applyIgnoreFlags(issues, text) {
    return issues.map((issue) => {
      if (this.ignoredRuleIds.has(issue.ruleId)) {
        return { ...issue, ignored: true };
      }
      const matched = this.findMatchingEntry(issue, text);
      if (matched) {
        // 最新の位置と前後文脈を更新し、連続編集にも追従できるようにする
        matched.start = issue.start;
        matched.end = issue.end;
        matched.prefix = text.slice(Math.max(0, issue.start - CONTEXT_LEN), issue.start);
        matched.suffix = text.slice(issue.end, Math.min(text.length, issue.end + CONTEXT_LEN));
        return { ...issue, ignored: true };
      }
      return { ...issue, ignored: false };
    });
  }
}
