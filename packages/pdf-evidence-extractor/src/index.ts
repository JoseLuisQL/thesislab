// pdf-evidence-extractor — PDF extraction metadata and status normalization

export type PdfExtractionStatus = 'not_attempted' | 'succeeded' | 'degraded' | 'failed';

export type IntakeFailureDiagnostic = {
  code: string;
  message: string;
  detail?: string;
};

export type PdfExtractionOutcome = {
  pdfExtractionStatus: PdfExtractionStatus;
  pdfMetadata: Record<string, unknown> | null;
  warnings: string[];
  failures: IntakeFailureDiagnostic[];
};

export function derivePdfExtractionMetadata(
  pdfText: string | null,
  pdfMetadata: Record<string, unknown> | null,
): PdfExtractionOutcome {
  if (!pdfText && !pdfMetadata) {
    return {
      pdfExtractionStatus: 'failed',
      pdfMetadata: null,
      warnings: [],
      failures: [{ code: 'PDF_TEXT_UNAVAILABLE', message: 'PDF extraction failed because no text or metadata could be recovered.' }],
    };
  }

  if (!pdfText || pdfText.trim().length < 50) {
    return {
      pdfExtractionStatus: 'degraded',
      pdfMetadata: pdfMetadata ?? null,
      warnings: ['PDF extraction degraded because extracted text was weak or incomplete.'],
      failures: [],
    };
  }

  return {
    pdfExtractionStatus: 'succeeded',
    pdfMetadata: pdfMetadata ?? null,
    warnings: [],
    failures: [],
  };
}

export function normalizePdfExtractionStatus(value: string): PdfExtractionStatus {
  switch (value) {
    case 'not_attempted':
    case 'succeeded':
    case 'degraded':
    case 'failed':
      return value;
    default:
      return 'not_attempted';
  }
}

// --- Real PDF text extraction ---

export type PdfTextResult = {
  text: string;
  numPages: number;
  metadata: Record<string, unknown>;
};

export async function extractPdfText(buffer: Buffer): Promise<PdfTextResult> {
  const { PDFParse } = await import('pdf-parse') as unknown as { PDFParse: new () => { parse: (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }> } };
  const parser = new PDFParse();
  const result = await parser.parse(buffer);

  return {
    text: result.text ?? '',
    numPages: result.numpages ?? 0,
    metadata: result.info ?? {},
  };
}

