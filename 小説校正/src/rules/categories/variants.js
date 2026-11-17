import { VariantService } from '../../services/VariantService.js';

const variantService = new VariantService();

/**
 * 5. 表記揺れカテゴリの校正ルール
 */
export const variantRules = [
  {
    id: 'variant.inconsistency',
    name: '表記揺れ（登録辞書の混在）',
    category: 'variants',
    description: '登録された表記揺れ辞書グループ内の複数表記が同一原稿内に混在している箇所を検出します。',
    defaultSeverity: 'warning',
    defaultEnabled: true,
    defaultOptions: {},
    optionSchema: [],
    check(ctx) {
      const analyses = variantService.analyzeAllGroups(ctx.text, ctx.variantGroups);
      const issues = [];

      for (const analysis of analyses) {
        if (!analysis.hasConflict) continue;
        const { group, termStats, activeTerms, occurrences } = analysis;
        const summary = activeTerms
          .map((t) => `「${t}」(${termStats[t]}回)`)
          .join(' / ');

        for (const occ of occurrences) {
          if (group.preferred && occ.term === group.preferred) continue;

          const targetCandidates = group.preferred
            ? [group.preferred]
            : activeTerms.filter((t) => t !== occ.term);

          const suggestions = targetCandidates.map((target) => ({
            label: `「${target}」に統一`,
            replacement: target,
          }));

          issues.push(
            ctx.createIssue({
              start: occ.start,
              end: occ.end,
              message: `表記揺れ（${group.label}）: 原稿内で ${summary} が混在しています。`,
              suggestions,
              extra: { variantGroupId: group.id },
            })
          );
        }
      }
      return issues;
    },
  },
];
