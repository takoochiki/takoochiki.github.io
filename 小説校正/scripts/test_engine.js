import { assert, assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { SAMPLE_MANUSCRIPT } from '../src/config/sampleText.js';
import { EventBus } from '../src/core/EventBus.js';
import { HistoryManager } from '../src/core/HistoryManager.js';
import { IgnoreManager } from '../src/core/IgnoreManager.js';
import { ProofreadEngine } from '../src/core/ProofreadEngine.js';
import { Store } from '../src/core/Store.js';
import { createDefaultRegistry } from '../src/rules/index.js';
import { LatexConverter } from '../src/services/LatexConverter.js';
import { StatsService } from '../src/services/StatsService.js';
import { VariantService } from '../src/services/VariantService.js';
import { SegmentRenderer } from '../src/ui/SegmentRenderer.js';

// Node/Deno テスト用のインメモリ StorageService スタブ
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  loadAutosave() { return this.map.get('autosave') || null; }
  saveAutosave(v) { this.map.set('autosave', v); return true; }
  loadRuleSettings() { return this.map.get('settings') || null; }
  saveRuleSettings(v) { this.map.set('settings', v); return true; }
  loadDisplaySettings() { return this.map.get('display') || null; }
  saveDisplaySettings(v) { this.map.set('display', v); return true; }
  loadVariantGroups() { return this.map.get('variants') || null; }
  saveVariantGroups(v) { this.map.set('variants', v); return true; }
  loadIgnores() { return this.map.get('ignores') || null; }
  saveIgnores(v) { this.map.set('ignores', v); return true; }
  loadLatexOptions() { return this.map.get('latex') || null; }
  saveLatexOptions(v) { this.map.set('latex', v); return true; }
  buildProjectPayload(state) { return { schemaVersion: 1, ...state }; }
}

function createTestStore(initialText = SAMPLE_MANUSCRIPT) {
  const bus = new EventBus();
  const registry = createDefaultRegistry();
  const history = new HistoryManager();
  const ignores = new IgnoreManager();
  const engine = new ProofreadEngine(registry, ignores);
  const storage = new MemoryStorage();
  const store = new Store({ bus, registry, history, ignores, engine, storage });
  store.init();
  store.loadDocument({ text: initialText, rawText: initialText, fileName: 'test.txt', resetIgnores: true });
  return { store, registry, history, ignores, engine };
}

Deno.test('全7カテゴリのルール登録とサンプル原稿の網羅的検出', () => {
  const { store, registry } = createTestStore(SAMPLE_MANUSCRIPT);
  const rules = registry.getAll();
  assert(rules.length >= 80, `登録ルール数が少なすぎます: ${rules.length}`);

  const issues = store.state.issues;
  const detectedRules = new Set(issues.map((i) => i.ruleId));

  // 全7カテゴリから代表ルールが正しく発火することを確認
  assert(detectedRules.has('punct.ellipsis-even'), '三点リーダー奇数個を検出すべき');
  assert(detectedRules.has('punct.dash-even'), 'ダッシュ奇数個を検出すべき');
  assert(detectedRules.has('punct.dash-sub'), '代用ダッシュを検出すべき');
  assert(detectedRules.has('punct.consecutive'), '連続句読点を検出すべき');
  assert(detectedRules.has('bracket.dialogue-end-period'), '会話文末の句点を検出すべき');
  assert(detectedRules.has('bracket.dialogue-end-space'), '会話文末の空白を検出すべき');
  assert(detectedRules.has('para.missing-indent'), '段落頭の字下げ忘れを検出すべき');
  assert(detectedRules.has('char.halfwidth-kana'), '半角カタカナを検出すべき');
  assert(detectedRules.has('variant.inconsistency'), '表記揺れを検出すべき');
  assert(detectedRules.has('pattern.repeated-word'), '同一単語連続を検出すべき');
  assert(detectedRules.has('pattern.placeholder-text'), 'TODO仮置きを検出すべき');
  assert(detectedRules.has('ruby.empty-reading'), '空ルビを検出すべき');
  assert(detectedRules.has('ruby.inconsistent-reading'), '同一親文字ルビ揺れを検出すべき');

  // UTF-16 オフセットの整合性検証
  for (const issue of issues) {
    assert(issue.start >= 0 && issue.end <= store.state.text.length);
    assert(issue.end > issue.start);
    assertEquals(store.state.text.slice(issue.start, issue.end), issue.matchedText);
  }
});

Deno.test('サロゲートペアを含む原稿でも UTF-16 オフセットがずれない', () => {
  const text = '　𠮷野家のそばを歩く…そして𩸽を食べた。。';
  const { store } = createTestStore(text);
  const consecutive = store.state.issues.find((i) => i.ruleId === 'punct.consecutive');
  assertExists(consecutive);
  assertEquals(text.slice(consecutive.start, consecutive.end), '。。');
});

