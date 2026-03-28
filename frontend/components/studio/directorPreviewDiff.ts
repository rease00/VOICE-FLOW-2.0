export type DirectorPreviewRowStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export interface DirectorPreviewDiffRow {
  key: string;
  status: DirectorPreviewRowStatus;
  sourceText: string;
  previewText: string;
}

export interface DirectorPreviewDiffSummary {
  totalChanged: number;
  added: number;
  removed: number;
  modified: number;
}

export interface DirectorPreviewDiffModel {
  rows: DirectorPreviewDiffRow[];
  summary: DirectorPreviewDiffSummary;
}

type DiffOperation =
  | { kind: 'unchanged'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string };

const trimBoundaryBlankLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && lines[start]?.trim().length === 0) {
    start += 1;
  }

  while (end >= start && lines[end]?.trim().length === 0) {
    end -= 1;
  }

  return lines.slice(start, end + 1);
};

export const normalizeDirectorPreviewLines = (value: string): string[] => {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  return trimBoundaryBlankLines(normalized.split('\n'));
};

export const normalizeDirectorPreviewComparisonText = (value: string): string =>
  normalizeDirectorPreviewLines(value).join('\n');

const buildLcsTable = (sourceLines: string[], previewLines: string[]): number[][] => {
  const sourceLength = sourceLines.length;
  const previewLength = previewLines.length;
  const table = Array.from({ length: sourceLength + 1 }, () => Array<number>(previewLength + 1).fill(0));

  for (let sourceIndex = sourceLength - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let previewIndex = previewLength - 1; previewIndex >= 0; previewIndex -= 1) {
      if (sourceLines[sourceIndex] === previewLines[previewIndex]) {
        table[sourceIndex]![previewIndex] = (table[sourceIndex + 1]?.[previewIndex + 1] ?? 0) + 1;
      } else {
        table[sourceIndex]![previewIndex] = Math.max(
          table[sourceIndex + 1]?.[previewIndex] ?? 0,
          table[sourceIndex]?.[previewIndex + 1] ?? 0,
        );
      }
    }
  }

  return table;
};

const buildOperations = (sourceLines: string[], previewLines: string[]): DiffOperation[] => {
  const table = buildLcsTable(sourceLines, previewLines);
  const operations: DiffOperation[] = [];
  let sourceIndex = 0;
  let previewIndex = 0;

  while (sourceIndex < sourceLines.length && previewIndex < previewLines.length) {
    const sourceLine = sourceLines[sourceIndex]!;
    const previewLine = previewLines[previewIndex]!;

    if (sourceLine === previewLine) {
      operations.push({ kind: 'unchanged', text: sourceLine });
      sourceIndex += 1;
      previewIndex += 1;
      continue;
    }

    const removeScore = table[sourceIndex + 1]?.[previewIndex] ?? 0;
    const addScore = table[sourceIndex]?.[previewIndex + 1] ?? 0;

    if (removeScore >= addScore) {
      operations.push({ kind: 'removed', text: sourceLine });
      sourceIndex += 1;
    } else {
      operations.push({ kind: 'added', text: previewLine });
      previewIndex += 1;
    }
  }

  while (sourceIndex < sourceLines.length) {
    operations.push({ kind: 'removed', text: sourceLines[sourceIndex] ?? '' });
    sourceIndex += 1;
  }

  while (previewIndex < previewLines.length) {
    operations.push({ kind: 'added', text: previewLines[previewIndex] ?? '' });
    previewIndex += 1;
  }

  return operations;
};

const buildRows = (operations: DiffOperation[]): DirectorPreviewDiffRow[] => {
  const rows: DirectorPreviewDiffRow[] = [];
  let rowIndex = 0;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    const nextOperation = operations[index + 1];
    const nextNextOperation = operations[index + 2];
    const isSinglePairBlock =
      nextOperation &&
      nextOperation.kind !== 'unchanged' &&
      (!nextNextOperation || nextNextOperation.kind === 'unchanged');

    if (operation.kind === 'unchanged') {
      rows.push({
        key: `row-${rowIndex}`,
        status: 'unchanged',
        sourceText: operation.text,
        previewText: operation.text,
      });
      rowIndex += 1;
      continue;
    }

    if (isSinglePairBlock) {
      if (operation.kind === 'removed' && nextOperation.kind === 'added') {
        rows.push({
          key: `row-${rowIndex}`,
          status: 'modified',
          sourceText: operation.text,
          previewText: nextOperation.text,
        });
        rowIndex += 1;
        index += 1;
        continue;
      }

      if (operation.kind === 'added' && nextOperation.kind === 'removed') {
        rows.push({
          key: `row-${rowIndex}`,
          status: 'modified',
          sourceText: nextOperation.text,
          previewText: operation.text,
        });
        rowIndex += 1;
        index += 1;
        continue;
      }
    }

    rows.push({
      key: `row-${rowIndex}`,
      status: operation.kind,
      sourceText: operation.kind === 'removed' ? operation.text : '',
      previewText: operation.kind === 'added' ? operation.text : '',
    });
    rowIndex += 1;
  }

  if (rows.length === 0) {
    rows.push({
      key: 'row-0',
      status: 'unchanged',
      sourceText: '',
      previewText: '',
    });
  }

  return rows;
};

const summarizeRows = (rows: DirectorPreviewDiffRow[]): DirectorPreviewDiffSummary =>
  rows.reduce<DirectorPreviewDiffSummary>(
    (summary, row) => {
      if (row.status === 'added') {
        summary.added += 1;
        summary.totalChanged += 1;
      } else if (row.status === 'removed') {
        summary.removed += 1;
        summary.totalChanged += 1;
      } else if (row.status === 'modified') {
        summary.modified += 1;
        summary.totalChanged += 1;
      }

      return summary;
    },
    {
      totalChanged: 0,
      added: 0,
      removed: 0,
      modified: 0,
    },
  );

export const buildDirectorPreviewDiff = (sourceText: string, previewText: string): DirectorPreviewDiffModel => {
  const sourceLines = normalizeDirectorPreviewLines(sourceText);
  const previewLines = normalizeDirectorPreviewLines(previewText);
  const operations = buildOperations(sourceLines, previewLines);
  const rows = buildRows(operations);

  return {
    rows,
    summary: summarizeRows(rows),
  };
};
