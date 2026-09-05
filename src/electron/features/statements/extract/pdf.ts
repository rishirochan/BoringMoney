import { promises as fs } from "node:fs";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api.js";

import type { ExtractedPdf } from "../types.js";

const DEFAULT_CHAR_WIDTH = 4;
const MINIMUM_LINE_TOLERANCE = 2;
const MAX_COLUMN_SPACES = 8;

type PositionedText = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LineCluster = {
  anchorY: number;
  items: PositionedText[];
};

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function normalizeFragment(text: string): string {
  return text.replace(/ {3,}/g, " ");
}

function positionTextItems(items: Array<TextItem | TextMarkedContent>): PositionedText[] {
  return items.filter(isTextItem).flatMap((item) => {
    if (!item.str.trim()) return [];
    return [{
      str: normalizeFragment(item.str),
      x: Number(item.transform[4]),
      y: Number(item.transform[5]),
      width: item.width,
      height: Math.abs(item.height),
    }];
  });
}

function lineTolerance(items: PositionedText[]): number {
  return Math.max(MINIMUM_LINE_TOLERANCE, median(items.map((item) => item.height)) * 0.5);
}

function clusterIntoLines(items: PositionedText[]): LineCluster[] {
  const tolerance = lineTolerance(items);
  const lines: LineCluster[] = [];
  for (const item of [...items].sort((left, right) => right.y - left.y)) {
    const line = lines.at(-1);
    if (!line || Math.abs(line.anchorY - item.y) > tolerance) {
      lines.push({ anchorY: item.y, items: [item] });
      continue;
    }
    line.items.push(item);
    line.anchorY = line.items.reduce((sum, part) => sum + part.y, 0) / line.items.length;
  }
  return lines;
}

function estimatedCharWidth(item: PositionedText): number {
  const width = item.width / item.str.length;
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_CHAR_WIDTH;
}

function columnSeparator(gap: number, charWidth: number): string {
  const spaceCount = Math.min(MAX_COLUMN_SPACES, Math.max(2, Math.round(gap / charWidth)));
  return " ".repeat(spaceCount);
}

function joinLine(items: PositionedText[]): string {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  let text = sorted[0]?.str ?? "";
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    const charWidth = (estimatedCharWidth(previous) + estimatedCharWidth(current)) / 2;
    const gap = current.x - (previous.x + previous.width);
    const separator = gap <= charWidth ? " " : columnSeparator(gap, charWidth);
    text = `${text.trimEnd()}${separator}${current.str.trimStart()}`;
  }
  return text.trim();
}

function reconstructLines(items: Array<TextItem | TextMarkedContent>): string[] {
  const positioned = positionTextItems(items);
  return clusterIntoLines(positioned)
    .sort((left, right) => right.anchorY - left.anchorY)
    .map((line) => joinLine(line.items))
    .filter(Boolean);
}

function lineHasText(line: string): boolean {
  return (line.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3;
}

async function extractPages(document: PDFDocumentProxy): Promise<string[][]> {
  const pages: string[][] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      pages.push(reconstructLines(content.items));
    } finally {
      page.cleanup();
    }
  }
  return pages;
}

function readablePdfError(cause: unknown): Error {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const message = `${error.name} ${error.message}`.toLowerCase();
  if (message.includes("password")) return new Error("PDF is password protected");
  if (message.includes("invalidpdf") || message.includes("invalid pdf")) {
    return new Error("File is not a valid PDF");
  }
  return error;
}

export async function extractPdf(filePath: string): Promise<ExtractedPdf> {
  const data = await fs.readFile(filePath);
  return extractPdfBuffer(new Uint8Array(data));
}

export async function extractPdfBuffer(data: Uint8Array): Promise<ExtractedPdf> {
  const options = {
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  };
  const loadingTask = getDocument(options);
  let document: PDFDocumentProxy | undefined;
  try {
    document = await loadingTask.promise;
    const pages = await extractPages(document);
    return { kind: "pdf", pages, hasText: pages.some((page) => page.some(lineHasText)) };
  } catch (error) {
    throw readablePdfError(error);
  } finally {
    if (document) await document.cleanup();
    await loadingTask.destroy();
  }
}
