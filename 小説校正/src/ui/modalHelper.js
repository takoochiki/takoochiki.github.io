import { escapeHtml } from '../utils/textUtils.js';

/**
 * 共通モーダルシェルを生成・開閉管理するヘルパー
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.title
 * @param {string} [opts.sizeClass] - 'modal--md' | 'modal--lg' | 'modal--xl'
 * @param {() => void} [opts.onOpen]
 */
export function createModal({ id, title, sizeClass = 'modal--lg', onOpen }) {
  const backdrop = document.createElement('div');
  backdrop.id = id;
  backdrop.className = 'modal-backdrop hidden';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', `${id}-title`);

  backdrop.innerHTML = `
    <div class="modal-dialog ${escapeHtml(sizeClass)}">
      <div class="modal-header">
        <h2 class="modal-title" id="${id}-title">${escapeHtml(title)}</h2>
        <button type="button" class="icon-btn modal-close-btn" aria-label="閉じる">✕</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const bodyEl = backdrop.querySelector('.modal-body');
  const footerEl = backdrop.querySelector('.modal-footer');
  const closeBtn = backdrop.querySelector('.modal-close-btn');

  const close = () => {
    backdrop.classList.add('hidden');
  };

  const open = (...args) => {
    if (onOpen) onOpen(...args);
    backdrop.classList.remove('hidden');
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.classList.contains('hidden')) {
      close();
    }
  });

  return {
    el: backdrop,
    bodyEl,
    footerEl,
    open,
    close,
  };
}
