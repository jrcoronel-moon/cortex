import db from './db';

// Singleton pipeline — loaded once, reused across requests
let pipelinePromise: Promise<any> | null = null;

async function getPipeline() {
  if (!pipelinePromise) {
    // Dynamic import so Next.js doesn't try to bundle for the client
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    pipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return pipelinePromise;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

function chunkText(text: string, maxChars = 500): string {
  // Strip frontmatter, return first chunk (sufficient for MiniLM 256-token limit)
  return text.replace(/^---[\s\S]*?---\n?/, '').slice(0, maxChars);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(chunkText(text), { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function upsertEmbedding(nodeId: string, content: string): Promise<void> {
  const vector = await generateEmbedding(content);
  db.prepare(`
    INSERT INTO embeddings (node_id, vector, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(node_id) DO UPDATE SET vector=excluded.vector, updated_at=excluded.updated_at
  `).run(nodeId, JSON.stringify(vector));
}

export async function reindexAll(): Promise<number> {
  const notes = db.prepare(`
    SELECT id, content FROM nodes
    WHERE type = 'file' AND content IS NOT NULL AND content != ''
    AND id NOT IN (SELECT node_id FROM embeddings)
  `).all() as { id: string; content: string }[];

  for (const note of notes) {
    await upsertEmbedding(note.id, note.content);
  }
  return notes.length;
}

export async function semanticSearch(query: string, workspaceId: string | null, topK = 8): Promise<any[]> {
  const queryVec = await generateEmbedding(query);

  // Load candidate embeddings. When workspaceId is null we scan every file and
  // rely on the caller to filter by per-user read access (see /api/search,
  // /api/ai). When a workspaceId is given we scope STRICTLY to it — legacy
  // workspace_id IS NULL nodes must not leak across tenants.
  const rows = db.prepare(`
    SELECT e.node_id, e.vector, n.name, n.content
    FROM embeddings e
    JOIN nodes n ON n.id = e.node_id
    WHERE n.type = 'file' AND (? IS NULL OR n.workspace_id = ?)
  `).all(workspaceId, workspaceId) as { node_id: string; vector: string; name: string; content: string }[];

  const scored = rows.map(row => {
    const vec = JSON.parse(row.vector) as number[];
    return {
      id: row.node_id,
      name: row.name,
      score: cosineSimilarity(queryVec, vec),
      excerpt: row.content?.replace(/^---[\s\S]*?---\n?/, '').slice(0, 150) ?? '',
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(r => r.score > 0.2); // drop unrelated results
}
