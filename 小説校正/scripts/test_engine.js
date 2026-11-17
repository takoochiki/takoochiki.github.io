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

Deno.test('表記揺れ: ってしまう と てしまう の誤検出がないこと', () => {
  const safeText = '　つい笑ってしまう。うっかり忘れてしまう。';
  const { store: safeStore } = createTestStore(safeText);
  assertEquals(
    safeStore.state.issues.filter((i) => i.ruleId === 'variant.inconsistency').length,
    0
  );

  // 本来の表記揺れ（「て仕舞う」と「てしまう」）は検出される
  const conflictText = '　忘れて仕舞う。思い出してしまう。';
  const { store: conflictStore } = createTestStore(conflictText);
  assertEquals(
    conflictStore.state.issues.filter((i) => i.ruleId === 'variant.inconsistency').length,
    2
  );
});

Deno.test('文末表現連続検出 E01〜E07 の全ルールと重複統合・設定変更', () => {
  // E01: 最長一致優先（3文連続「静かだった」）＆すべて黄色・修正候補なし
  const e01Text = '　山は静かだった。森も静かだった。湖も静かだった。';
  const { store: s01 } = createTestStore(e01Text);
  const e01Issues = s01.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(e01Issues.length, 1);
  assertEquals(e01Issues[0].ruleId, 'ending.E01');
  assertEquals(e01Issues[0].severity, 'warning');
  assertEquals(e01Issues[0].suggestions.length, 0);
  assert(e01Issues[0].message.includes('静かだった'));

  // 2文字以下の一致（「った」3文）は E01 対象外
  const shortText = '　彼は走った。彼女は笑った。友人は怒った。';
  const { store: sShort } = createTestStore(shortText);
  assertEquals(
    sShort.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );

  // E02: 特徴的な文末表現（「はずだ」3文連続）＋カスタム表現追加
  const e02Text = '　雨が降るはずだ。道も濡れるはずだ。傘が要るはずだ。';
  const { store: s02 } = createTestStore(e02Text);
  const e02Issues = s02.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(e02Issues.length, 1);
  assert(e02Issues[0].extra.endingDetails.ruleCodes.includes('E02'));

  // E03 + E05 重複統合: 「た」5文連続（E05 を ON にすると 1 件に統合される）
  const e03Text = '　朝が来た。鳥が鳴いた。風が吹いた。雲が流れた。犬が吠えた。';
  const { store: s03 } = createTestStore(e03Text);
  // 初期状態（E03 ON, E05 OFF）で1件
  let tIssues = s03.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(tIssues.length, 1);
  assertEquals(tIssues[0].extra.endingDetails.count, 5);
  assertEquals(tIssues[0].extra.endingDetails.ruleCodes, ['E03']);

  // E05 を ON にしても同一連続区間は 1 件に統合され、E03 と E05 両方が含まれる
  s03.updateRuleSetting('ending.E05', { enabled: true });
  tIssues = s03.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(tIssues.length, 1);
  assert(tIssues[0].extra.endingDetails.ruleCodes.includes('E03'));
  assert(tIssues[0].extra.endingDetails.ruleCodes.includes('E05'));

  // E05 で漢字終わりの連続は対象外
  const kanjiEndText = '　彼は東京。姉は京都。父は大阪。母は奈良。弟は沖縄。';
  const { store: sKanji } = createTestStore(kanjiEndText);
  sKanji.updateRuleSetting('ending.E05', { enabled: true });
  assertEquals(
    sKanji.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );

  // E04: 非過去形（初期OFF → ON で5文検出）
  const e04Text = '　風が吹く。木が揺れる。鳥が飛ぶ。川が流れる。水が光る。';
  const { store: s04 } = createTestStore(e04Text);
  assertEquals(
    s04.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );
  s04.updateRuleSetting('ending.E04', { enabled: true });
  const e04Issues = s04.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(e04Issues.length, 1);
  assert(e04Issues[0].extra.endingDetails.ruleCodes.includes('E04'));

  // E06: 同一述語簡易判定（初期OFF → ON で末尾2文字一致3文検出）
  const e06Text = '　春を待つ。夢を持つ。光を放つ。';
  const { store: s06 } = createTestStore(e06Text);
  assertEquals(
    s06.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );
  s06.updateRuleSetting('ending.E06', { enabled: true, options: { threshold: 3, compareLength: 1 } });
  const e06Issues = s06.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(e06Issues.length, 1);
  assert(e06Issues[0].extra.endingDetails.ruleCodes.includes('E06'));

  // E07: 丁寧体同一形式 4文連続
  const e07Text = '　雨が降ります。風が吹きます。雷が鳴ります。傘を差します。';
  const { store: s07 } = createTestStore(e07Text);
  const e07Issues = s07.state.issues.filter((i) => i.ruleId.startsWith('ending.'));
  assertEquals(e07Issues.length, 1);
  assert(e07Issues[0].extra.endingDetails.ruleCodes.includes('E07'));
});

Deno.test('文末表現連続検出: 会話文・空行・場面転換リセット、単一改行継続、括弧内句点保護', () => {
  // 1. 会話文を挟むと連続判定がリセットされる（3文+会話+2文で5文にならない）
  const dialogueResetText =
    '　朝が来た。鳥が鳴いた。風が吹いた。\n「おはよう。」\n　雲が流れた。犬が吠えた。';
  const { store: sDial } = createTestStore(dialogueResetText);
  assertEquals(
    sDial.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );

  // 2. 空行・場面転換を挟むとリセットされる
  const blankResetText = '　朝が来た。鳥が鳴いた。風が吹いた。\n\n　雲が流れた。犬が吠えた。';
  const { store: sBlank } = createTestStore(blankResetText);
  assertEquals(
    sBlank.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );

  // 3. 通常の単一改行ではリセットされない
  const singleNewlineText =
    '　朝が来た。\n鳥が鳴いた。\n風が吹いた。\n雲が流れた。\n犬が吠えた。';
  const { store: sSingle } = createTestStore(singleNewlineText);
  assertEquals(
    sSingle.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    1
  );

  // 4. 括弧内の句点を文末区切りとして誤認しない（内側の「行くよ。」で分割せず全体で1文）
  const bracketQuoteText =
    '　彼は「行くよ。」と言った。彼女も「賛成だ。」と笑った。';
  const { store: sBracket } = createTestStore(bracketQuoteText);
  assertEquals(
    sBracket.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );

  // 5. 会話文の検査を有効にすると会話文内の連続も検出する
  const dialInnerText = '「雨が降った。風が吹いた。雷が鳴った。葉が舞った。靴が濡れた。」';
  const { store: sDialOn } = createTestStore(dialInnerText);
  assertEquals(
    sDialOn.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    0
  );
  sDialOn.updateRuleSetting('ending.config', { options: { includeDialogue: true } });
  assertEquals(
    sDialOn.state.issues.filter((i) => i.ruleId.startsWith('ending.')).length,
    1
  );
});
