import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_LATEX_OPTIONS,
} from '../config/constants.js';
import { DEFAULT_VARIANT_GROUPS } from '../config/defaultVariants.js';
import { SAMPLE_MANUSCRIPT } from '../config/sampleText.js';
import { getSymbolTransform } from '../services/VariantService.js';
import { createId, normalizeLineEndings } from '../utils/textUtils.js';

/**
 * アプリケーション状態を一元管理し、永続化・履歴・校正エンジンを調停するストア
 */
export class Store {
  /**
   * @param {object} deps
   * @param {import('./EventBus.js').EventBus} deps.bus
   * @param {import('./RuleRegistry.js').RuleRegistry} deps.registry
   * @param {import('./HistoryManager.js').HistoryManager} deps.history
   * @param {import('./IgnoreManager.js').IgnoreManager} deps.ignores
   * @param {import('./ProofreadEngine.js').ProofreadEngine} deps.engine
   * @param {import('../services/StorageService.js').StorageService} deps.storage
   */
  constructor({ bus, registry, history, ignores, engine, storage }) {
    this.bus = bus;
    this.registry = registry;
    this.history = history;
    this.ignores = ignores;
    this.engine = engine;
    this.storage = storage;

    this.state = {
      text: '',
      rawText: '',
      fileName: 'sample.txt',
      hasUnsavedChanges: false,
      lastSavedAt: null,
      ruleSettings: {},
      displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
      variantGroups: [],
      latexOptions: { ...DEFAULT_LATEX_OPTIONS },
      issues: [],
      resolvedIssues: [],
      lastRunDurationMs: 0,
      activeIssueId: null,
      filters: {
        severity: 'all',
        status: 'unhandled', // 'unhandled' | 'ignored' | 'resolved' | 'all'
        category: 'all',
        ruleId: 'all',
        search: '',
      },
    };
  }

  /**
   * LocalStorage から状態を復元し、初期校正を実行する
   */
  init() {
    const savedRuleSettings = this.storage.loadRuleSettings();
    this.state.ruleSettings = this.registry.mergeSettings(savedRuleSettings || {});
    // 旧初期値(250文字)を保持していた環境は新初期値(500文字)へ移行する
    if (this.state.ruleSettings['para.max-length']?.options?.maxChars === 250) {
      this.state.ruleSettings['para.max-length'].options.maxChars = 500;
      this.storage.saveRuleSettings(this.state.ruleSettings);
    }

    const savedDisplay = this.storage.loadDisplaySettings();
    this.state.displaySettings = {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...(savedDisplay || {}),
    };

    const savedVariants = this.storage.loadVariantGroups();
    if (Array.isArray(savedVariants) && savedVariants.length > 0) {
      const removedIds = new Set([
        'var_mono',
        'var_naku',
        'var_hayai',
        'var_atatakai',
        'var_soko',
        'var_koko',
      ]);
      let migrated = false;
      const filtered = savedVariants
        .filter((g) => {
          if (!g || removedIds.has(g.id)) {
            migrated = true;
            return false;
          }
          return true;
        })
        .map((g) => {
          if (g.id === 'var_teshimau' && Array.isArray(g.terms) && g.terms.includes('ってしまう')) {
            migrated = true;
            return { ...g, label: 'て仕舞う / てしまう', terms: ['て仕舞う', 'てしまう'] };
          }
          if (
            g.id === 'var_yappari' &&
            Array.isArray(g.terms) &&
            g.terms.includes('やっぱり') &&
            g.terms.includes('やはり')
          ) {
            migrated = true;
            return { ...g, label: '矢張り / やはり', terms: ['矢張り', 'やはり'] };
          }
          return g;
        });
      const existingIds = new Set(filtered.map((g) => g.id));
      const added = DEFAULT_VARIANT_GROUPS.filter((g) => !existingIds.has(g.id)).map((g) => ({
        ...g,
        terms: [...g.terms],
      }));
      this.state.variantGroups = [...filtered, ...added];
      if (migrated || added.length > 0) {
        this.storage.saveVariantGroups(this.state.variantGroups);
      }
    } else {
      this.state.variantGroups = DEFAULT_VARIANT_GROUPS.map((g) => ({ ...g, terms: [...g.terms] }));
    }

    const savedLatex = this.storage.loadLatexOptions();
    this.state.latexOptions = {
      ...DEFAULT_LATEX_OPTIONS,
      ...(savedLatex || {}),
    };

    const savedIgnores = this.storage.loadIgnores();
    this.ignores.load(savedIgnores);

    const autosave = this.storage.loadAutosave();
    if (autosave && typeof autosave.text === 'string') {
      this.state.text = normalizeLineEndings(autosave.text);
      this.state.rawText = typeof autosave.rawText === 'string' ? autosave.rawText : this.state.text;
      this.state.fileName = autosave.fileName || 'untitled.txt';
      this.state.hasUnsavedChanges = Boolean(autosave.hasUnsavedChanges);
      this.state.lastSavedAt = autosave.savedAt || null;
    } else {
      this.state.text = normalizeLineEndings(SAMPLE_MANUSCRIPT);
      this.state.rawText = this.state.text;
      this.state.fileName = 'sample.txt';
      this.state.hasUnsavedChanges = false;
    }

    this.history.reset(this.state.text);
    this.runProofreadNow();
    this.bus.emit('state:initialized', this.state);
  }

