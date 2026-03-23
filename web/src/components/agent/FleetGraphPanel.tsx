import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentDocument } from '../../contexts/CurrentDocumentContext';

type ShipTarget = 'local' | 'prod';
type SidebarTab = 'chat' | 'scan';

interface Finding {
  id: string;
  title: string;
  detail: string;
  severity?: string;
  category?: string;
  detectionRule?: string;
  recommendation?: string;
  entityIds?: string[];
}

interface FleetGraphResponse {
  summary: string;
  severity: 'critical' | 'warning' | 'info' | 'clean';
  findings: Finding[];
  needsApproval: boolean;
  approvalId?: string;
  tracePath: string;
  chatResponse?: string;
  verification?: {
    context?: { pathname?: string; entityType?: string; entityId?: string; viewDescription?: string };
    graphSteps?: string[];
    langSmithHint?: string;
  };
  _debug?: {
    issueCount?: number;
    weekCount?: number;
    standupCount?: number;
    teamMemberCount?: number;
    dataChanged?: boolean;
    fetchError?: boolean;
  };
}

interface Approval {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  target: string;
  createdAt: string;
  findings: Finding[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  severity?: 'critical' | 'warning' | 'info' | 'clean';
  findings?: Finding[];
  tracePath?: string;
}

export function parseRouteContext(pathname: string): { entityType: string; entityId?: string } {
  const patterns: Array<[RegExp, string]> = [
    [/^\/issues\/([^/]+)/, 'issue'],
    [/^\/projects\/([^/]+)/, 'project'],
    [/^\/programs\/([^/]+)/, 'program'],
    [/^\/sprints\/([^/]+)/, 'sprint'],
    [/^\/documents\/([^/]+)/, 'document'],
  ];
  for (const [regex, entityType] of patterns) {
    const match = pathname.match(regex);
    if (match) return { entityType, entityId: match[1] };
  }
  return { entityType: 'unknown' };
}

const CONTEXTUAL_PROMPTS: Record<string, string[]> = {
  dashboard: ['What should I focus on today?', 'Any blockers across the team?'],
  sprint:    ["How's this sprint tracking?", "Who's behind?", 'Any scope creep?'],
  issue:     ["What's the history of this issue?", 'Is this blocked?'],
  project:   ['What are the risks in this project?', "How's the timeline?"],
  program:   ['Summarize program status', 'What needs attention?'],
  team:      ["Who's overloaded this week?", 'Any missed standups?'],
  unknown:   ['What should I focus on?', 'Summarize recent activity'],
};

export function getSuggestedPrompts(pathname: string, entityType: string): string[] {
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/my-week') || pathname === '/') {
    return CONTEXTUAL_PROMPTS.dashboard;
  }
  return CONTEXTUAL_PROMPTS[entityType] ?? CONTEXTUAL_PROMPTS.unknown;
}

export interface ChatContext {
  pathname: string;
  entityType: string;
  entityId?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  documentType?: string | null;
  documentId?: string | null;
  projectId?: string | null;
}

export function buildChatContext(
  pathname: string,
  user: { id: string; name: string; email: string } | null,
  doc: { type: string | null; id: string | null; projectId: string | null },
): ChatContext {
  const route = parseRouteContext(pathname);
  return {
    pathname,
    entityType: route.entityType,
    entityId: route.entityId,
    userId: user?.id,
    userName: user?.name,
    userEmail: user?.email,
    documentType: doc.type,
    documentId: doc.id,
    projectId: doc.projectId,
  };
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  warning:  'bg-yellow-500/20 text-yellow-400',
  info:     'bg-blue-500/20 text-blue-400',
  clean:    'bg-green-500/20 text-green-400',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info}`}>
      {severity}
    </span>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="rounded border border-border bg-border/30 p-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">{finding.title}</span>
        {finding.severity && <SeverityBadge severity={finding.severity} />}
      </div>
      <div className="mt-0.5 text-muted">{finding.detail}</div>
      {finding.detectionRule && (
        <div className="mt-1 text-[10px] text-muted/70">
          Rule: <code className="rounded bg-background/50 px-1">{finding.detectionRule}</code>
        </div>
      )}
      {finding.recommendation && (
        <div className="mt-1 rounded border-l-2 border-green-500/40 pl-1.5 text-[10px] text-green-400/80">
          {finding.recommendation}
        </div>
      )}
    </div>
  );
}

function TracePathBadge({ tracePath }: { tracePath: string }) {
  const colors: Record<string, string> = {
    clean_path: 'bg-green-500/20 text-green-400',
    hitl_path: 'bg-yellow-500/20 text-yellow-400',
    on_demand_path: 'bg-blue-500/20 text-blue-400',
    error_path: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-mono ${colors[tracePath] ?? 'bg-border text-muted'}`}>
      {tracePath}
    </span>
  );
}

