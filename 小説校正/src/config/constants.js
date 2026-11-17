/**
 * アプリケーション全体の定数・カテゴリ定義・初期設定
 */

export const STORAGE_KEYS = {
  AUTOSAVE: 'novel_proofreader_autosave_v1',
  SETTINGS: 'novel_proofreader_settings_v1',
  DISPLAY: 'novel_proofreader_display_v1',
  VARIANTS: 'novel_proofreader_variants_v1',
  IGNORES: 'novel_proofreader_ignores_v1',
  LATEX_OPTIONS: 'novel_proofreader_latex_v1',
};

export const RULE_CATEGORIES = [
  { id: 'punctuation', name: '約物・記号', order: 1 },
  { id: 'brackets', name: '括弧・会話文', order: 2 },
  { id: 'paragraph', name: '段落・改行・空白', order: 3 },
  { id: 'characters', name: '文字種・縦書き', order: 4 },
  { id: 'variants', name: '表記揺れ', order: 5 },
  { id: 'patterns', name: '文字列パターン', order: 6 },
  { id: 'ruby', name: 'ルビ・特殊記法', order: 7 },
];

export const DEFAULT_DISPLAY_SETTINGS = {
  writingMode: 'horizontal', // 'horizontal' | 'vertical'
  theme: 'light', // 'light' | 'dark'
  fontFamily: 'serif', // 'serif' | 'sans' | 'mono'
  fontSize: 17,
  lineHeight: 1.9,
  splitRatio: 0.5, // 0.2 - 0.8
  syncScroll: true,
  showRubyRendered: false,
};

export const FONT_FAMILY_MAP = {
  serif: "'Shippori Mincho', 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif",
  sans: "'Noto Sans JP', 'Yu Gothic', 'YuGothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif",
  mono: "'BIZ UDGothic', 'Noto Sans Mono CJK JP', 'Consolas', monospace",
};

export const DEFAULT_LATEX_OPTIONS = {
  paragraphSeparator: 'blank-line', // 'blank-line' | 'par'
  preventDuplicateBlankLines: true,
  lineBreakMode: 'preserve', // 'preserve' | 'join' | 'backslash'
  indentHandling: 'strip', // 'strip' | 'keep'
  escapeSpecialChars: true,
  convertRuby: true,
  rubyMacroTemplate: '\\ruby{$1}{$2}',
};
