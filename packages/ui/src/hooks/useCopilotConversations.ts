import { useCallback, useEffect, useState } from "react";

export interface CopilotConversationSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

interface ListResponse {
  conversations: CopilotConversationSummary[];
}

/**
 * Lists persisted copilot conversations from the server. Pass `refreshKey`
 * to force a refetch — the CopilotPanel passes a counter that bumps
 * whenever a turn finishes, so freshly created or updated conversations
 * appear in the dropdown without a manual reload.
 */
export function useCopilotConversations(active: boolean, refreshKey: number = 0): {
  conversations: CopilotConversationSummary[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const [conversations, setConversations] = useState<CopilotConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/copilot/conversations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setConversations(data.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void fetchList();
  }, [active, refreshKey, fetchList]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await fetch(`/api/copilot/conversations/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Optimistically drop the row, then refetch in the background to
        // resync.
        setConversations((prev) => prev.filter((c) => c.id !== id));
        void fetchList();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [fetchList],
  );

  return {
    conversations,
    isLoading,
    error,
    refetch: fetchList,
    remove,
  };
}