  /**
   * テキスト変更を反映し、自動保存・履歴記録・校正スケジューリングを行う
   * @param {string} nextText
   * @param {object} [meta]
   */
  setText(nextText, meta = {}) {
    const normalized = normalizeLineEndings(nextText);
    const changed = this.history.record(normalized, meta);
    if (!changed && normalized === this.state.text) return;

    this.state.text = normalized;
    this.state.rawText = normalized;
    this.state.hasUnsavedChanges = true;
    this._persistAutosave();
    this.bus.emit('text:changed', {
      text: this.state.text,
      source: meta.source || 'typing',
    });

    if (meta.immediate) {
      this.runProofreadNow();
    } else {
      this.engine.schedule(
        {
          text: this.state.text,
          rawText: this.state.rawText,
          ruleSettings: this.state.ruleSettings,
          variantGroups: this.state.variantGroups,
          display: this.state.displaySettings,
        },
        (result) => this._applyProofreadResult(result)
      );
    }
  }

  /**
   * 新規ファイル・サンプル読込時に原稿を差し替える
   * @param {{ text: string, rawText?: string, fileName?: string, resetIgnores?: boolean }} doc
   */
  loadDocument({ text, rawText, fileName = 'untitled.txt', resetIgnores = false }) {
    this.engine.cancelScheduled();
    const normalized = normalizeLineEndings(text);
    this.state.text = normalized;
    this.state.rawText = typeof rawText === 'string' ? rawText : text;
    this.state.fileName = fileName;
    this.state.hasUnsavedChanges = false;
    this.state.resolvedIssues = [];
    this.state.activeIssueId = null;

    if (resetIgnores) {
      this.ignores.clear();
      this.storage.saveIgnores(this.ignores.serialize());
    }

    this.history.reset(normalized);
    this._persistAutosave();
    this.bus.emit('document:loaded', {
      text: normalized,
      fileName,
    });
    this.runProofreadNow();
  }

  /**
   * 即座に校正を実行して結果を更新する
   */
  runProofreadNow() {
    this.engine.cancelScheduled();
    const result = this.engine.runNow({
      text: this.state.text,
      rawText: this.state.rawText,
      ruleSettings: this.state.ruleSettings,
      variantGroups: this.state.variantGroups,
      display: this.state.displaySettings,
    });
    this._applyProofreadResult(result);
  }

  _applyProofreadResult({ issues, durationMs }) {
    this.state.issues = issues;
    this.state.lastRunDurationMs = durationMs;
    if (
      this.state.activeIssueId &&
      !issues.some((i) => i.id === this.state.activeIssueId)
    ) {
      this.state.activeIssueId = null;
    }
    this.storage.saveIgnores(this.ignores.serialize());
    this.bus.emit('issues:updated', {
      issues,
      durationMs,
    });
  }

  /**
   * 単一指摘に対して修正候補を適用する
   * @param {string} issueId
   * @param {string} replacement
   */
  applySuggestion(issueId, replacement) {
    const issue = this.state.issues.find((i) => i.id === issueId);
    if (!issue) return false;

    const currentSlice = this.state.text.slice(issue.start, issue.end);
    if (currentSlice !== issue.matchedText) {
      // オフセットずれ防止のため最新化
      this.runProofreadNow();
      return false;
    }

    const nextText =
      this.state.text.slice(0, issue.start) +
      replacement +
      this.state.text.slice(issue.end);
    const caretPos = issue.start + replacement.length;

    this.state.resolvedIssues.unshift({
      id: createId('res'),
      ruleId: issue.ruleId,
      ruleName: issue.ruleName,
      category: issue.category,
      severity: issue.severity,
      message: issue.message,
      originalText: issue.matchedText,
      replacement,
      line: issue.line,
      column: issue.column,
      fixedAt: new Date().toISOString(),
    });
    if (this.state.resolvedIssues.length > 300) {
      this.state.resolvedIssues.length = 300;
    }

    this.setText(nextText, {
      source: 'fix',
      label: `修正: ${issue.ruleName}`,
      selectionStart: caretPos,
      selectionEnd: caretPos,
      prevSelectionStart: issue.start,
      prevSelectionEnd: issue.end,
      immediate: true,
    });

    this.bus.emit('editor:restore-selection', {
      start: caretPos,
      end: caretPos,
    });
    return true;
  }

