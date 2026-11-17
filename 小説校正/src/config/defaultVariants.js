/**
 * 校正ルール.md 第5章に基づくデフォルト表記揺れ辞書
 * 各グループは比較対象となる表記群と、任意の推奨表記（未指定時は双方出現時に警告）を持つ。
 */
export const DEFAULT_VARIANT_GROUPS = [
  { id: 'var_dekiru', label: '出来る / できる', terms: ['出来る', 'できる'], preferred: '', boundaryCheck: false },
  { id: 'var_kudasai', label: '下さい / ください', terms: ['下さい', 'ください'], preferred: '', boundaryCheck: false },
  { id: 'var_koto', label: '事 / こと', terms: ['事', 'こと'], preferred: '', boundaryCheck: true },
  { id: 'var_mono', label: '物 / もの', terms: ['物', 'もの'], preferred: '', boundaryCheck: true },
  { id: 'var_toki', label: '時 / とき', terms: ['時', 'とき'], preferred: '', boundaryCheck: true },
  { id: 'var_tokoro', label: '所 / ところ', terms: ['所', 'ところ'], preferred: '', boundaryCheck: true },
  { id: 'var_watashi', label: '私 / わたし', terms: ['私', 'わたし'], preferred: '', boundaryCheck: true },
  { id: 'var_anata', label: '貴方 / あなた', terms: ['貴方', 'あなた'], preferred: '', boundaryCheck: false },
  { id: 'var_hitori', label: '一人 / ひとり', terms: ['一人', 'ひとり'], preferred: '', boundaryCheck: true },
  { id: 'var_hitotsu', label: '一つ / ひとつ', terms: ['一つ', 'ひとつ'], preferred: '', boundaryCheck: true },
  { id: 'var_ikkagetsu', label: '一ヶ月 / 一か月 / 一箇月', terms: ['一ヶ月', '一か月', '一箇月'], preferred: '', boundaryCheck: false },
  { id: 'var_computer', label: 'コンピュータ / コンピューター', terms: ['コンピュータ', 'コンピューター'], preferred: '', boundaryCheck: false },
  { id: 'var_violin', label: 'ヴァイオリン / バイオリン', terms: ['ヴァイオリン', 'バイオリン'], preferred: '', boundaryCheck: false },
  { id: 'var_iroiro', label: 'いろいろ / 色々', terms: ['いろいろ', '色々'], preferred: '', boundaryCheck: false },
  { id: 'var_samazama', label: '様々 / さまざま', terms: ['様々', 'さまざま'], preferred: '', boundaryCheck: false },
  { id: 'var_sudeni', label: '既に / すでに', terms: ['既に', 'すでに'], preferred: '', boundaryCheck: false },
  { id: 'var_sarani', label: '更に / さらに', terms: ['更に', 'さらに'], preferred: '', boundaryCheck: false },
  { id: 'var_subete', label: '全て / すべて', terms: ['全て', 'すべて'], preferred: '', boundaryCheck: false },
  { id: 'var_takusan', label: '沢山 / たくさん', terms: ['沢山', 'たくさん'], preferred: '', boundaryCheck: false },
  { id: 'var_hotondo', label: '殆ど / ほとんど', terms: ['殆ど', 'ほとんど'], preferred: '', boundaryCheck: false },
  { id: 'var_naze', label: '何故 / なぜ', terms: ['何故', 'なぜ'], preferred: '', boundaryCheck: false },
  { id: 'var_itsu', label: '何時 / いつ', terms: ['何時', 'いつ'], preferred: '', boundaryCheck: true },
];
