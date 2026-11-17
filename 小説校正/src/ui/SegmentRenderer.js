import { escapeHtml } from '../utils/textUtils.js';

/**
 * 区間スイープライン方式により、重複・入れ子を含む指摘範囲を破綻なく HTML 化するレンダラ。
 * 複数の指摘が重なる箇所も、該当するすべての issueId を data-issue-ids に保持する。
 */
export class SegmentRenderer {
  /**
   * テキストと指摘配列から最小区間のセグメント配列を構築する
   * @param {string} text
   * @param {any[]} issues
   * @param {{ showIgnoredOnly?: boolean }} [opts]
   * @returns {{ start: number, end: number, text: string, issues: any[], maxSeverity: string | null }[]}
   */
  buildSegments(text, issues, opts = {}) {
    const targetIssues = issues.filter((issue) =>
      opts.showIgnoredOnly ? issue.ignored : !issue.ignored
    );

    if (targetIssues.length === 0) {
      return [{ start: 0, end: text.length, text, issues: [], maxSeverity: null }];
    }

    const pointSet = new Set([0, text.length]);
    for (const issue of targetIssues) {
      const s = Math.max(0, Math.min(issue.start, text.length));
      const e = Math.max(s, Math.min(issue.end, text.length));
      if (e > s) {
        pointSet.add(s);
        pointSet.add(e);
      }
    }

    const points = [...pointSet].sort((a, b) => a - b);
    const segments = [];

    // 20万字規模でも高速にスイープできるよう開始位置でソート済みの指摘をポインタ走査
    const sorted = [...targetIssues]
      .filter((i) => i.end > i.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    let active = [];
    let cursor = 0;

    for (let p = 0; p < points.length - 1; p++) {
      const segStart = points[p];
      const segEnd = points[p + 1];
      if (segEnd <= segStart) continue;

      while (cursor < sorted.length && sorted[cursor].start <= segStart) {
        if (sorted[cursor].end > segStart) {
          active.push(sorted[cursor]);
        }
        cursor++;
      }
      active = active.filter((i) => i.end > segStart);

      const segIssues = active.filter((i) => i.start <= segStart && i.end >= segEnd);
      let maxSeverity = null;
      if (segIssues.length > 0) {
        if (segIssues.some((i) => i.ignored)) {
          maxSeverity = segIssues.some((i) => !i.ignored)
            ? segIssues.some((i) => !i.ignored && i.severity === 'error')
              ? 'error'
              : 'warning'
            : 'ignored';
        } else {
          maxSeverity = segIssues.some((i) => i.severity === 'error') ? 'error' : 'warning';
        }
      }

      segments.push({
        start: segStart,
        end: segEnd,
        text: text.slice(segStart, segEnd),
        issues: segIssues,
        maxSeverity,
      });
    }

    return segments;
  }

  /**
   * 校正プレビュー用 HTML 文字列を生成する
   * @param {string} text
   * @param {any[]} issues
   * @param {{ activeIssueId?: string | null, showIgnoredOnly?: boolean }} [opts]
   * @returns {string}
   */
  renderHtml(text, issues, opts = {}) {
    if (!text) {
      return '<span class="pr-empty-placeholder">ここに原稿を入力するか、TXTファイルをドラッグ＆ドロップしてください。</span>';
    }

    const segments = this.buildSegments(text, issues, opts);
    const activeId = opts.activeIssueId || null;
    const htmlParts = [];

    for (const seg of segments) {
      if (seg.issues.length === 0) {
        htmlParts.push(escapeHtml(seg.text));
        continue;
      }

      const idsAttr = seg.issues.map((i) => escapeHtml(i.id)).join(',');
      const isActive = activeId && seg.issues.some((i) => i.id === activeId);
      const hasOverlap = seg.issues.length > 1;
      const severityClass =
        seg.maxSeverity === 'error'
          ? 'issue-mark--error'
          : seg.maxSeverity === 'ignored'
          ? 'issue-mark--ignored'
          : 'issue-mark--warning';

      const classes = ['issue-mark', severityClass];
      if (isActive) classes.push('is-active');
      if (hasOverlap) classes.push('is-overlap');

      // 改行のみの区間（連続空行指摘など）も視認できるよう改行記号を補助表示する
      let innerHtml = escapeHtml(seg.text);
      if (/^\n+$/.test(seg.text)) {
        innerHtml = seg.text.replace(/\n/g, '<span class="pr-newline-badge">↵</span>\n');
      }

      htmlParts.push(
        `<mark class="${classes.join(' ')}" data-issue-ids="${idsAttr}" tabindex="0">${innerHtml}</mark>`
      );
    }

    // 末尾が改行の場合の高さ確保
    if (text.endsWith('\n')) {
      htmlParts.push(' ');
    }

    return htmlParts.join('');
  }
}