  /**
   * 表記揺れ一括置換などのテキスト変更を1トランザクションとして適用する
   * @param {string} nextText
   * @param {string} label
   */
  applyBatchTextChange(nextText, label = '一括置換') {
    this.setText(nextText, {
      source: 'batch',
      label,
      selectionStart: 0,
      selectionEnd: 0,
      immediate: true,
    });
    this.bus.emit('editor:restore-selection', { start: 0, end: 0 });
  }

  /**
   * Undo を実行する
   */
  undo() {
    const prev = this.history.undo();
    if (!prev) return false;
    this.engine.cancelScheduled();
    this.state.text = prev.text;
    this.state.rawText = prev.text;
    this.state.hasUnsavedChanges = true;
    this._persistAutosave();
    this.bus.emit('text:changed', { text: prev.text, source: 'undo' });
    this.bus.emit('editor:restore-selection', {
      start: prev.selectionStart,
      end: prev.selectionEnd,
    });
    this.runProofreadNow();
    return true;
  }

  /**
   * Redo を実行する
   */
  redo() {
    const next = this.history.redo();
    if (!next) return false;
    this.engine.cancelScheduled();
    this.state.text = next.text;
    this.state.rawText = next.text;
    this.state.hasUnsavedChanges = true;
    this._persistAutosave();
    this.bus.emit('text:changed', { text: next.text, source: 'redo' });
    this.bus.emit('editor:restore-selection', {
      start: next.selectionStart,
      end: next.selectionEnd,
    });
    this.runProofreadNow();
    return true;
  }

  /**
   * 個別の指摘を無視する。表記揺れ指摘を無視した場合は「こと」等他方への影響を再評価するため再検査する。
   * @param {string} issueId
   */
  ignoreIssue(issueId) {
    const issue = this.state.issues.find((i) => i.id === issueId);
    if (!issue) return;
    this.ignores.ignoreIssue(issue, this.state.text);
    this._afterIgnoreChanged(issue.ruleId);
  }

  /**
   * 個別の無視を解除する
   * @param {string} issueId
   */
  unignoreIssue(issueId) {
    const issue = this.state.issues.find((i) => i.id === issueId);
    if (!issue) return;
    this.ignores.unignoreIssue(issue, this.state.text);
    this._afterIgnoreChanged(issue.ruleId);
  }

  /**
   * 複数の表記揺れ出現箇所をまとめて無視する
   * @param {{ start: number, end: number, term: string }[]} occurrences
   */
  ignoreVariantOccurrences(occurrences) {
    for (const occ of occurrences) {
      this.ignores.ignoreIssue(
        {
          ruleId: 'variant.inconsistency',
          start: occ.start,
          end: occ.end,
          matchedText: occ.term,
        },
        this.state.text
      );
    }
    this.storage.saveIgnores(this.ignores.serialize());
    this.runProofreadNow();
  }

  /**
   * 複数の表記揺れ出現箇所の無視をまとめて解除する
   * @param {{ start: number, end: number, term: string }[]} occurrences
   */
  unignoreVariantOccurrences(occurrences) {
    for (const occ of occurrences) {
      this.ignores.unignoreIssue(
        {
          ruleId: 'variant.inconsistency',
          start: occ.start,
          end: occ.end,
          matchedText: occ.term,
        },
        this.state.text
      );
    }
    this.storage.saveIgnores(this.ignores.serialize());
    this.runProofreadNow();
  }

  /**
   * 表記揺れグループ全体を一括で無視する
   * @param {string} groupId
   */
  ignoreVariantGroup(groupId) {
    this.ignores.ignoreVariantGroup(groupId);
    this.storage.saveIgnores(this.ignores.serialize());
    this.runProofreadNow();
  }

  /**
   * 表記揺れグループ単位の無視を解除する
   * @param {string} groupId
   */
  unignoreVariantGroup(groupId) {
    this.ignores.unignoreVariantGroup(groupId);
    this.storage.saveIgnores(this.ignores.serialize());
    this.runProofreadNow();
  }

