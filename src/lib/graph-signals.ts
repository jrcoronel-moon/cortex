// Content-analysis primitives shared by the graph endpoints
// (/api/graph/semantic and /api/graph/related).

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

// Stopwords (EN + ES) so co-occurrence keys on meaningful terms, not glue words.
export const STOP = new Set(`the a an and or but if then else for to of in on at by with from as is are was were be been being this that these those it its it's you your yours we our they them their he she his her not no yes do does did done have has had having will would shan should could can may might must about into over under again more most some such only own same so than too very just also into
el la los las un una unos unas y o pero si entonces sino para de del al a en con por sin sobre bajo entre hacia hasta desde como que qué cual cuál quien quién donde dónde cuando cuándo es son era eran ser estar este esta estos estas eso esa ese aquel aquella su sus mi mis tu tus nuestro nuestra sus lo le les se me te nos no ni ya muy más menos también tanto cada todo todos toda todas otro otra otros otras mismo misma`.split(/\s+/).filter(Boolean));

/** Term-frequency map of meaningful words in a markdown document. */
export function topTerms(content: string): Map<string, number> {
  // Strip frontmatter, code fences and markdown noise, then tokenise.
  const text = content
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase();
  const tf = new Map<string, number>();
  const re = /[a-záéíóúñü][a-záéíóúñü0-9_-]{2,}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = m[0];
    if (w.length < 4 || STOP.has(w)) continue;
    tf.set(w, (tf.get(w) || 0) + 1);
  }
  return tf;
}

/** Wikilink targets ([[name]] / [[name|alias]]) in a markdown document. */
export function parseWikiLinkTargets(content: string): string[] {
  const out: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) out.push(match[1].trim());
  return out;
}

/** Internal markdown-link hrefs ([text](path)), excluding images/external/anchors. */
export function parseInternalMdLinks(content: string): string[] {
  const stripped = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const out: string[] = [];
  const regex = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = regex.exec(stripped)) !== null) {
    const url = match[1].trim();
    if (!url || /^(https?:|mailto:|tel:|ftp:|data:|#)/i.test(url)) continue;
    out.push(url);
  }
  return out;
}
