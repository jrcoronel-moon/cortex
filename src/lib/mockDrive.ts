export type NodeType = 'folder' | 'file';

export interface DriveNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  content?: string; // Markdown content if it's a file
  updatedAt: string;
}

// Initial Mock Data
export const mockFileSystem: DriveNode[] = [
  { id: '1', name: 'Cortex', type: 'folder', parentId: null, updatedAt: new Date().toISOString() },
  { id: '2', name: 'Engineering', type: 'folder', parentId: '1', updatedAt: new Date().toISOString() },
  { id: '3', name: 'Product', type: 'folder', parentId: '1', updatedAt: new Date().toISOString() },
  {
    id: '4',
    name: 'Architecture.md',
    type: 'file',
    parentId: '2',
    content: '# Architecture\n\nWelcome to Cortex architecture. It uses Next.js and Vanilla CSS.\n\nSee [[Design Docs]] for more.',
    updatedAt: new Date().toISOString()
  },
  {
    id: '5',
    name: 'Design Docs.md',
    type: 'file',
    parentId: '3',
    content: '# Design Docs\n\nThe UI focuses on Glassmorphism and modern colors.\nLink to [[Architecture]].',
    updatedAt: new Date().toISOString()
  },
  {
    id: '6',
    name: 'Welcome.md',
    type: 'file',
    parentId: null,
    content: '# Welcome to Cortex\n\nThis is a collaborative knowledge base. Navigate using the sidebar to the left. You can link pages using double brackets like [[Architecture]].',
    updatedAt: new Date().toISOString()
  }
];

export async function getFiles(): Promise<DriveNode[]> {
  // Simulate network delay
  return new Promise((resolve) => {
    setTimeout(() => resolve(mockFileSystem), 300);
  });
}