  /**
   * 記号・文字種の一括統一変換（すべて全角チルダにする等）を実行する（1回の Undo で復元可能）
   * @param {string} transformId
   * @returns {boolean}
   */
  runSymbolTransform(transformId) {
    const transform = getSymbolTransform(transformId);
    if (!transform) return false;

    if (transform.ruleSettingPatch) {
      const { ruleId, options } = transform.ruleSettingPatch;
      const cur = this.state.ruleSettings[ruleId];
      if (cur) {
        this.state.ruleSettings[ruleId] = {
          ...cur,
          options: { ...cur.options, ...options },
        };
        this.storage.saveRuleSettings(this.state.ruleSettings);
        this.bus.emit('settings:updated', this.state.ruleSettings);
      }
    }

    const nextText = transform.apply(this.state.text);
    if (nextText !== this.state.text) {
      this.applyBatchTextChange(nextText, transform.label);
    } else {
      this.runProofreadNow();
    }
    return true;
  }

  /**
   * 同一ルールの指摘をすべて無視する
   * @param {string} ruleId
   */
  ignoreRule(ruleId) {
    this.ignores.ignoreRule(ruleId);
    this._refreshIgnoreFlags();
  }

  /**
   * ルール単位の無視を解除する
   * @param {string} ruleId
   */
  unignoreRule(ruleId) {
    this.ignores.unignoreRule(ruleId);
    this._refreshIgnoreFlags();
  }

  _afterIgnoreChanged(ruleId) {
    if (ruleId === 'variant.inconsistency') {
      this.storage.saveIgnores(this.ignores.serialize());
      this.runProofreadNow();
      return;
    }
    this._refreshIgnoreFlags();
  }

  _refreshIgnoreFlags() {
    this.state.issues = this.ignores.applyIgnoreFlags(this.state.issues, this.state.text);
    this.storage.saveIgnores(this.ignores.serialize());
    this.bus.emit('issues:updated', {
      issues: this.state.issues,
      durationMs: this.state.lastRunDurationMs,
    });
  }

  /**
   * ルール設定を更新する
   * @param {string} ruleId
   * @param {object} patch
   */
  updateRuleSetting(ruleId, patch) {
    const cur = this.state.ruleSettings[ruleId];
    if (!cur) return;
    this.state.ruleSettings[ruleId] = {
      ...cur,
      ...patch,
      options: patch.options ? { ...cur.options, ...patch.options } : cur.options,
    };
    this.storage.saveRuleSettings(this.state.ruleSettings);
    this.bus.emit('settings:updated', this.state.ruleSettings);
    this.runProofreadNow();
  }

  /**
   * 全ルール設定を初期値へ戻す
   */
  resetRuleSettings() {
    this.state.ruleSettings = this.registry.createDefaultSettings();
    this.storage.saveRuleSettings(this.state.ruleSettings);
    this.bus.emit('settings:updated', this.state.ruleSettings);
    this.runProofreadNow();
  }

  /**
   * 表示設定を更新する
   * @param {object} patch
   */
  updateDisplaySettings(patch) {
    const prevWritingMode = this.state.displaySettings.writingMode;
    this.state.displaySettings = {
      ...this.state.displaySettings,
      ...patch,
    };
    this.storage.saveDisplaySettings(this.state.displaySettings);
    this.bus.emit('display:updated', this.state.displaySettings);
    // 縦書き/横書き切替時は縦書き専用ルールの挙動が変わる可能性があるため再検査
    if (patch.writingMode && patch.writingMode !== prevWritingMode) {
      this.runProofreadNow();
    }
  }

  /**
   * 表記揺れ辞書を更新する
   * @param {any[]} groups
   */
  updateVariantGroups(groups) {
    this.state.variantGroups = groups.map((g) => ({ ...g, terms: [...g.terms] }));
    this.storage.saveVariantGroups(this.state.variantGroups);
    this.bus.emit('variants:updated', this.state.variantGroups);
    this.runProofreadNow();
  }

  /**
   * LaTeX 出力設定を更新する
   * @param {object} patch
   */
  updateLatexOptions(patch) {
    this.state.latexOptions = {
      ...this.state.latexOptions,
      ...patch,
    };
    this.storage.saveLatexOptions(this.state.latexOptions);
  }

  /**
   * 指摘フィルタを更新する
   * @param {object} patch
   */
  setFilters(patch) {
    this.state.filters = {
      ...this.state.filters,
      ...patch,
    };
    this.bus.emit('filters:updated', this.state.filters);
  }

  /**
   * 選択中指摘を設定する
   * @param {string | null} issueId
   */
  setActiveIssue(issueId) {
    this.state.activeIssueId = issueId;
    this.bus.emit('issue:selected', issueId);
  }

