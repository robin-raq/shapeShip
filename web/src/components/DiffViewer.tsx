import { useMemo } from 'react';
import DiffMatchPatch from 'diff-match-patch';

// Re-export for backward compatibility — but prefer importing from '@/lib/tiptap-text'
// directly to avoid pulling in diff-match-patch as a side effect.
export { tipTapToPlainText } from '@/lib/tiptap-text';

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  className?: string;
}

/**
 * DiffViewer component — displays inline text diff with visual highlighting.
 *
 * Lazy-load this component to keep diff-match-patch out of the main bundle.
 * Example: const DiffViewer = lazy(() => import('@/components/DiffViewer'));
 */
export function DiffViewer({ oldContent, newContent, className = '' }: DiffViewerProps) {
  const diffs = useMemo(() => {
    const dmp = new DiffMatchPatch();
    const diff = dmp.diff_main(oldContent, newContent);
    dmp.diff_cleanupSemantic(diff);
    return diff;
  }, [oldContent, newContent]);

  return (
    <div className={`font-mono text-sm whitespace-pre-wrap ${className}`}>
      {diffs.map((part, index) => {
        const [operation, text] = part;

        if (operation === -1) {
          return (
            <span
              key={index}
              className="line-through bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
            >
              {text}
            </span>
          );
        }

        if (operation === 1) {
          return (
            <span
              key={index}
              className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
            >
              {text}
            </span>
          );
        }

        return <span key={index}>{text}</span>;
      })}
    </div>
  );
}

export default DiffViewer;