function VerificationDetails({ response }: { response: FleetGraphResponse }) {
  const [open, setOpen] = useState(false);
  if (!response.verification && !response._debug) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-muted hover:text-foreground transition-colors"
      >
        {open ? '▾' : '▸'} Graph details
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded border border-border/50 bg-background/50 p-1.5 text-[10px] text-muted">
          {response.tracePath && (
            <div>Path: <TracePathBadge tracePath={response.tracePath} /></div>
          )}
          {response.verification?.graphSteps && (
            <div>Steps: <code>{response.verification.graphSteps.join(' → ')}</code></div>
          )}
          {response.verification?.context?.viewDescription && (
            <div>View: {response.verification.context.viewDescription}</div>
          )}
          {response._debug && (
            <div>
              Data: {response._debug.issueCount ?? 0} issues, {response._debug.weekCount ?? 0} weeks, {response._debug.standupCount ?? 0} standups, {response._debug.teamMemberCount ?? 0} team
              {response._debug.dataChanged === false && <span className="ml-1 text-yellow-400">(no change)</span>}
            </div>
          )}
          {response.verification?.langSmithHint && (
            <div className="text-muted/60">{response.verification.langSmithHint}</div>
          )}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-lg bg-border/50 px-2.5 py-2">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs ${isUser ? 'bg-accent text-white' : 'bg-border/50 text-foreground'}`}>
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.severity && message.severity !== 'clean' && (
          <SeverityBadge severity={message.severity} />
        )}
        {message.tracePath && (
          <div className="mt-1">
            <TracePathBadge tracePath={message.tracePath} />
          </div>
        )}
        {message.findings && message.findings.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {message.findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getApiBase(): string | undefined {
  return import.meta.env.VITE_FLEETGRAPH_API_URL as string | undefined;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = import.meta.env.VITE_FLEETGRAPH_API_KEY as string | undefined;
  if (key) headers['x-fleetgraph-key'] = key;
  return headers;
}

// ── Background proactive polling (runs whether sidebar is open or not) ──

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let cachedFindingCount = 0;
let cachedScanResult: FleetGraphResponse | null = null;
let lastPollTime = 0;
let pollInProgress = false;

async function runBackgroundScan(): Promise<FleetGraphResponse | null> {
  const apiBase = getApiBase();
  if (!apiBase || pollInProgress) return cachedScanResult;

  pollInProgress = true;
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/proactive/run`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ target: 'prod' }),
    });

    if (!res.ok) return cachedScanResult;

    const data = (await res.json()) as FleetGraphResponse;
    cachedScanResult = data;
    cachedFindingCount = data.findings.length;
    lastPollTime = Date.now();
    return data;
  } catch {
    return cachedScanResult;
  } finally {
    pollInProgress = false;
  }
}

/** Hook for App.tsx to get badge count and start background polling. */
export function useFleetGraphBadge(): number {
  const [badgeCount, setBadgeCount] = useState(cachedFindingCount);

  useEffect(() => {
    // Initial scan if we haven't polled yet
    if (lastPollTime === 0) {
      runBackgroundScan().then((result) => {
        if (result) setBadgeCount(result.findings.length);
      });
    }

    // Poll every 5 minutes
    const interval = setInterval(async () => {
      const result = await runBackgroundScan();
      if (result) setBadgeCount(result.findings.length);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return badgeCount;
}

// ── Proactive Scan Tab ──────────────────────────────────────────────

function ProactiveScanTab() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<FleetGraphResponse | null>(cachedScanResult);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/approvals`, { headers: getHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { approvals: Approval[] };
      setApprovals(data.approvals ?? []);
    } catch {
      // silent
    }
  }, []);

  // Auto-scan on mount if no cached result or stale (>5 min)
  useEffect(() => {
    loadApprovals();

    const isStale = Date.now() - lastPollTime > POLL_INTERVAL_MS;
    if (!cachedScanResult || isStale) {
      setScanning(true);
      runBackgroundScan().then((result) => {
        if (result) setScanResult(result);
        setScanning(false);
        if (result?.needsApproval) loadApprovals();
      });
    }
  }, [loadApprovals]);

  const runScan = async () => {
    setScanning(true);
    setError(null);

    const result = await runBackgroundScan();
    if (result) {
      setScanResult(result);
      if (result.needsApproval) loadApprovals();
    } else {
      setError('Unable to reach FleetGraph.');
    }
    setScanning(false);
  };

  const handleApprovalDecision = async (id: string, decision: 'approved' | 'rejected') => {
    const apiBase = getApiBase();
    if (!apiBase) return;
    try {
      await fetch(`${apiBase.replace(/\/+$/, '')}/api/approvals/${id}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ decision }),
      });
      loadApprovals();
    } catch {
      // silent
    }
  };

  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const filteredApprovals = approvals.filter((a) => approvalFilter === 'all' || a.status === approvalFilter);
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  return (
    <div className="flex h-full flex-col">
      {/* Scan controls */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-foreground">Project Health</p>
            <p className="text-[10px] text-muted">
              {lastPollTime > 0
                ? `Last scan: ${new Date(lastPollTime).toLocaleTimeString()}`
                : 'No scan yet'}
            </p>
          </div>
          <button
            onClick={runScan}
            disabled={scanning}
            className="rounded bg-border px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-border/80 disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Rescan'}
          </button>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 space-y-3 overflow-auto px-3 py-2">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {scanning && !scanResult && <TypingIndicator />}

        {scanResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">Status</span>
              <SeverityBadge severity={scanResult.severity} />
              <TracePathBadge tracePath={scanResult.tracePath} />
              {scanning && <span className="text-[10px] text-muted">(updating...)</span>}
            </div>

            {scanResult.summary && (
              <p className="whitespace-pre-wrap text-xs text-foreground">{scanResult.summary}</p>
            )}

            {scanResult.findings.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
                  Findings ({scanResult.findings.length})
                </p>
                {scanResult.findings.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            )}

            {scanResult.severity === 'clean' && scanResult.findings.length === 0 && (
              <div className="rounded border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-400">
                All clear — no issues detected.
              </div>
            )}

            <VerificationDetails response={scanResult} />
          </div>
        )}

        {/* Approvals (HITL) */}
        {approvals.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Approvals
              </p>
              {pendingApprovals.length > 0 && (
                <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                  {pendingApprovals.length}
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setApprovalFilter(status)}
                  className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                    approvalFilter === status
                      ? 'bg-accent text-white'
                      : 'bg-border/50 text-muted hover:text-foreground'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            {filteredApprovals.map((a) => (
              <div key={a.id} className={`rounded border p-2 text-xs ${
                a.status === 'pending'
                  ? 'border-yellow-500/30 bg-yellow-500/5'
                  : a.status === 'approved'
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
              }`}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">
                      {a.findings.length} finding(s)
                    </span>
                    <SeverityBadge severity={a.status} />
                  </div>
                  <span className="text-[10px] text-muted">
                    {new Date(a.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {a.findings.slice(0, 3).map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
                {a.findings.length > 3 && (
                  <div className="mt-1 text-[10px] text-muted">+{a.findings.length - 3} more</div>
                )}
                {a.status === 'pending' && (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      onClick={() => handleApprovalDecision(a.id, 'approved')}
                      className="rounded bg-green-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-500"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleApprovalDecision(a.id, 'rejected')}
                      className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-500"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
            {filteredApprovals.length === 0 && (
              <p className="text-[10px] text-muted">No {approvalFilter} approvals.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── On-Demand Chat Tab ──────────────────────────────────────────────

function ChatTab() {
  const location = useLocation();
  const { user } = useAuth();
  const { currentDocumentType, currentDocumentId, currentDocumentProjectId } = useCurrentDocument();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [target] = useState<ShipTarget>('prod');

  const routeContext = useMemo(() => parseRouteContext(location.pathname), [location.pathname]);
  const suggestedPrompts = useMemo(
    () => getSuggestedPrompts(location.pathname, routeContext.entityType),
    [location.pathname, routeContext.entityType],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const apiBase = getApiBase();
    if (!apiBase) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'FleetGraph is not configured. Set VITE_FLEETGRAPH_API_URL.',
          timestamp: new Date(),
          severity: 'warning',
        },
      ]);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          target,
          message: text.trim(),
          context: buildChatContext(
            location.pathname,
            user,
            { type: currentDocumentType, id: currentDocumentId, projectId: currentDocumentProjectId },
          ),
        }),
      });

      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);

      const data = (await res.json()) as FleetGraphResponse;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.chatResponse ?? data.summary ?? 'No response.',
          timestamp: new Date(),
          severity: data.severity,
          findings: data.findings,
          tracePath: data.tracePath,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${(e as Error).message}`,
          timestamp: new Date(),
          severity: 'critical',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Context indicator */}
      <div className="border-b border-border px-3 py-1.5">
        <div className="text-[10px] text-muted">
          Context: <code className="text-foreground/60">{location.pathname}</code>
          {user?.name && <span className="ml-1 text-foreground/40">as {user.name}</span>}
          {currentDocumentType && <span className="ml-1 text-foreground/40">({currentDocumentType})</span>}
        </div>
      </div>

      {/* Suggested prompts when empty */}
      {messages.length === 0 && (
        <div className="flex flex-col gap-1.5 px-3 py-3">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Suggestions</p>
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => sendMessage(prompt)}
              disabled={loading}
              className="rounded-md border border-border px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-border/50 hover:text-foreground disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 space-y-3 overflow-auto px-3 py-2">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {loading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask FleetGraph..."
            rows={1}
            className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="rounded bg-accent px-2 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Sidebar Export ─────────────────────────────────────────────

export function FleetGraphSidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('scan');

  return (
    <div className="flex h-full flex-col">
      {/* Tab switcher */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('scan')}
          className={`flex-1 py-1.5 text-center text-xs font-medium transition-colors ${
            activeTab === 'scan'
              ? 'border-b-2 border-accent text-accent'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Scan
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-1.5 text-center text-xs font-medium transition-colors ${
            activeTab === 'chat'
              ? 'border-b-2 border-accent text-accent'
              : 'text-muted hover:text-foreground'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'scan' && <ProactiveScanTab />}
        {activeTab === 'chat' && <ChatTab />}
      </div>
    </div>
  );
}
