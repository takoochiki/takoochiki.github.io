import { SAMPLE_MANUSCRIPT } from './config/sampleText.js';
import { EventBus } from './core/EventBus.js';
import { HistoryManager } from './core/HistoryManager.js';
import { IgnoreManager } from './core/IgnoreManager.js';
import { ProofreadEngine } from './core/ProofreadEngine.js';
import { Store } from './core/Store.js';
import { createDefaultRegistry } from './rules/index.js';
import { ShortcutManager } from './services/ShortcutManager.js';
import { StorageService } from './services/StorageService.js';
import { AppLayout } from './ui/AppLayout.js';
import { DisplayModal } from './ui/DisplayModal.js';
import { IssueListPanel } from './ui/IssueListPanel.js';
import { IssuePopover } from './ui/IssuePopover.js';
import { LatexModal } from './ui/LatexModal.js';
import { SettingsModal } from './ui/SettingsModal.js';
import { StatsModal } from './ui/StatsModal.js';
import { VariantsModal } from './ui/VariantsModal.js';

/**
 * アプリケーションの起動・DI組み立て・ツールバー/ファイル操作/ショートカット結線
 */
function bootstrap() {
  const bus = new EventBus();
  const registry = createDefaultRegistry();
  const history = new HistoryManager();
  const ignores = new IgnoreManager();
  const engine = new ProofreadEngine(registry, ignores);
  const storage = new StorageService();
  const shortcuts = new ShortcutManager();

  const store = new Store({
    bus,
    registry,
    history,
    ignores,
    engine,
    storage,
  });

  // UI 要素の取得
  const splitContainer = document.getElementById('split-workspace');
  const editorPane = document.getElementById('editor-pane');
  const proofreadPane = document.getElementById('proofread-pane');
  const resizer = document.getElementById('split-resizer');
  const textarea = document.getElementById('editor-textarea');
  const proofreadScrollEl = document.getElementById('proofread-scroll');
  const proofreadContentEl = document.getElementById('proofread-content');
  const charCountEl = document.getElementById('status-char-count');
  const issuePanelEl = document.getElementById('issue-panel');
  const dropOverlay = document.getElementById('drop-overlay');

  const btnWritingMode = document.getElementById('btn-writing-mode');
  const btnResetSplit = document.getElementById('btn-reset-split');
  const btnSyncScroll = document.getElementById('btn-sync-scroll');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnTogglePanel = document.getElementById('btn-toggle-panel');

  const fileInputTxt = document.getElementById('file-input-txt');
  const fileInputProject = document.getElementById('file-input-project');
  const fileStatusEl = document.getElementById('status-file-name');
  const engineStatusEl = document.getElementById('status-engine-info');
  const autosaveStatusEl = document.getElementById('status-autosave');

  // UI モジュールの生成
  const layout = new AppLayout({
    store,
    splitContainer,
    editorPane,
    proofreadPane,
    resizer,
    textarea,
    proofreadScrollEl,
    proofreadContentEl,
    charCountEl,
  });

  const settingsModal = new SettingsModal({ store, registry });
  const displayModal = new DisplayModal({ store, shortcuts });
  const variantsModal = new VariantsModal({ store });
  const latexModal = new LatexModal({ store, storage });
  const statsModal = new StatsModal({ store });

  const issuePopover = new IssuePopover({
    store,
    proofreadContainer: proofreadContentEl,
    onOpenVariants: (groupId) => variantsModal.open(groupId),
  });

  const issueListPanel = new IssueListPanel({
    store,
    registry,
    container: issuePanelEl,
    onJumpToIssue: (issue) => layout.jumpToIssue(issue),
    onOpenVariants: (groupId) => variantsModal.open(groupId),
  });

  // 状態同期用のUI更新関数
  const syncToolbarControls = () => {
    const d = store.state.displaySettings;
    const isVertical = d.writingMode === 'vertical';
    btnWritingMode.textContent = isVertical ? '縦書き中 ⇄ 横書きへ' : '横書き中 ⇄ 縦書きへ';
    btnWritingMode.classList.toggle('is-active', isVertical);

    btnResetSplit.disabled = Math.abs((d.splitRatio ?? 0.5) - 0.5) < 0.005;

    btnSyncScroll.textContent = d.syncScroll ? 'スクロール同期: ON' : 'スクロール同期: OFF';
    btnSyncScroll.classList.toggle('is-active', d.syncScroll);

    btnThemeToggle.textContent = d.theme === 'dark' ? '☀ ライト' : '🌙 ダーク';

    btnUndo.disabled = !history.canUndo();
    btnRedo.disabled = !history.canRedo();

    const unsavedMark = store.state.hasUnsavedChanges ? ' *（未保存）' : '';
    fileStatusEl.textContent = `${store.state.fileName}${unsavedMark}`;
    fileStatusEl.classList.toggle('has-unsaved', store.state.hasUnsavedChanges);
  };

  bus.on('state:initialized', syncToolbarControls);
  bus.on('display:updated', syncToolbarControls);
  bus.on('text:changed', syncToolbarControls);
  bus.on('document:loaded', syncToolbarControls);
  bus.on('document:saved', syncToolbarControls);

  bus.on('autosave:updated', ({ savedAt }) => {
    if (!savedAt) return;
    const timeStr = new Date(savedAt).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    autosaveStatusEl.textContent = `自動保存済 (${timeStr})`;
  });

  bus.on('issues:updated', ({ durationMs }) => {
    const counts = store.getIssueCounts();
    engineStatusEl.textContent = `指摘 ${counts.unhandled}件 (赤${counts.errorCount} / 黄${counts.warningCount}) ・ ${durationMs}ms`;
    syncToolbarControls();
  });

  // 未保存確認ヘルパー
  const confirmReplaceIfUnsaved = () => {
    if (!store.state.hasUnsavedChanges) return true;
    return window.confirm('保存されていない変更があります。破棄して新しいファイルを読み込みますか？');
  };

  // ファイル読み込み処理（TXT / プロジェクトJSON 共通）
  const handleLoadedFile = async (file) => {
    if (!file) return;
    if (!confirmReplaceIfUnsaved()) return;
    const { name, rawText } = await storage.readTextFile(file);

    if (name.toLowerCase().endsWith('.json')) {
      try {
        const project = storage.parseProjectPayload(rawText);
        store.importProject(project);
        return;
      } catch (err) {
        window.alert(`プロジェクト読込エラー: ${err.message}`);
        return;
      }
    }

    store.loadDocument({
      text: rawText,
      rawText,
      fileName: name,
      resetIgnores: true,
    });
  };

  // 保存アクション
  const saveTxtFile = () => {
    const name = store.state.fileName.toLowerCase().endsWith('.txt')
      ? store.state.fileName
      : `${store.state.fileName.replace(/\.[^.]+$/, '')}.txt`;
    storage.downloadFile(name, store.state.text, 'text/plain;charset=utf-8');
    store.markSaved(name);
  };

  const saveProjectFile = () => {
    const payload = store.exportProject();
    const base = (store.state.fileName || 'project').replace(/\.[^.]+$/, '');
    storage.downloadFile(
      `${base}.proofread.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
    store.markSaved();
  };

  // ツールバーボタン結線
  btnWritingMode.addEventListener('click', () => {
    const next = store.state.displaySettings.writingMode === 'vertical' ? 'horizontal' : 'vertical';
    store.updateDisplaySettings({ writingMode: next });
    issuePopover.hide();
  });

  btnResetSplit.addEventListener('click', () => {
    store.updateDisplaySettings({ splitRatio: 0.5 });
  });

  btnSyncScroll.addEventListener('click', () => {
    store.updateDisplaySettings({ syncScroll: !store.state.displaySettings.syncScroll });
  });

  btnThemeToggle.addEventListener('click', () => {
    const next = store.state.displaySettings.theme === 'dark' ? 'light' : 'dark';
    store.updateDisplaySettings({ theme: next });
  });

  btnUndo.addEventListener('click', () => store.undo());
  btnRedo.addEventListener('click', () => store.redo());

  btnTogglePanel.addEventListener('click', () => {
    const hidden = issuePanelEl.classList.toggle('is-collapsed');
    btnTogglePanel.textContent = hidden ? '指摘パネルを表示' : '指摘パネルを隠す';
  });

  document.getElementById('btn-open-txt').addEventListener('click', () => {
    fileInputTxt.value = '';
    fileInputTxt.click();
  });
  fileInputTxt.addEventListener('change', (e) => handleLoadedFile(e.target.files[0]));

  document.getElementById('btn-save-txt').addEventListener('click', saveTxtFile);

  document.getElementById('btn-open-project').addEventListener('click', () => {
    fileInputProject.value = '';
    fileInputProject.click();
  });
  fileInputProject.addEventListener('change', (e) => handleLoadedFile(e.target.files[0]));

  document.getElementById('btn-save-project').addEventListener('click', saveProjectFile);

  document.getElementById('btn-load-sample').addEventListener('click', () => {
    if (!confirmReplaceIfUnsaved()) return;
    store.loadDocument({
      text: SAMPLE_MANUSCRIPT,
      rawText: SAMPLE_MANUSCRIPT,
      fileName: 'sample.txt',
      resetIgnores: true,
    });
  });

  document.getElementById('btn-new-doc').addEventListener('click', () => {
    if (!confirmReplaceIfUnsaved()) return;
    store.loadDocument({
      text: '',
      rawText: '',
      fileName: 'untitled.txt',
      resetIgnores: true,
    });
  });

  document.getElementById('btn-open-variants').addEventListener('click', () => variantsModal.open());
  document.getElementById('btn-open-latex').addEventListener('click', () => latexModal.open());
  document.getElementById('btn-open-settings').addEventListener('click', () => settingsModal.open());
  document.getElementById('btn-open-display').addEventListener('click', () => displayModal.open());
  document.getElementById('btn-open-stats').addEventListener('click', () => statsModal.open());

  // ドラッグ＆ドロップ読込
  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragCounter++;
      dropOverlay.classList.remove('hidden');
    }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  });
  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropOverlay.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      dragCounter = 0;
      dropOverlay.classList.add('hidden');
      handleLoadedFile(e.dataTransfer.files[0]);
    }
  });

  // ページ離脱時の未保存警告
  window.addEventListener('beforeunload', (e) => {
    if (store.state.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // キーボードショートカット登録
  shortcuts.register('Ctrl+Z', '元に戻す (Undo)', () => store.undo(), { allowInInput: false });
  shortcuts.register('Ctrl+Shift+Z', 'やり直す (Redo)', () => store.redo(), { allowInInput: false });
  shortcuts.register('Ctrl+Y', 'やり直す (Redo)', () => store.redo(), { allowInInput: false });
  shortcuts.register('Ctrl+S', 'TXTファイルを保存', saveTxtFile);
  shortcuts.register('Alt+N', '次の指摘へジャンプ', () => issueListPanel.moveSelection(1));
  shortcuts.register('Alt+P', '前の指摘へジャンプ', () => issueListPanel.moveSelection(-1));
  shortcuts.register('F8', '次の指摘へジャンプ', () => issueListPanel.moveSelection(1));
  shortcuts.register('Shift+F8', '前の指摘へジャンプ', () => issueListPanel.moveSelection(-1));
  shortcuts.register('Alt+V', '縦書き / 横書きを切り替え', () => btnWritingMode.click());
  shortcuts.register('Alt+U', '表記揺れ一括編集を開く', () => variantsModal.open());
  shortcuts.register('Alt+L', 'LaTeX変換モーダルを開く', () => latexModal.open());
  shortcuts.register('Alt+S', '校正ルール設定を開く', () => settingsModal.open());
  shortcuts.attach(window);

  // 初期化実行
  store.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
