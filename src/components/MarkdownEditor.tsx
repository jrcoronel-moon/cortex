"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './components.module.css';
import { Eye, Edit3, AlignLeft, CornerRightUp, Tags, Calendar, List, ChevronDown } from 'lucide-react';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'section';

// Flatten ReactMarkdown heading children (strings, arrays, elements) to text.
function nodeText(children: any): string {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join('');
  if (children.props) return nodeText(children.props.children);
  return '';
}
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { parseMarkdownMetadata, stringifyMarkdownMetadata } from '@/lib/metadata';

// Renders a ```mermaid fenced block as an SVG diagram. The mermaid library is
// imported lazily (it's ~2 MB) so it only downloads when a document uses it.
// On a syntax error we fall back to showing the source.
let mermaidSeq = 0;
const MermaidDiagram = React.memo(function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mermaid-d${++mermaidSeq}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSvg('');
    import('mermaid')
      .then(async m => {
        const mermaid = m.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          darkMode: true,
          securityLevel: 'strict',
          fontFamily: 'Outfit, -apple-system, sans-serif',
          themeVariables: { background: 'transparent', primaryColor: '#2a3d5c', primaryTextColor: '#e0e6ed', lineColor: '#6366f1' },
        });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [code]);

  if (failed) {
    return (
      <div className={styles.mermaidWrap}>
        <div className={styles.mermaidError}>Diagrama mermaid con error de sintaxis — mostrando el código:</div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{code}</pre>
      </div>
    );
  }
  if (!svg) return <div className={styles.mermaidWrap} style={{ opacity: 0.4, fontSize: '0.8rem' }}>Renderizando diagrama…</div>;
  return <div className={styles.mermaidWrap} dangerouslySetInnerHTML={{ __html: svg }} />;
});

// Defer image loading until the image nears the viewport. Critical for
// documents with many embedded base64 images: injecting all the data URIs at
// once forces the browser to decode megabytes of pixels upfront and the
// document takes seconds to open. A 1×1 placeholder holds the slot until the
// IntersectionObserver fires (600px lookahead), then the real src swaps in.
const IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function LazyImage({ src, alt, ...props }: any) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const pendingHeight = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    // Big TOP lookahead: when scrolling back up, images swap in far above the
    // viewport instead of right at its edge — the height change would other-
    // wise fight scroll anchoring and the scroll "sticks".
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          pendingHeight.current = ref.current?.getBoundingClientRect().height ?? 0;
          setVisible(true);
          io.disconnect();
          break;
        }
      }
    }, { rootMargin: '2400px 0px 600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // If the swap changed the element's height while it sits ABOVE the viewport,
  // compensate the scroll container so the reading position doesn't jump.
  const onLoad = () => {
    const el = ref.current;
    if (!el || !visible) return;
    const scroller = el.closest('[data-md-scroll]') as HTMLElement | null;
    if (!scroller) return;
    const rect = el.getBoundingClientRect();
    const delta = rect.height - pendingHeight.current;
    pendingHeight.current = rect.height;
    if (delta !== 0 && rect.top < scroller.getBoundingClientRect().top) {
      scroller.scrollTop += delta;
    }
  };

  return (
    <img
      ref={ref}
      src={visible ? src : IMG_PLACEHOLDER}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      onLoad={onLoad}
      className={visible ? undefined : styles.lazyImgPending}
      {...props}
    />
  );
}

