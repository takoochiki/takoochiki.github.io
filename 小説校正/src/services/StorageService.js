import { STORAGE_KEYS } from '../config/constants.js';

/**
 * LocalStorage の自動保存・設定永続化・TXT/JSONプロジェクトファイル入出力を担当する
 */
export class StorageService {
  /**
   * LocalStorage から JSON を安全に読み込む
   * @param {string} key
   * @param {*} fallback
   */
  loadJson(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  /**
   * LocalStorage へ JSON を安全に保存する
   * @param {string} key
   * @param {*} value
   */
  saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[StorageService] Failed to save to localStorage:', err);
      return false;
    }
  }

  loadAutosave() {
    return this.loadJson(STORAGE_KEYS.AUTOSAVE, null);
  }

  saveAutosave(data) {
    return this.saveJson(STORAGE_KEYS.AUTOSAVE, {
      ...data,
      savedAt: new Date().toISOString(),
    });
  }

  loadRuleSettings() {
    return this.loadJson(STORAGE_KEYS.SETTINGS, null);
  }

  saveRuleSettings(settings) {
    return this.saveJson(STORAGE_KEYS.SETTINGS, settings);
  }

  loadDisplaySettings() {
    return this.loadJson(STORAGE_KEYS.DISPLAY, null);
  }

  saveDisplaySettings(display) {
    return this.saveJson(STORAGE_KEYS.DISPLAY, display);
  }

  loadVariantGroups() {
    return this.loadJson(STORAGE_KEYS.VARIANTS, null);
  }

  saveVariantGroups(groups) {
    return this.saveJson(STORAGE_KEYS.VARIANTS, groups);
  }

  loadIgnores() {
    return this.loadJson(STORAGE_KEYS.IGNORES, null);
  }

  saveIgnores(ignoreData) {
    return this.saveJson(STORAGE_KEYS.IGNORES, ignoreData);
  }

  loadLatexOptions() {
    return this.loadJson(STORAGE_KEYS.LATEX_OPTIONS, null);
  }

  saveLatexOptions(options) {
    return this.saveJson(STORAGE_KEYS.LATEX_OPTIONS, options);
  }

  /**
   * File オブジェクトを UTF-8 として読み込む（BOM 検知のため生のテキストも保持）
   * @param {File} file
   * @returns {Promise<{ name: string, rawText: string }>}
   */
  async readTextFile(file) {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const rawText = decoder.decode(buffer);
    return { name: file.name, rawText };
  }

  /**
   * テキストファイルまたはJSONファイルをダウンロード保存する
   * @param {string} filename
   * @param {string} content
   * @param {string} mimeType
   */
  downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * プロジェクトデータ(JSON)を構築する
   * @param {object} state
   */
  buildProjectPayload(state) {
    return {
      schemaVersion: 1,
      app: 'novel-proofreader',
      exportedAt: new Date().toISOString(),
      fileName: state.fileName,
      text: state.text,
      ruleSettings: state.ruleSettings,
      displaySettings: state.displaySettings,
      variantGroups: state.variantGroups,
      ignores: state.ignores,
      latexOptions: state.latexOptions,
    };
  }

  /**
   * プロジェクトJSON文字列を検証・パースする
   * @param {string} jsonStr
   */
  parseProjectPayload(jsonStr) {
    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== 'object' || typeof data.text !== 'string') {
      throw new Error('無効なプロジェクトファイル形式です（原稿テキストが含まれていません）。');
    }
    return data;
  }
}
