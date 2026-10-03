# Changelog

All notable changes to Cortex are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — First public release

Cortex is open source. This is the initial public version.

### Added
- **Markdown workspace** — tabbed editor, YAML frontmatter, WikiLinks (`[[note]]`),
  syntax highlighting, Mermaid diagrams, editable draw.io diagrams, embedded images.
- **3D knowledge graph** — force-directed WebGL view with AI-discovered connections
  (embedding similarity and shared-term co-occurrence) on top of authored links,
  topic-community colouring, and optional webcam hand-tracking navigation.
- **Semantic search** — local embeddings (MiniLM via transformers.js), no external service.
- **AI assistant** — chat grounded in your notes, using your own API key (BYOK).
- **MCP server** — expose your notes to Claude, Cursor, Continue and any MCP client,
  over OAuth 2.1 + PKCE (web clients) or API keys, scoped per connection.
- **Collaboration** — organizations claimed by email domain, members and roles,
  per-folder sharing with view/edit access, public read-only share links.
- **Import** — Markdown files and folders, Word (.docx), web pages, and PDF (via BYOK).
