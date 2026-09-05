import path from "node:path";
import { extractDocument } from "./extract/index.js";
import { parseCsvStatement } from "./parsers/csv.js";
import { parsePdfStatement } from "./parsers/pdf.js";
import type { ParsedStatement } from "./types.js";

export async function parseFile(filePath: string): Promise<ParsedStatement> {
  const document = await extractDocument(filePath);
  const options = { fileName: path.basename(filePath) };
  return document.kind === "pdf"
    ? parsePdfStatement(document, options)
    : parseCsvStatement(document, options);
}