// ```drawio fenced block → embedded diagrams.net diagram, EDITABLE in place.
// View: embed.diagrams.net iframe in chromeless mode, fed the XML over the
// postMessage JSON protocol. Edit: full editor in a modal; on Save the new XML
// replaces the old block in the document (autosave then persists it).
// The diagram never leaves the browser except to load the drawio app itself.
const DRAWIO_VIEW_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&chrome=0&nav=0';
const DRAWIO_EDIT_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=dark&saveAndExit=1';
function DrawioDiagram({ xml, onSave }: { xml: string; onSave?: (newXml: string) => void }) {
  const [editing, setEditing] = useState(false);
  const viewRef = useRef<HTMLIFrameElement>(null);
  const editRef = useRef<HTMLIFrameElement>(null);
  const xmlRef = useRef(xml);
  xmlRef.current = xml;

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }

      const isView = viewRef.current && e.source === viewRef.current.contentWindow;
      const isEdit = editRef.current && e.source === editRef.current.contentWindow;
      if (!isView && !isEdit) return;

      if (msg.event === 'init') {
        const target = isView ? viewRef.current! : editRef.current!;
        target.contentWindow?.postMessage(JSON.stringify({ action: 'load', xml: xmlRef.current, autosave: 0 }), '*');
      } else if (msg.event === 'save' && isEdit) {
        if (msg.xml && onSave) onSave(msg.xml);
        if (msg.exit) setEditing(false);
      } else if (msg.event === 'exit' && isEdit) {
        setEditing(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onSave]);

  // Reload the view when the XML changes (e.g. right after an edit was saved).
  useEffect(() => {
    viewRef.current?.contentWindow?.postMessage(JSON.stringify({ action: 'load', xml, autosave: 0 }), '*');
  }, [xml]);

  return (
    <div className={styles.drawioWrap}>
      <div className={styles.drawioBar}>
        <span>Diagrama draw.io</span>
        {onSave && (
          <button onClick={() => setEditing(true)} className={styles.drawioEditBtn}>
            ✏️ Editar diagrama
          </button>
        )}
      </div>
      <iframe ref={viewRef} src={DRAWIO_VIEW_URL} className={styles.drawioFrame} title="Diagrama draw.io" />

      {editing && (
        <div className={styles.drawioModal}>
          <iframe ref={editRef} src={DRAWIO_EDIT_URL} className={styles.drawioModalFrame} title="Editor draw.io" />
        </div>
      )}
    </div>
  );
}

interface MarkdownEditorProps {
  content: string;
  onChange: (newContent: string) => void;
  onNavigate?: (fileName: string) => void;
  forceMode?: 'edit' | 'preview';
  onTagClick?: (tag: string) => void;
}