Deno.test('個別修正の適用と Undo / Redo、および無視状態の維持', () => {
  const text = '　彼は言った…「こんにちは。」';
  const { store } = createTestStore(text);

  const ellipsis = store.state.issues.find((i) => i.ruleId === 'punct.ellipsis-even');
  const dialoguePeriod = store.state.issues.find((i) => i.ruleId === 'bracket.dialogue-end-period');
  assertExists(ellipsis);
  assertExists(dialoguePeriod);

  // 会話文末句点を無視してから、別の箇所（三点リーダー）を修正する
  store.ignoreIssue(dialoguePeriod.id);
  const ignoredCountBefore = store.getIssueCounts().ignoredCount;
  assertEquals(ignoredCountBefore, 1);

  store.applySuggestion(ellipsis.id, '……');
  assertEquals(store.state.text, '　彼は言った……「こんにちは。」');

  // 文字数が1文字増えてオフセットがずれても、無視状態は維持されること
  const stillIgnored = store.state.issues.find((i) => i.ruleId === 'bracket.dialogue-end-period');
  assertExists(stillIgnored);
  assertEquals(stillIgnored.ignored, true);

  // Undo で元に戻せること
  store.undo();
  assertEquals(store.state.text, text);

  // Redo で再適用できること
  store.redo();
  assertEquals(store.state.text, '　彼は言った……「こんにちは。」');
});

Deno.test('表記揺れの一括置換・個別除外・単一 Undo 復元', () => {
  const text = '　それは大切な事だ。仕事のことではない。大事な事もある。';
  const { store } = createTestStore(text);
  const service = new VariantService();

  const analyses = service.analyzeAllGroups(store.state.text, store.state.variantGroups);
  const kotoGroup = analyses.find((a) => a.group.id === 'var_koto');
  assertExists(kotoGroup);

  // 「仕事」内の「事」は漢字境界判定により除外され、2箇所の「事」と1箇所の「こと」が検出される
  assertEquals(kotoGroup.termStats['事'], 2);
  assertEquals(kotoGroup.termStats['こと'], 1);

  // 2つ目の「事」を個別除外して「こと」へ統一
  const kotoTargets = kotoGroup.occurrences.filter((o) => o.term === '事');
  const excluded = new Set([kotoTargets[1].id]);
  const preview = service.buildBatchPreview(store.state.text, kotoGroup, 'こと', excluded);
  assertEquals(preview.activeCount, 1);
  assertEquals(preview.excludedCount, 1);

  store.applyBatchTextChange(preview.previewText, '表記統一テスト');
  assertEquals(store.state.text, '　それは大切なことだ。仕事のことではない。大事な事もある。');

  // 1回の Undo で一括置換前へ戻る
  store.undo();
  assertEquals(store.state.text, text);
});

Deno.test('LaTeX変換: 空行重複防止、\\par、特殊文字エスケープ、ルビ保護、元原稿非破壊', () => {
  const converter = new LatexConverter();
  const source = '　｜珈琲《コーヒー》が100%好きだ。\n\n\n\n　次の段落_2。';
  const snapshot = source;

  const res = converter.convert(source, {
    paragraphSeparator: 'par',
    preventDuplicateBlankLines: true,
    lineBreakMode: 'preserve',
    indentHandling: 'strip',
    escapeSpecialChars: true,
    convertRuby: true,
    rubyMacroTemplate: '\\ruby{$1}{$2}',
  });

  // 元原稿は変わらない
  assertEquals(source, snapshot);
  // ルビマクロ自体はエスケープされず、本文中の % や _ のみエスケープされる
  assert(res.output.includes('\\ruby{珈琲}{コーヒー}が100\\%好きだ。'));
  assert(res.output.includes('\\par'));
  assert(res.output.includes('次の段落\\_2。'));
  // 連続空行が重複せず単一の \par 区切りになる
  assertEquals(res.output.match(/\\par/g)?.length, 1);
});

Deno.test('SegmentRenderer: 重複マーカーのスイープライン分割とHTMLエスケープ', () => {
  const renderer = new SegmentRenderer();
  const text = '<script>!!　</script>';
  const issues = [
    { id: 'r1', start: 8, end: 11, severity: 'warning', ignored: false },
    { id: 'r2', start: 9, end: 11, severity: 'error', ignored: false },
  ];
  const html = renderer.renderHtml(text, issues);
  assert(!html.includes('<script>'), 'HTMLエスケープされなければならない');
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('data-issue-ids="r1,r2"'));
  assert(html.includes('issue-mark--error'));
});

Deno.test('StatsService: 文字種・約物・特定文字列集計', () => {
  const stats = new StatsService();
  const result = stats.analyze('「おはよう。」\n　彼は言った。', '彼');
  assertEquals(result.punctCounts['。'], 2);
  assertEquals(result.punctCounts['「'], 1);
  assertEquals(result.queryResult?.count, 1);
  assertEquals(result.lineBreakdown.dialogueLines, 1);
  assertEquals(result.lineBreakdown.narrativeLines, 1);
});

