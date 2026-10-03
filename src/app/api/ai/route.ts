import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import db from '@/lib/db';
import { canReadNode } from '@/lib/permissions';

// embeddings imported lazily in the handler — see note in reindex route.
export const dynamic = 'force-dynamic';

const MAX_CONTEXT_CHARS = 6000;

// Default model per provider when the user hasn't picked one.
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
};

async function callAnthropic(apiKey: string, model: string, system: string, messages: any[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(apiKey: string, model: string, system: string, messages: any[]) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export async function POST(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { messages, workspaceId, nodeId } = await request.json() as {
    messages: { role: 'user' | 'assistant'; content: string }[];
    workspaceId?: string;
    nodeId?: string;
  };

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: 'messages_required' }, { status: 400 });
  }

  // Get BYOK key
  const settings = db.prepare('SELECT byok_provider, byok_key_enc, byok_model FROM user_settings WHERE user_id = ?').get(session.id) as any;
  if (!settings?.byok_key_enc) {
    return NextResponse.json({ error: 'no_byok_key', message: 'Configura tu API key en Ajustes para usar el asistente IA.' }, { status: 402 });
  }

  let apiKey: string;
  try {
    apiKey = decrypt(settings.byok_key_enc);
  } catch {
    return NextResponse.json({ error: 'decryption_failed' }, { status: 500 });
  }

  // Build RAG context
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  let ragContext = '';
  const sources: { id: string; name: string; score: number }[] = [];

  // Current note context — only if the user is allowed to read it.
  if (nodeId && canReadNode(session, nodeId)) {
    const node = db.prepare('SELECT name, content FROM nodes WHERE id = ?').get(nodeId) as any;
    if (node?.content) {
      const preview = node.content.slice(0, 2000);
      ragContext += `\n\n## Nota actual: ${node.name}\n${preview}`;
    }
  }

  // Semantic search context — skip any node the user can't read so RAG never
  // surfaces another tenant's content.
  try {
    const { semanticSearch } = await import('@/lib/embeddings');
    const results = await semanticSearch(lastUserMessage, workspaceId ?? null, 4);
    for (const r of results) {
      if (r.id === nodeId) continue;
      if (!canReadNode(session, r.id)) continue;
      const node = db.prepare('SELECT name, content FROM nodes WHERE id = ?').get(r.id) as any;
      if (!node?.content) continue;
      const remaining = MAX_CONTEXT_CHARS - ragContext.length;
      if (remaining <= 0) break;
      ragContext += `\n\n## Nota relacionada: ${node.name}\n${node.content.slice(0, Math.min(1000, remaining))}`;
      sources.push({ id: r.id, name: node.name, score: r.score });
    }
  } catch {
    // Embeddings not available — continue without RAG
  }

  const system = `Eres un asistente de conocimiento integrado en Cortex, una herramienta de gestión del conocimiento tipo Obsidian.
Responde en el mismo idioma que usa el usuario. Sé conciso y preciso.
${ragContext ? `\n\n# Contexto de la base de conocimiento del usuario:\n${ragContext}` : ''}`.trim();

  try {
    let reply: string;
    if (settings.byok_provider === 'openai') {
      const model = settings.byok_model || DEFAULT_MODEL.openai;
      reply = await callOpenAI(apiKey, model, system, messages);
    } else {
      const model = settings.byok_model || DEFAULT_MODEL.anthropic;
      reply = await callAnthropic(apiKey, model, system, messages);
    }
    return NextResponse.json({ reply, sources });
  } catch (err: any) {
    console.error('[/api/ai]', err.message);
    const msg = err.message?.includes('401') ? 'API key inválida o expirada.' :
                err.message?.includes('429') ? 'Rate limit alcanzado. Espera un momento.' :
                'Error al contactar el proveedor de IA.';
    return NextResponse.json({ error: 'ai_error', message: msg }, { status: 502 });
  }
}
