import db from './db';

export interface TextSearchHit {
  id: string;
  name: string;
  snippet: string;
}

/**
 * Build a safe FTS5 MATCH expression from raw user input. We extract word-ish
 * tokens (letters/digits, any script) and turn each into a prefix term, so
 * punctuation or FTS5 operators in the query can't cause a syntax error.
 * Returns null when there's nothing searchable.
 */
function toMatchExpr(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    // Strip characters that are FTS5 query operators/quotes; keep letters
    // (incl. accented) and digits. The tokenizer normalizes diacritics.
    .map(t => t.replace(/["'()*:^\-]/g, '').trim())
    .filter(Boolean)
    .slice(0, 10);
  if (tokens.length === 0) return null;
  return tokens.map(t => `"${t}"*`).join(' ');
}

// Match delimiters: control chars (STX/ETX) that won't appear in document text.
const MARK_START = String.fromCharCode(2);
const MARK_END = String.fromCharCode(3);

// Escape HTML, then turn the control-char markers into <mark> tags. Document
// bodies can contain raw HTML, so we must NOT render the snippet unescaped.
function safeSnippet(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(MARK_START).join('<mark>')
    .split(MARK_END).join('</mark>');
}

/** Full-text search over document names + bodies, ranked by bm25, with snippets. */
export function fullTextSearch(query: string, limit = 30): TextSearchHit[] {
  const match = toMatchExpr(query);
  if (!match) return [];
  // char(2)/char(3) delimit matches so we can HTML-escape before re-inserting <mark>.
  const rows = db.prepare(`
    SELECT node_id AS id,
           name,
           snippet(nodes_fts, 1, char(2), char(3), '…', 12) AS snippet
    FROM nodes_fts
    WHERE nodes_fts MATCH ?
    ORDER BY bm25(nodes_fts)
    LIMIT ?
  `).all(match, limit) as TextSearchHit[];
  return rows.map(r => ({ ...r, snippet: safeSnippet(r.snippet || '') }));
}
