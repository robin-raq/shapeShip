/**
 * Convert TipTap JSON content to plain text for diffing or display.
 * Recursively extracts text content from the TipTap document structure.
 *
 * Extracted from DiffViewer.tsx so callers can use this utility without
 * pulling in the diff-match-patch dependency.
 */
export function tipTapToPlainText(content: Record<string, unknown> | null | undefined): string {
  if (!content) return '';

  const extractText = (node: Record<string, unknown>): string => {
    if (node.type === 'text' && typeof node.text === 'string') {
      return node.text;
    }

    if (node.type === 'paragraph' || node.type === 'heading') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return childContent + '\n';
    }

    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return Array.isArray(node.content)
        ? node.content.map((child) => extractText(child as Record<string, unknown>)).join('')
        : '';
    }

    if (node.type === 'listItem') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '• ' + childContent;
    }

    if (node.type === 'blockquote') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '> ' + childContent;
    }

    if (node.type === 'codeBlock') {
      const childContent = Array.isArray(node.content)
        ? node.content.map((child) => extractText(child as Record<string, unknown>)).join('')
        : '';
      return '```\n' + childContent + '```\n';
    }

    if (node.type === 'hardBreak') {
      return '\n';
    }

    if (node.type === 'doc' && Array.isArray(node.content)) {
      return node.content.map((child) => extractText(child as Record<string, unknown>)).join('');
    }

    if (Array.isArray(node.content)) {
      return node.content.map((child) => extractText(child as Record<string, unknown>)).join('');
    }

    return '';
  };

  return extractText(content).trim();
}
