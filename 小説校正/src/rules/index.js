import { RuleRegistry } from '../core/RuleRegistry.js';
import { punctuationRules } from './categories/punctuation.js';
import { bracketRules } from './categories/brackets.js';
import { paragraphRules } from './categories/paragraph.js';
import { characterRules } from './categories/characters.js';
import { variantRules } from './categories/variants.js';
import { patternRules } from './categories/patterns.js';
import { rubyRules } from './categories/ruby.js';

/**
 * すべての校正ルールを登録した RuleRegistry インスタンスを生成する。
 * 新しいルールカテゴリを追加する場合はここに配列を追加するだけで拡張できる。
 * @returns {RuleRegistry}
 */
export function createDefaultRegistry() {
  const registry = new RuleRegistry();
  registry.registerMany(punctuationRules);
  registry.registerMany(bracketRules);
  registry.registerMany(paragraphRules);
  registry.registerMany(characterRules);
  registry.registerMany(variantRules);
  registry.registerMany(patternRules);
  registry.registerMany(rubyRules);
  return registry;
}
