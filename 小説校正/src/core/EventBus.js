/**
 * コンポーネント間を疎結合に接続するシンプルな Pub/Sub イベントバス
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * イベントを購読する
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} 購読解除関数
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * 1回限りのイベント購読
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  once(event, handler) {
    const off = this.on(event, (...args) => {
      off();
      handler(...args);
    });
    return off;
  }

  /**
   * イベント購読を解除する
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * イベントを発火する
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      handler(payload);
    }
  }
}
