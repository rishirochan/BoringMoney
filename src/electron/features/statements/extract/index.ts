import path from "node:path";

import type { ExtractedDocument } from "../types.js";
import { extractCsv } from "./csv.js";
import { extractPdf } from "./pdf.js";

export { extractCsv, extractCsvText } from "./csv.js";
export { extractPdf, extractPdfBuffer } from "./pdf.js";

export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return extractPdf(filePath);
  if (extension === ".csv") return extractCsv(filePath);
  throw new Error("unsupported file type");
}
