import { RULE_CATEGORIES } from '../config/constants.js';

/**
 * 校正ルールの登録・参照・設定スキーマ管理を行うプラグインレジストリ。
 * 新しいルールは register() で登録するだけでUI・エンジン双方に自動認識される。
 */
export class RuleRegistry {
  constructor() {
    /** @type {Map<string, RuleDefinition>} */
    this.rules = new Map();
    /** @type {string[]} */
    this.order = [];
  }

  /**
   * 単一の校正ルールを登録する
   * @param {RuleDefinition} rule
   */
  register(rule) {
    if (!rule || !rule.id || typeof rule.check !== 'function') {
      throw new Error(`Invalid rule definition: ${rule?.id || 'unknown'}`);
    }
    if (this.rules.has(rule.id)) {
      throw new Error(`Duplicate ruleId: ${rule.id}`);
    }
    const normalized = {
      defaultEnabled: true,
      defaultSeverity: 'warning',
      defaultOptions: {},
      optionSchema: [],
      description: '',
      ...rule,
    };
    this.rules.set(normalized.id, normalized);
    this.order.push(normalized.id);
  }

  /**
   * 複数の校正ルールをまとめて登録する
   * @param {RuleDefinition[]} ruleList
   */
  registerMany(ruleList) {
    for (const rule of ruleList) {
      this.register(rule);
    }
  }

  /**
   * ID でルールを取得する
   * @param {string} ruleId
   * @returns {RuleDefinition | undefined}
   */
  get(ruleId) {
    return this.rules.get(ruleId);
  }

  /**
   * 登録されている全ルールを取得する
   * @returns {RuleDefinition[]}
   */
  getAll() {
    return this.order.map((id) => this.rules.get(id));
  }

  /**
   * カテゴリ別にグループ化したルール一覧を返す
   * @returns {{ category: { id: string, name: string, order: number }, rules: RuleDefinition[] }[]}
   */
  getGroupedByCategory() {
    const groups = new Map();
    for (const cat of RULE_CATEGORIES) {
      groups.set(cat.id, { category: cat, rules: [] });
    }
    for (const rule of this.getAll()) {
      if (!groups.has(rule.category)) {
        groups.set(rule.category, {
          category: { id: rule.category, name: rule.category, order: 99 },
          rules: [],
        });
      }
      groups.get(rule.category).rules.push(rule);
    }
    return [...groups.values()].filter((g) => g.rules.length > 0);
  }

  /**
   * 全ルールのデフォルト設定マップを作成する
   * @returns {Record<string, { enabled: boolean, severity: 'error'|'warning', options: Record<string, any> }>}
   */
  createDefaultSettings() {
    const settings = {};
    for (const rule of this.getAll()) {
      settings[rule.id] = {
        enabled: rule.defaultEnabled,
        severity: rule.defaultSeverity,
        options: { ...rule.defaultOptions },
      };
    }
    return settings;
  }

  /**
   * 既存設定に不足している新規ルールやオプションを補完する
   * @param {Record<string, any>} savedSettings
   * @returns {Record<string, { enabled: boolean, severity: 'error'|'warning', options: Record<string, any> }>}
   */
  mergeSettings(savedSettings = {}) {
    const merged = this.createDefaultSettings();
    for (const rule of this.getAll()) {
      const saved = savedSettings[rule.id];
      if (!saved || typeof saved !== 'object') continue;
      merged[rule.id] = {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : rule.defaultEnabled,
        severity: saved.severity === 'error' || saved.severity === 'warning' ? saved.severity : rule.defaultSeverity,
        options: {
          ...rule.defaultOptions,
          ...(saved.options && typeof saved.options === 'object' ? saved.options : {}),
        },
      };
    }
    return merged;
  }
}

/**
 * @typedef {Object} RuleOptionField
 * @property {string} key
 * @property {string} label
 * @property {'select'|'number'|'boolean'|'text'} type
 * @property {{ value: any, label: string }[]} [choices]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} [placeholder]
 */

/**
 * @typedef {Object} RuleDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {string} description
 * @property {'error'|'warning'} [defaultSeverity]
 * @property {boolean} [defaultEnabled]
 * @property {Record<string, any>} [defaultOptions]
 * @property {RuleOptionField[]} [optionSchema]
 * @property {(context: any, options: Record<string, any>) => any[]} check
 */
