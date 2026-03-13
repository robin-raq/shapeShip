import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface Backlink {
  id: string;
  document_type: string;
  title: string;
  display_id?: string;
}

export const backlinksKeys = {
  all: ['backlinks'] as const,
  byDocument: (documentId: string) => [...backlinksKeys.all, documentId] as const,
};

export function useBacklinksQuery(documentId: string) {
  return useQuery<Backlink[]>({
    queryKey: backlinksKeys.byDocument(documentId),
    queryFn: async () => {
      const response = await apiGet(`/api/documents/${documentId}/backlinks`);
      if (!response.ok) {
        throw new Error('Failed to fetch backlinks');
      }
      return response.json();
    },
    enabled: !!documentId,
    staleTime: 10_000,       // Consider fresh for 10s
    refetchInterval: 30_000, // Poll every 30s (was 5s — far too aggressive)
  });
}