Deno.test('非機能要件: 20万字の大規模原稿でも実用時間内に校正が完了する', () => {
  const chunk = '　雨が降っていた。窓の外では街灯が濡れている。「今日は寒いね」と彼は言った。\n';
  const largeText = chunk.repeat(5200); // 約 20.2万文字
  assert(largeText.length >= 200000);

  const registry = createDefaultRegistry();
  const ignores = new IgnoreManager();
  const engine = new ProofreadEngine(registry, ignores);
  const settings = registry.createDefaultSettings();

  const res = engine.runNow({
    text: largeText,
    rawText: largeText,
    ruleSettings: settings,
    variantGroups: [],
  });
  assert(res.durationMs < 2500, `20万字の校正時間が長すぎます: ${res.durationMs}ms`);
});

Deno.test('表記揺れ: 物/もの除外、少数派無視で他方の警告も解消、グループ無視', () => {
  // 「物」と「もの」が混在してもデフォルト辞書では警告されない
  const monoText = '　それは大切な物だ。あちらは別のものだ。';
  const { store: monoStore } = createTestStore(monoText);
  const monoIssues = monoStore.state.issues.filter((i) => i.ruleId === 'variant.inconsistency');
  assertEquals(monoIssues.length, 0);

  // 「こと」20回、「事」1回
  const text = '　' + 'そういうことだ。'.repeat(20) + '大事な事だ。';
  const { store } = createTestStore(text);

  const beforeVarIssues = store.state.issues.filter((i) => i.ruleId === 'variant.inconsistency');
  assertEquals(beforeVarIssues.length, 21);

  const kotoKanjiIssue = beforeVarIssues.find((i) => i.matchedText === '事');
  assertExists(kotoKanjiIssue);

  // 「事」1箇所を無視する
  store.ignoreIssue(kotoKanjiIssue.id);

  // 有効な未対応表記揺れ警告が0件になり、20箇所の「こと」警告が消えること
  const unhandledVar = store.state.issues.filter(
    (i) => i.ruleId === 'variant.inconsistency' && !i.ignored
  );
  const ignoredVar = store.state.issues.filter(
    (i) => i.ruleId === 'variant.inconsistency' && i.ignored
  );
  assertEquals(unhandledVar.length, 0);
  assertEquals(ignoredVar.length, 1);
  assertEquals(ignoredVar[0].matchedText, '事');

  // グループ単位の無視と解除
  const { store: grpStore } = createTestStore('　出来ることなら、できる限り。');
  assert(grpStore.state.issues.some((i) => i.ruleId === 'variant.inconsistency' && !i.ignored));
  grpStore.ignoreVariantGroup('var_dekiru');
  assertEquals(
    grpStore.state.issues.filter((i) => i.ruleId === 'variant.inconsistency' && !i.ignored).length,
    0
  );
  grpStore.unignoreVariantGroup('var_dekiru');
  assert(grpStore.state.issues.some((i) => i.ruleId === 'variant.inconsistency' && !i.ignored));
});

Deno.test('波ダッシュ・全角チルダの正確な名称表示と一括変換・Undo', () => {
  const text = '　春から秋～冬〜春へ。';
  const { store } = createTestStore(text);

  const waveIssue = store.state.issues.find((i) => i.ruleId === 'punct.wave-dash-mix');
  assertExists(waveIssue);
  assert(
    waveIssue.message.includes('全角チルダ「～」(U+FF5E)が使われています'),
    `実際のメッセージ: ${waveIssue.message}`
  );
  assert(waveIssue.message.includes('標準設定: 波ダッシュ「〜」(U+301C)'));

  // すべて全角チルダへ一括変換
  store.runSymbolTransform('to-fullwidth-tilde');
  assertEquals(store.state.text, '　春から秋～冬～春へ。');
  assertEquals(
    store.state.ruleSettings['punct.wave-dash-mix'].options.preferredChar,
    '～'
  );
  assertEquals(
    store.state.issues.filter((i) => i.ruleId === 'punct.wave-dash-mix').length,
    0
  );

  // 1回の Undo で原稿が元に戻ること
  store.undo();
  assertEquals(store.state.text, text);
});

Deno.test('段落の文字数上限: 500文字までは許可し、501文字以上で警告', () => {
  const p500 = '　' + 'あ'.repeat(499);
  const p501 = '　' + 'あ'.repeat(500);

  const { store: s500 } = createTestStore(p500);
  assertEquals(
    s500.state.issues.filter((i) => i.ruleId === 'para.max-length').length,
    0
  );

  const { store: s501 } = createTestStore(p501);
  assertEquals(
    s501.state.issues.filter((i) => i.ruleId === 'para.max-length').length,
    1
  );
});
