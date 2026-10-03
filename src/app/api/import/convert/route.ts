import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import db from '@/lib/db';
import TurndownService from 'turndown';
// @ts-ignore - turndown-plugin-gfm ships no types
import { gfm } from 'turndown-plugin-gfm';

// mammoth / linkedom / readability / pdf-parse need Node APIs, not the edge runtime.
export const runtime = 'nodejs';

const DEFAULT_MODEL: Record<string, string> = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o-mini' };

async function callAnthropic(apiKey: string, model: string, system: string, userText: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: 'user', content: userText }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(apiKey: string, model: string, system: string, userText: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function toMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  td.use(gfm); // tables, strikethrough, task lists
  return td.turndown(html || '').trim();
}

// Basic SSRF guard: no internal/loopback/link-local hosts (blocks cloud metadata etc.).
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

export async function POST(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const contentType = request.headers.get('content-type') || '';

  try {
    // ── File upload: Word (.docx) or PDF (.pdf) ────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
      const name = file.name || 'document';
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: 'too_large', message: 'El archivo supera 15 MB.' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());

      // Word (.docx) → mammoth → turndown. Images are embedded as base64 data
      // URIs (the viewer lazy-loads them); oversized ones are skipped with a
      // notice so a photo-heavy doc can't balloon the database.
      if (/\.docx$/i.test(name)) {
        const m: any = await import('mammoth');
        const mammoth = m.default || m;
        const MAX_IMG_B64 = 1_500_000; // ~1.1 MB binary per image
        let skippedImages = 0;
        const result = await mammoth.convertToHtml(
          { buffer },
          {
            convertImage: mammoth.images.imgElement(async (image: any) => {
              const b64 = await image.read('base64');
              if (b64.length > MAX_IMG_B64) {
                skippedImages++;
                return { src: '' }; // stripped below
              }
              return { src: `data:${image.contentType};base64,${b64}` };
            }),
          }
        );
        let html: string = result.value || '';
        // Drop the placeholders of skipped (oversized) images.
        html = html.replace(/<img\b[^>]*src=""[^>]*>/gi, '');
        let markdown = toMarkdown(html);
        if (skippedImages > 0) {
          markdown = `> ⚠️ ${skippedImages} imagen${skippedImages > 1 ? 'es superan' : ' supera'} el tamaño máximo (≈1 MB) y no se importó${skippedImages > 1 ? 'aron' : ''}. El resto quedó embebido en el documento.\n\n${markdown}`;
        }
        return NextResponse.json({ title: name.replace(/\.docx$/i, ''), markdown });
      }

      // PDF → extract text → restructure to Markdown with the user's own AI (BYOK).
      if (/\.pdf$/i.test(name)) {
        const settings = db.prepare('SELECT byok_provider, byok_key_enc, byok_model FROM user_settings WHERE user_id = ?').get(session.id) as any;
        if (!settings?.byok_key_enc) {
          return NextResponse.json({ error: 'no_byok', message: 'La conversión de PDF usa tu IA. Configura tu API key (BYOK) en Ajustes para habilitarla.' }, { status: 402 });
        }

        // unpdf: pure-JS PDF text extraction (no native deps) — builds cleanly.
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const extracted = await extractText(pdf, { mergePages: true });
        const raw = (extracted as any).text;
        let text = (Array.isArray(raw) ? raw.join('\n\n') : (raw || '')).trim();
        if (!text) {
          return NextResponse.json({ error: 'empty_pdf', message: 'No se pudo extraer texto del PDF (¿es escaneado / solo imágenes?).' }, { status: 400 });
        }

        const MAX = 45000;
        const truncated = text.length > MAX;
        const excerpt = text.slice(0, MAX);

        let apiKey: string;
        try { apiKey = decrypt(settings.byok_key_enc); } catch { return NextResponse.json({ error: 'decryption_failed' }, { status: 500 }); }
        const provider = settings.byok_provider || 'anthropic';
        const model = settings.byok_model || DEFAULT_MODEL[provider] || DEFAULT_MODEL.anthropic;
        const system = 'Convierte el TEXTO EXTRAÍDO DE UN PDF en Markdown limpio y bien estructurado: usa encabezados (#, ##, ###), listas, y tablas en formato GFM cuando corresponda; respeta el orden de lectura. NO inventes contenido, NO agregues preámbulo ni comentarios: responde SOLO con el Markdown.';
        const userText = (truncated ? '[El texto fue truncado por longitud]\n\n' : '') + excerpt;

        let markdown: string;
        try {
          markdown = provider === 'openai'
            ? await callOpenAI(apiKey, model, system, userText)
            : await callAnthropic(apiKey, model, system, userText);
        } catch {
          return NextResponse.json({ error: 'ai_error', message: 'Tu proveedor de IA devolvió un error al convertir el PDF.' }, { status: 502 });
        }
        markdown = (markdown || '').trim();
        if (!markdown) return NextResponse.json({ error: 'ai_empty', message: 'La IA no devolvió contenido.' }, { status: 502 });
        if (truncated) markdown += '\n\n> ⚠️ El PDF era muy largo; se convirtió solo la primera parte.';
        return NextResponse.json({ title: name.replace(/\.pdf$/i, ''), markdown });
      }

      return NextResponse.json({ error: 'unsupported', message: 'Formato no soportado. Usa .docx o .pdf.' }, { status: 400 });
    }

    // ── Web page (URL) ─────────────────────────────────────────────────────
    const body = await request.json().catch(() => ({} as any));
    const url: string = (body?.url || '').trim();
    if (!url) return NextResponse.json({ error: 'no_url' }, { status: 400 });

    let parsed: URL;
    try { parsed = new URL(url); } catch { return NextResponse.json({ error: 'bad_url', message: 'URL inválida.' }, { status: 400 }); }
    if (!/^https?:$/.test(parsed.protocol)) return NextResponse.json({ error: 'bad_url', message: 'Solo http/https.' }, { status: 400 });
    if (isBlockedHost(parsed.hostname)) return NextResponse.json({ error: 'blocked', message: 'Esa URL no está permitida.' }, { status: 400 });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CortexImportBot/1.0)' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return NextResponse.json({ error: 'fetch_failed', message: `La página respondió ${res.status}.` }, { status: 502 });
    if (!(res.headers.get('content-type') || '').includes('text/html')) {
      return NextResponse.json({ error: 'not_html', message: 'La URL no es una página HTML.' }, { status: 400 });
    }
    const html = (await res.text()).slice(0, 3_000_000); // ~3MB cap

    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML(html);

    // Make image/link URLs absolute so web images render (relative and
    // protocol-relative URLs would otherwise break in the note).
    const base = parsed.toString();
    const doc: any = document;
    for (const img of Array.from(doc.querySelectorAll('img[src]')) as any[]) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) continue;
      try { img.setAttribute('src', new URL(src, base).href); } catch {}
    }
    for (const a of Array.from(doc.querySelectorAll('a[href]')) as any[]) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('data:')) continue;
      try { a.setAttribute('href', new URL(href, base).href); } catch {}
    }

    const { Readability } = await import('@mozilla/readability');
    const article = new Readability(document as any).parse();
    const contentHtml = article?.content || (document as any).body?.innerHTML || '';
    return NextResponse.json({
      title: (article?.title || parsed.hostname).trim(),
      markdown: toMarkdown(contentHtml),
      sourceUrl: parsed.toString(),
    });
  } catch (err: any) {
    console.error('[import/convert]', err?.message);
    return NextResponse.json({ error: 'convert_failed', message: 'No se pudo convertir el contenido.' }, { status: 500 });
  }
}
