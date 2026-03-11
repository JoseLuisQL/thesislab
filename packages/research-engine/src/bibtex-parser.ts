// research-engine/src/bibtex-parser.ts — Lightweight BibTeX file parser

export type BibtexEntry = {
  key: string;
  type: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  journal: string | null;
  publisher: string | null;
  raw: Record<string, string>;
};

/**
 * Parse a .bib file content into structured entries.
 * Handles @article, @book, @inproceedings, @incollection, @thesis, @techreport, @misc, etc.
 */
export function parseBibtexFile(content: string): BibtexEntry[] {
  const entries: BibtexEntry[] = [];

  // Match @type{key, ... } blocks
  const entryRegex = /@(\w+)\s*\{([^,]*),([^]*?)(?=\n@|\n\s*$)/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(content)) !== null) {
    const type = match[1]!.toLowerCase();
    const key = match[2]!.trim();
    const body = match[3]!;

    // Skip @comment, @preamble, @string
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;

    const fields = parseFields(body);

    const authors = parseAuthors(fields['author'] ?? '');
    const yearStr = fields['year'] ?? '';
    const yearMatch = yearStr.match(/(\d{4})/);

    entries.push({
      key,
      type,
      title: cleanBibtexValue(fields['title'] ?? 'Untitled'),
      authors,
      year: yearMatch ? parseInt(yearMatch[1]!, 10) : null,
      doi: fields['doi'] ?? null,
      journal: cleanBibtexValue(fields['journal'] ?? fields['booktitle'] ?? '') || null,
      publisher: cleanBibtexValue(fields['publisher'] ?? '') || null,
      raw: fields,
    });
  }

  return entries;
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Match field = {value} or field = "value" or field = number
  const fieldRegex = /(\w+)\s*=\s*(?:\{([^}]*(?:\{[^}]*\}[^}]*)*)\}|"([^"]*)"|(\d+))/g;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(body)) !== null) {
    const fieldName = fieldMatch[1]!.toLowerCase();
    const value = fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? '';
    fields[fieldName] = value;
  }

  return fields;
}

function parseAuthors(authorField: string): string[] {
  if (!authorField.trim()) return [];

  return authorField
    .split(/\s+and\s+/i)
    .map((author) => {
      const trimmed = author.trim();
      if (!trimmed) return '';

      // Handle "Last, First" format
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',').map((p) => p.trim());
        return [parts[1], parts[0]].filter(Boolean).join(' ');
      }

      return trimmed;
    })
    .filter(Boolean)
    .map(cleanBibtexValue);
}

function cleanBibtexValue(value: string): string {
  return value
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/\\\\/g, '')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\~/g, '~')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\emph\{([^}]*)\}/g, '$1')
    .trim();
}
