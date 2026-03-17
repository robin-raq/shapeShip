import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

type ShipTarget = 'local' | 'prod';

interface FleetGraphResponse {
  summary: string;
  severity: 'critical' | 'warning' | 'info' | 'clean';
  findings: Array<{ id: string; title: string; detail: string }>;
  needsApproval: boolean;
  approvalId?: string;
  tracePath: 'clean_path' | 'hitl_path';
}

function parseRouteContext(pathname: string): { entityType: string; entityId?: string } {
  const patterns: Array<[RegExp, string]> = [
    [/^\/issues\/([^/]+)/, 'issue'],
    [/^\/projects\/([^/]+)/, 'project'],
    [/^\/programs\/([^/]+)/, 'program'],
    [/^\/sprints\/([^/]+)/, 'sprint'],
    [/^\/documents\/([^/]+)/, 'document']
  ];
  for (const [regex, entityType] of patterns) {
    const match = pathname.match(regex);
    if (match) return { entityType, entityId: match[1] };
  }
  return { entityType: 'unknown' };
}

export function FleetGraphPanel() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<ShipTarget>('prod');
  const [prompt, setPrompt] = useState('What should I focus on here?');
  const [result, setResult] = useState<FleetGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const routeContext = useMemo(() => parseRouteContext(location.pathname), [location.pathname]);

  const runChat = async () => {
    const apiBase = import.meta.env.VITE_FLEETGRAPH_API_URL as string | undefined;
    if (!apiBase) {
      setError('VITE_FLEETGRAPH_API_URL is not configured.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(import.meta.env.VITE_FLEETGRAPH_API_KEY
            ? { 'x-fleetgraph-key': import.meta.env.VITE_FLEETGRAPH_API_KEY as string }
            : {})
        },
        body: JSON.stringify({
          target,
          message: prompt,
          context: {
            pathname: location.pathname,
            entityType: routeContext.entityType,
            entityId: routeContext.entityId
          }
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `FleetGraph request failed (${res.status})`);
      }

      const data = await res.json() as FleetGraphResponse;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg hover:opacity-90"
        >
          FleetGraph
        </button>
      )}

      {open && (
        <div className="w-[360px] rounded-xl border border-border bg-background p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">FleetGraph Assistant</h3>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-muted hover:text-foreground"
              aria-label="Close FleetGraph panel"
            >
              Close
            </button>
          </div>

          <div className="mb-2 text-xs text-muted">
            Context: <code>{location.pathname}</code>
          </div>

          <div className="mb-2 flex items-center gap-2">
            <label className="text-xs text-muted">Target</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as ShipTarget)}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="prod">prod</option>
              <option value="local">local</option>
            </select>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mb-2 min-h-[72px] w-full rounded border border-border bg-background p-2 text-sm"
          />

          <button
            onClick={runChat}
            disabled={loading}
            className="mb-2 w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Running...' : 'Ask FleetGraph'}
          </button>

          {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

          {result && (
            <div className="space-y-2 rounded border border-border bg-background/80 p-2">
              <div className="text-xs">
                <span className="font-medium">Severity:</span> {result.severity} |{' '}
                <span className="font-medium">Path:</span> {result.tracePath}
              </div>
              <p className="text-sm">{result.summary}</p>
              {result.findings.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-auto text-xs">
                  {result.findings.map((finding) => (
                    <li key={finding.id} className="rounded border border-border p-1">
                      <div className="font-medium">{finding.title}</div>
                      <div className="text-muted">{finding.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
