import type { ZoteroItemPayload } from './index.js';
/**
 * Convert a single Zotero item to a BibTeX entry string.
 */
export declare function zoteroItemToBibtex(item: ZoteroItemPayload): string;
/**
 * Convert a collection of Zotero items to a complete .bib file content string.
 */
export declare function exportCollectionToBibtex(items: ZoteroItemPayload[]): string;
