import YAML from 'yaml';

export interface DocumentMetadata {
  title?: string;
  aliases?: string[];
  tags?: string[];
  created?: string;
  updated?: string;
  [key: string]: any;
}

export function parseMarkdownMetadata(content: string): { metadata: DocumentMetadata; cleanContent: string } {
  if (!content) return { metadata: {}, cleanContent: '' };

  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match) {
    const yamlString = match[1];
    const cleanContent = content.slice(match[0].length).trim();
    try {
      const parsed = YAML.parse(yamlString);
      return { metadata: parsed || {}, cleanContent };
    } catch (e) {
      console.warn('Failed to parse YAML frontmatter', e);
      return { metadata: {}, cleanContent };
    }
  }

  return { metadata: {}, cleanContent: content };
}

export function stringifyMarkdownMetadata(metadata: DocumentMetadata, cleanContent: string): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return cleanContent;
  }
  const yamlString = YAML.stringify(metadata).trim();
  return `---\n${yamlString}\n---\n\n${cleanContent}`;
}