  /**
   * フィルタ条件に合致する指摘配列を返す
   */
  getFilteredIssues() {
    const { severity, status, category, ruleId, search } = this.state.filters;
    const query = search.trim().toLowerCase();

    if (status === 'resolved') {
      return this.state.resolvedIssues.filter((item) => {
        if (severity !== 'all' && item.severity !== severity) return false;
        if (category !== 'all' && item.category !== category) return false;
        if (ruleId !== 'all' && item.ruleId !== ruleId) return false;
        if (
          query &&
          !item.message.toLowerCase().includes(query) &&
          !item.originalText.toLowerCase().includes(query) &&
          !item.ruleName.toLowerCase().includes(query)
        ) {
          return false;
        }
        return true;
      });
    }

    return this.state.issues.filter((issue) => {
      if (status === 'unhandled' && issue.ignored) return false;
      if (status === 'ignored' && !issue.ignored) return false;
      if (severity !== 'all' && issue.severity !== severity) return false;
      if (category !== 'all' && issue.category !== category) return false;
      if (ruleId !== 'all' && issue.ruleId !== ruleId) return false;
      if (
        query &&
        !issue.message.toLowerCase().includes(query) &&
        !issue.matchedText.toLowerCase().includes(query) &&
        !issue.ruleName.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }

  /**
   * 未対応・重要度別・無視・修正済みの件数サマリを返す
   */
  getIssueCounts() {
    let unhandled = 0;
    let errorCount = 0;
    let warningCount = 0;
    let ignoredCount = 0;

    for (const issue of this.state.issues) {
      if (issue.ignored) {
        ignoredCount++;
      } else {
        unhandled++;
        if (issue.severity === 'error') errorCount++;
        else warningCount++;
      }
    }

    return {
      total: this.state.issues.length,
      unhandled,
      errorCount,
      warningCount,
      ignoredCount,
      resolvedCount: this.state.resolvedIssues.length,
    };
  }

  /**
   * プロジェクトJSONデータを書き出すためのスナップショットを生成する
   */
  exportProject() {
    return this.storage.buildProjectPayload({
      fileName: this.state.fileName,
      text: this.state.text,
      ruleSettings: this.state.ruleSettings,
      displaySettings: this.state.displaySettings,
      variantGroups: this.state.variantGroups,
      ignores: this.ignores.serialize(),
      latexOptions: this.state.latexOptions,
    });
  }

  /**
   * プロジェクトJSONデータからアプリ全体を復元する
   * @param {object} data
   */
  importProject(data) {
    if (data.ruleSettings) {
      this.state.ruleSettings = this.registry.mergeSettings(data.ruleSettings);
      this.storage.saveRuleSettings(this.state.ruleSettings);
    }
    if (data.displaySettings) {
      this.state.displaySettings = {
        ...DEFAULT_DISPLAY_SETTINGS,
        ...data.displaySettings,
      };
      this.storage.saveDisplaySettings(this.state.displaySettings);
      this.bus.emit('display:updated', this.state.displaySettings);
    }
    if (Array.isArray(data.variantGroups)) {
      this.state.variantGroups = data.variantGroups;
      this.storage.saveVariantGroups(this.state.variantGroups);
    }
    if (data.latexOptions) {
      this.state.latexOptions = { ...DEFAULT_LATEX_OPTIONS, ...data.latexOptions };
      this.storage.saveLatexOptions(this.state.latexOptions);
    }
    this.ignores.load(data.ignores || null);
    this.storage.saveIgnores(this.ignores.serialize());

    this.loadDocument({
      text: data.text,
      rawText: data.text,
      fileName: data.fileName || 'project.txt',
      resetIgnores: false,
    });
    this.bus.emit('settings:updated', this.state.ruleSettings);
  }

  /**
   * 保存完了時に未保存フラグを解除する
   * @param {string} [fileName]
   */
  markSaved(fileName) {
    if (fileName) {
      this.state.fileName = fileName;
    }
    this.state.hasUnsavedChanges = false;
    this._persistAutosave();
    this.bus.emit('document:saved', { fileName: this.state.fileName });
  }

  _persistAutosave() {
    this.state.lastSavedAt = new Date().toISOString();
    this.storage.saveAutosave({
      fileName: this.state.fileName,
      text: this.state.text,
      rawText: this.state.rawText,
      hasUnsavedChanges: this.state.hasUnsavedChanges,
    });
    this.bus.emit('autosave:updated', {
      savedAt: this.state.lastSavedAt,
      hasUnsavedChanges: this.state.hasUnsavedChanges,
    });
  }
}
