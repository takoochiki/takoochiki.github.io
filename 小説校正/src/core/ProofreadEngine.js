import { RuleContext } from './RuleContext.js';

/**
 * デバウンス実行・全ルール評価・無視状態の統合を行う校正エンジン
 */
export class ProofreadEngine {
  /**
   * @param {import('./RuleRegistry.js').RuleRegistry} registry
   * @param {import('./IgnoreManager.js').IgnoreManager} ignoreManager
   */
  constructor(registry, ignoreManager) {
    this.registry = registry;
    this.ignoreManager = ignoreManager;
    this.timerId = null;
  }

  /**
   * テキストサイズに応じた適切なデバウンス遅延(ms)を返す（大規模原稿20万字対応）
   * @param {number} textLength
   * @returns {number}
   */
  getRecommendedDelay(textLength) {
    if (textLength > 150000) return 550;
    if (textLength > 50000) return 350;
    return 180;
  }

  /**
   * 予約中の校正タイマーをキャンセルする
   */
  cancelScheduled() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * デバウンス付きで校正を予約実行する
   * @param {object} params
   * @param {(result: { issues: any[], durationMs: number }) => void} onComplete
   * @param {number} [delayOverride]
   */
  schedule(params, onComplete, delayOverride) {
    this.cancelScheduled();
    const delay =
      typeof delayOverride === 'number'
        ? delayOverride
        : this.getRecommendedDelay((params.text || '').length);

    this.timerId = setTimeout(() => {
      this.timerId = null;
      const result = this.runNow(params);
      onComplete(result);
    }, delay);
  }

  /**
   * 即座に同期実行して全ルールの指摘結果を返す
   * @param {object} params
   * @param {string} params.text
   * @param {string} [params.rawText]
   * @param {Record<string, any>} params.ruleSettings
   * @param {any[]} [params.variantGroups]
   * @param {Record<string, any>} [params.display]
   * @returns {{ issues: any[], durationMs: number }}
   */
  runNow({ text, rawText, ruleSettings, variantGroups = [], display = {} }) {
    const startPerf = performance.now();
    const context = new RuleContext(text, {
      rawText,
      variantGroups,
      display,
      allSettings: ruleSettings,
      ignoreManager: this.ignoreManager,
    });

    const collected = [];
    const rules = this.registry.getAll();

    for (const rule of rules) {
      const setting = ruleSettings[rule.id] || {
        enabled: rule.defaultEnabled,
        severity: rule.defaultSeverity,
        options: { ...rule.defaultOptions },
      };

      if (!setting.enabled) continue;

      let ruleIssues = [];
      try {
        ruleIssues = rule.check(context, setting.options || {}) || [];
      } catch (err) {
        // 1ルールの例外で全体の校正を止めない
        console.error(`[ProofreadEngine] Rule "${rule.id}" threw an error:`, err);
        continue;
      }

      for (let i = 0; i < ruleIssues.length; i++) {
        const rawIssue = ruleIssues[i];
        if (!rawIssue) continue;
        const resolvedRuleId = rawIssue.ruleIdOverride || rule.id;
        const resolvedRuleName = rawIssue.ruleNameOverride || rule.name;
        const severity = rawIssue.severityOverride || setting.severity || rule.defaultSeverity;
        collected.push({
          id: `${resolvedRuleId}@${rawIssue.start}-${rawIssue.end}#${i}`,
          ruleId: resolvedRuleId,
          ruleName: resolvedRuleName,
          category: rule.category,
          start: rawIssue.start,
          end: rawIssue.end,
          line: rawIssue.line,
          column: rawIssue.column,
          severity,
          message: rawIssue.message,
          matchedText: rawIssue.matchedText,
          suggestions: Array.isArray(rawIssue.suggestions) ? rawIssue.suggestions : [],
          extra: rawIssue.extra || null,
          ignored: false,
        });
      }
    }

    collected.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      if (a.end !== b.end) return a.end - b.end;
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      return a.ruleId.localeCompare(b.ruleId);
    });

    const withIgnores = this.ignoreManager.applyIgnoreFlags(collected, context.text);
    const durationMs = Math.round((performance.now() - startPerf) * 10) / 10;
    return { issues: withIgnores, durationMs };
  }
}