// Memoized: parsing/rendering the whole markdown document is by far the most
// expensive render in the workspace. With stable callback props (see
// WorkspaceClient's editorOn* wrappers), unrelated workspace state changes
// (modals, search, chat) no longer re-parse the open document.
function MarkdownEditor({ content, onChange, onNavigate, forceMode = 'preview', onTagClick }: MarkdownEditorProps) {
  const mode = forceMode;
  
  const processObsidianLinks = (text: string) => {
    return text.replace(/\[\[(.*?)\]\]/g, '[$1](#$1)');
  };

  const { metadata, cleanContent } = parseMarkdownMetadata(content);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [activeId, setActiveId] = useState<string>('');
  const [tocOpen, setTocOpen] = useState(true);

  // Headings (h1–h3) for the floating "On this page" outline, in document order.
  // Fenced code blocks are stripped so `#` inside code isn't treated as a heading.
  const headings = useMemo(() => {
    const noCode = cleanContent.replace(/```[\s\S]*?```/g, '');
    const out: { level: number; text: string; id: string }[] = [];
    const re = /^(#{1,3})\s+(.+?)\s*#*\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noCode)) !== null) {
      const text = m[2].trim();
      out.push({ level: m[1].length, text, id: `${slugify(text)}-${out.length}` });
    }
    return out;
  }, [cleanContent]);

  // Counter used while rendering so each heading gets the same id as its TOC entry.
  const headingCounter = useRef(0);
  headingCounter.current = 0;

  useEffect(() => {
    if (mode === 'edit' && textAreaRef.current) {
      textAreaRef.current.style.height = 'auto';
      textAreaRef.current.style.height = textAreaRef.current.scrollHeight + 'px';
    }
  }, [cleanContent, mode]);

  const previewRef = useRef<HTMLDivElement>(null);

  // Highlight the heading you're currently reading as you scroll the document.
  useEffect(() => {
    if (mode !== 'preview' || headings.length === 0) return;
    const el = previewRef.current;
    if (!el) return;
    const onScroll = () => {
      const contTop = el.getBoundingClientRect().top;
      let current = headings[0].id;
      for (const h of headings) {
        const he = document.getElementById(h.id);
        if (!he) continue;
        if (he.getBoundingClientRect().top - contTop <= 110) current = h.id;
        else break;
      }
      setActiveId(current);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [mode, headings, cleanContent]);

  const scrollToHeading = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  const headingComponent = (Tag: 'h1' | 'h2' | 'h3') => {
    const Heading = ({ children, ...props }: any) => {
      const id = headings[headingCounter.current]?.id ?? slugify(nodeText(children));
      headingCounter.current += 1;
      return <Tag id={id} {...props}>{children}</Tag>;
    };
    Heading.displayName = `MdHeading_${Tag}`;
    return Heading;
  };

  // Parsing + rendering the markdown is the expensive part, and the TOC scroll
  // highlight (setActiveId) re-renders this component on every heading crossed.
  // Memoise the whole ReactMarkdown element on the content, so scrolling never
  // re-parses the document (that re-parse caused visible hitches — diagrams
  // appearing to "reload" — while scrolling).
  const markdownBody = useMemo(() => {
    headingCounter.current = 0;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Default sanitizer strips data: URIs — re-allow them for embedded
        // base64 images only (src attribute, image mime), nothing else.
        urlTransform={(url: string, key: string) =>
          key === 'src' && url.startsWith('data:image/') ? url : defaultUrlTransform(url)
        }
        components={{
          h1: headingComponent('h1'),
          h2: headingComponent('h2'),
          h3: headingComponent('h3'),
          code({node, inline, className, children, ...props}: any) {
            const match = /language-(\w+)/.exec(className || '');
            if (!inline && match?.[1] === 'mermaid') {
              return <MermaidDiagram code={String(children).replace(/\n$/, '')} />;
            }
            if (!inline && match?.[1] === 'drawio') {
              const xml = String(children).replace(/\n$/, '');
              // Saving replaces the old XML inside this fenced block; the
              // editor's onChange then flows into the normal autosave.
              return <DrawioDiagram xml={xml} onSave={(newXml) => onChange(content.replace(xml, newXml))} />;
            }
            return !inline && match ? (
              <SyntaxHighlighter
                style={vscDarkPlus as any}
                language={match[1]}
                PreTag="div"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          img(props: any) {
            return <LazyImage {...props} />;
          },
          a({href, children, ...props}: any) {
            if (href?.startsWith('#') && onNavigate) {
              return <a href={href} onClick={(e) => { e.preventDefault(); onNavigate(href.substring(1)); }} {...props}>{children}</a>
            }
            return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
          }
        }}
      >
        {processObsidianLinks(cleanContent)}
      </ReactMarkdown>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, headings, onChange, onNavigate]);

  const renderPropertyRow = (Icon: any, label: string, value: any) => {
    if (!value) return null;
    let displayValue;
    if (Array.isArray(value)) {
      displayValue = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {value.map((v: string, i: number) => (
            <span 
              key={i} 
              onClick={() => { if(label === 'tags' && onTagClick) onTagClick(v); }}
              style={{ 
                background: label === 'tags' ? 'rgba(125, 89, 180, 0.2)' : 'var(--surface-2)', 
                color: label === 'tags' ? 'var(--accent-primary)' : 'var(--foreground)', 
                padding: '2px 8px', borderRadius: '12px', fontSize: '0.8rem',
                cursor: label === 'tags' ? 'pointer' : 'default'
              }}
            >
              {v}
            </span>
          ))}
        </div>
      );
    } else {
      displayValue = <span style={{ fontSize: '0.9rem' }}>{String(value)}</span>;
    }

    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', width: '120px', color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
          <Icon size={14} style={{ marginRight: '8px' }} />
          {label}
        </div>
        <div style={{ flex: 1, paddingLeft: '8px' }}>
          {displayValue}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.editorContent} style={{ flexDirection: 'column' }}>

      {mode === 'edit' ? (
        <div className={styles.textAreaContainer} style={{ width: '100%', borderRight: 'none', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'var(--surface-1)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
            <h4 style={{ margin: '0 0 12px 0', opacity: 0.8, fontSize: '0.9rem' }}>Properties</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>title</span>
              <input 
                value={metadata.title || ''} 
                onChange={(e) => onChange(stringifyMarkdownMetadata({ ...metadata, title: e.target.value }, cleanContent))}
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
              />
              
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>aliases</span>
              <input 
                value={metadata.aliases ? metadata.aliases.join(', ') : ''} 
                onChange={(e) => onChange(stringifyMarkdownMetadata({ ...metadata, aliases: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) }, cleanContent))}
                placeholder="Comma separated"
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
              />

              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>tags</span>
              <input 
                value={metadata.tags ? metadata.tags.join(', ') : ''} 
                onChange={(e) => onChange(stringifyMarkdownMetadata({ ...metadata, tags: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) }, cleanContent))}
                placeholder="Comma separated"
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
              />

              {Object.keys(metadata).filter(k => !['title','aliases','tags','created','updated'].includes(k)).map((k, idx) => (
                <div style={{ display: 'contents' }} key={k}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', width: '90px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</span>
                    <button 
                      onClick={() => { const newMeta = { ...metadata }; delete newMeta[k]; onChange(stringifyMarkdownMetadata(newMeta, cleanContent)); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '0' }}
                    >×</button>
                  </div>
                  <input 
                    value={metadata[k]} 
                    onChange={(e) => onChange(stringifyMarkdownMetadata({ ...metadata, [k]: e.target.value }, cleanContent))}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
                  />
                </div>
              ))}

              <div style={{ gridColumn: '1 / -1', marginTop: '8px', display: 'flex', gap: '8px' }}>
                <input 
                  id={`new-prop-key-${Date.now()}`} 
                  placeholder="New property (e.g. cssclasses, domain)" 
                  style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white', flex: 1, fontSize: '0.85rem' }}
                />
                <button 
                  className="btn"
                  onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                    if (input && input.value) {
                      const limit = Object.keys(metadata).filter(k => !['title','aliases','tags','created','updated'].includes(k)).length;
                      if (limit >= 3) {
                        alert("You can only add up to 3 custom fields.");
                        return;
                      }
                      onChange(stringifyMarkdownMetadata({ ...metadata, [input.value]: '' }, cleanContent));
                      input.value = '';
                    }
                  }}
                  style={{ padding: '4px 8px' }}
                >
                  Add Field
                </button>
              </div>
            </div>
          </div>
          <textarea
            ref={textAreaRef}
            className={styles.markdownInput}
            value={cleanContent}
            onChange={(e) => onChange(stringifyMarkdownMetadata(metadata, e.target.value))}
            placeholder="Start typing markdown content..."
            style={{ minHeight: '300px', overflow: 'hidden', resize: 'none', flexShrink: 0 }}
          />
        </div>
      ) : (
        <div ref={previewRef} data-md-scroll className={styles.previewContainer} style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
          <div className={styles.prose}>
            {Object.keys(metadata).length > 0 && (
              <div style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid var(--border-light)' }}>
                <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '1.2em', opacity: 0.9 }}>Properties</h3>
                {renderPropertyRow(AlignLeft, 'title', metadata.title)}
                {renderPropertyRow(CornerRightUp, 'aliases', metadata.aliases)}
                {renderPropertyRow(Tags, 'tags', metadata.tags)}
                {renderPropertyRow(Calendar, 'created', metadata.created)}
                {renderPropertyRow(Calendar, 'updated', metadata.updated)}
                
                {/* Render any other extra frontmatter properties */}
                {Object.keys(metadata).filter(k => !['title','aliases','tags','created','updated'].includes(k)).map(k => (
                  <div key={k}>{renderPropertyRow(AlignLeft, k, metadata[k])}</div>
                ))}
              </div>
            )}

            {markdownBody}
          </div>
        </div>
      )}

      {mode === 'preview' && headings.length > 0 && (
        <nav className={styles.tocNav} aria-label="On this page">
          <button
            className={styles.tocToggle}
            onClick={() => setTocOpen(o => !o)}
            title={tocOpen ? 'Collapse' : 'Expand'}
            aria-expanded={tocOpen}
          >
            <List size={13} />
            <span style={{ flex: 1, textAlign: 'left' }}>On this page</span>
            <ChevronDown
              size={14}
              style={{ transition: 'transform 0.25s ease', transform: tocOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
          </button>
          <div className={`${styles.tocList} ${tocOpen ? styles.tocListOpen : ''}`}>
            {headings.map(h => (
              <button
                key={h.id}
                className={`${styles.tocLink} ${activeId === h.id ? styles.tocLinkActive : ''}`}
                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                onClick={() => scrollToHeading(h.id)}
                title={h.text}
              >
                {h.text}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

export default React.memo(MarkdownEditor);
