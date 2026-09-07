export interface DiffLine {
  type: "add" | "delete" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function parseEditDiff(
  targetContent: string,
  replacementContent: string,
  startLine: number = 1
): DiffLine[] {
  const oldLines = targetContent.split("\n");
  const newLines = replacementContent.split("\n");
  const lines: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  for (const oldLine of oldLines) {
    lines.push({
      type: "delete",
      content: oldLine,
      oldLineNumber: startLine + oldIdx,
    });
    oldIdx++;
  }

  for (const newLine of newLines) {
    lines.push({
      type: "add",
      content: newLine,
      newLineNumber: startLine + newIdx,
    });
    newIdx++;
  }

  return lines;
}
