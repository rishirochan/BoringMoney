import { promises as fs } from "node:fs";

import type { ExtractedCsv } from "../types.js";

const DELIMITERS = [",", ";", "\t", "|"] as const;
const SAMPLE_LINE_LIMIT = 20;

type Delimiter = (typeof DELIMITERS)[number];
type DelimiterScore = {
  delimiter: Delimiter;
  variance: number;
  total: number;
};

function stripBom(text: string): string {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function sampleDelimiterCounts(text: string): Map<Delimiter, number[]> {
  const samples = new Map(DELIMITERS.map((delimiter) => [delimiter, [] as number[]]));
  let counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let inQuotes = false;
  let line = "";

  const finishLine = () => {
    if (line.trim()) {
      for (const delimiter of DELIMITERS) samples.get(delimiter)?.push(counts.get(delimiter) ?? 0);
    }
    counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
    line = "";
  };

  for (let index = 0; index < text.length && (samples.get(",")?.length ?? 0) < SAMPLE_LINE_LIMIT; index++) {
    const character = text[index] ?? "";
    if (character === "\"") {
      if (inQuotes && text[index + 1] === "\"") {
        line += "\"\"";
        index++;
      } else {
        inQuotes = !inQuotes;
        line += character;
      }
      continue;
    }
    if (!inQuotes && character === "\r" && text[index + 1] === "\n") {
      finishLine();
      index++;
      continue;
    }
    if (!inQuotes && character === "\n") {
      finishLine();
      continue;
    }
    line += character;
    if (!inQuotes && DELIMITERS.includes(character as Delimiter)) {
      const delimiter = character as Delimiter;
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  if (line && (samples.get(",")?.length ?? 0) < SAMPLE_LINE_LIMIT) finishLine();
  return samples;
}

function scoreDelimiter(delimiter: Delimiter, counts: number[]): DelimiterScore | undefined {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return undefined;
  const mean = total / counts.length;
  const variance = counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length;
  return { delimiter, variance, total };
}

function isBetterScore(candidate: DelimiterScore, current: DelimiterScore): boolean {
  if (candidate.variance !== current.variance) return candidate.variance < current.variance;
  return candidate.total > current.total;
}

function sniffDelimiter(text: string): Delimiter {
  const samples = sampleDelimiterCounts(text);
  let best: DelimiterScore | undefined;
  for (const delimiter of DELIMITERS) {
    const score = scoreDelimiter(delimiter, samples.get(delimiter) ?? []);
    if (score && (!best || isBetterScore(score, best))) best = score;
  }
  return best?.delimiter ?? ",";
}

// Lenient on purpose: bank exports are sloppy (stray quotes in descriptions, bare CR
// line endings). A malformed cell should never fail a whole statement import.
function parseRows(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field.trim());
    field = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((cell) => cell.trim())) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index] ?? "";
    if (inQuotes) {
      if (character !== "\"") {
        field += character;
      } else if (text[index + 1] === "\"") {
        field += "\"";
        index++;
      } else {
        inQuotes = false;
        closedQuote = true;
      }
      continue;
    }
    if (character === "\"" && field.length === 0 && !closedQuote) {
      inQuotes = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\r") {
      finishRow();
      if (text[index + 1] === "\n") index++;
    } else if (character === "\n") {
      finishRow();
    } else {
      field += character;
    }
  }

  // An unterminated quote keeps whatever was read as the final field.
  if (row.length > 0 || field.length > 0 || closedQuote || inQuotes) finishRow();
  return rows;
}

function decodeCsv(data: Uint8Array): string {
  const utf8 = Buffer.from(data).toString("utf8");
  return utf8.includes("\uFFFD") ? Buffer.from(data).toString("latin1") : utf8;
}

export async function extractCsv(filePath: string): Promise<ExtractedCsv> {
  const data = await fs.readFile(filePath);
  return extractCsvText(decodeCsv(data));
}

export function extractCsvText(text: string): ExtractedCsv {
  const cleanText = stripBom(text);
  const delimiter = sniffDelimiter(cleanText);
  return { kind: "csv", rows: parseRows(cleanText, delimiter), delimiter };
}
