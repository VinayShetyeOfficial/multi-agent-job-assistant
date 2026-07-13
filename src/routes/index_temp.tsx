import { createFileRoute } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ResumeUpload } from "@/components/ResumeUpload";
import { Sparkles, FileCheck, Code, Brain, Zap, X, Loader2 } from "lucide-react";

type AgentId = "supervisor" | "researcher" | "matcher" | "prep";
type AgentStatus = "idle" | "running" | "done" | "error";

interface TraceEntry {
  id: string;
  agent: AgentId;
  kind: "info" | "token" | "result" | "error" | "tool";
  text: string;
}

interface AgentState {
  status: AgentStatus;
  output: string;
  startedAt?: number;
  finishedAt?: number;
}

const AGENT_META: Record<
  AgentId,
  { label: string; short: string; color: string; description: string; tool?: string }
> = {
  supervisor: {
    label: "Supervisor",
    short: "SUP",
    color: "text-accent",
    description: "Routes tasks across the agent graph",
  },
  researcher: {
    label: "Researcher",
    short: "RES",
    color: "text-[color:var(--agent-researcher)]",
    description: "Company & market intelligence",
    tool: "web_search",
  },
  matcher: {
    label: "Matcher",
    short: "MAT",
    color: "text-[color:var(--agent-matcher)]",
    description: "Resume ↔ JD gap analysis",
    tool: "read_resume",
  },
  prep: {
    label: "Prep Agent",
    short: "PREP",
    color: "text-[color:var(--agent-prep)]",
    description: "Interview prep synthesis",
  },
};

const AGENT_ORDER: AgentId[] = ["supervisor", "researcher", "matcher", "prep"];

const SAMPLE_JD = `Role: Senior Backend Engineer — Distributed Systems
Company: Northstar Labs (Series C, real-time infra)

We're looking for an engineer to own the core event pipeline that
powers our low-latency trading analytics platform. You'll design
gRPC services in Rust, deploy Kubernetes operators, and work
closely with the ML platform team on feature-store latency.

Requirements:
- 5+ years backend experience, ideally in Rust or Go
- Deep understanding of distributed systems (consensus, sharding)
- Experience running Kubernetes at scale, ideally with custom operators
- Comfortable with observability: Prometheus, OpenTelemetry
- Bonus: prior exposure to feature stores or ML infra`;

export const Route = createFileRoute("/index_temp")({
  component: Index,
});

function Index() {
  const [jd, setJd] = useState<string>(SAMPLE_JD);
  const [resume, setResume] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [agents, setAgents] = useState<Record<AgentId, AgentState>>({
    supervisor: { status: "idle", output: "" },
    researcher: { status: "idle", output: "" },
    matcher: { status: "idle", output: "" },
    prep: { status: "idle", output: "" },
  });
  const [startTs, setStartTs] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const traceScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!running || startTs == null) return;
    const id = setInterval(() => setElapsed(Date.now() - startTs), 100);
    return () => clearInterval(id);
  }, [running, startTs]);

  useEffect(() => {
    const el = traceScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trace]);

  const matchScore = useMemo(() => {
    const m = agents.matcher.output.match(/(\d{2,3})\s*%/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (isNaN(n)) return null;
    return Math.min(100, Math.max(0, n));
  }, [agents.matcher.output]);

  const gaps = useMemo(
    () => extractSection(agents.matcher.output, "Gaps"),
    [agents.matcher.output],
  );
  const suggestedQuestion = useMemo(() => {
    const questions = extractBullets(agents.prep.output, "Likely Technical Questions");
    return questions[0] ?? null;
  }, [agents.prep.output]);

  const reset = useCallback(() => {
    setTrace([]);
    setAgents({
      supervisor: { status: "idle", output: "" },
      researcher: { status: "idle", output: "" },
      matcher: { status: "idle", output: "" },
      prep: { status: "idle", output: "" },
    });
    setElapsed(0);
    setStartTs(null);
  }, []);

  const start = useCallback(async () => {
    if (running) return;
    if (jd.trim().length < 20) {
      toast.error("Paste a longer job description to run the graph.");
      return;
    }
    if (resume.trim().length < 50) {
      toast.error("Please upload or paste your resume to get personalized analysis.");
      return;
    }
    reset();
    setRunning(true);
    setStartTs(Date.now());
    const controller = new AbortController();
    abortRef.current = controller;

    let idCounter = 0;
    const pushTrace = (t: Omit<TraceEntry, "id">) =>
      setTrace((prev) => [...prev, { ...t, id: `t${idCounter++}` }]);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd, resume }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let evt: any;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }

          if (evt.type === "agent_start") {
            const id = evt.agent as AgentId;
            setAgents((a) => ({
              ...a,
              [id]: { ...a[id], status: "running", output: "", startedAt: Date.now() },
            }));
            pushTrace({
              agent: id,
              kind: "info",
              text: `[${AGENT_META[id].label.toUpperCase()}] node activated`,
            });
            const tool = AGENT_META[id].tool;
            if (tool) {
              pushTrace({
                agent: id,
                kind: "tool",
                text: `tool.invoke(${tool}) → streaming`,
              });
            }
          } else if (evt.type === "token") {
            const id = evt.agent as AgentId;
            const delta = String(evt.delta ?? "");
            setAgents((a) => ({
              ...a,
              [id]: { ...a[id], output: a[id].output + delta },
            }));
          } else if (evt.type === "agent_done") {
            const id = evt.agent as AgentId;
            setAgents((a) => ({
              ...a,
              [id]: {
                ...a[id],
                status: "done",
                output: evt.content ?? a[id].output,
                finishedAt: Date.now(),
              },
            }));
            pushTrace({
              agent: id,
              kind: "result",
              text: `[${AGENT_META[id].label.toUpperCase()}] finished (${(evt.content ?? "").length} chars)`,
            });
          } else if (evt.type === "error") {
            const id = (evt.agent as AgentId) ?? "supervisor";
            setAgents((a) => ({ ...a, [id]: { ...a[id], status: "error" } }));
            pushTrace({ agent: id, kind: "error", text: `ERROR: ${evt.message}` });
            toast.error(evt.message ?? "Agent error");
          } else if (evt.type === "done") {
            pushTrace({
              agent: "supervisor",
              kind: "info",
              text: `[SUPERVISOR] graph complete → case file compiled`,
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
      pushTrace({ agent: "supervisor", kind: "error", text: `FATAL: ${msg}` });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [jd, resume, reset, running]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const [showTrace, setShowTrace] = useState(false);
  const [showReports, setShowReports] = useState(true);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground font-sans overflow-hidden">
      <Toaster theme="dark" richColors position="top-right" />

      {/* STICKY HEADER */}
      <nav className="flex-shrink-0 h-14 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="h-full flex items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="grid size-6 place-items-center rounded-sm bg-accent">
                <div className="size-2 rounded-[1px] bg-background" />
              </div>
              <span className="font-mono text-sm font-bold tracking-tighter text-accent">
                AGENTIC.OS <span className="text-muted-foreground">//</span> RECRUIT
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
              <div
                className={`size-1.5 rounded-full ${running ? "bg-accent animate-pulse" : "bg-muted-foreground"}`}
              />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {running ? "EXECUTING" : "READY"}
              </span>
            </div>
            {elapsed > 0 && (
              <span className="font-mono text-[10px] text-accent">
                {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT - TWO COLUMN SPLIT */}
      <div className="flex-1 grid lg:grid-cols-[40%_60%] overflow-hidden">
        {/* LEFT COLUMN - Input & Control */}
        <div className="overflow-y-auto p-6 space-y-6 border-r border-border">
          {/* Hero */}
          {!running && (
            <div className="text-center py-8">
              <h1 className="text-5xl font-bold leading-tight">
                Orchestrate your
                <br />
                next <span className="text-accent">hire.</span>
              </h1>
              <p className="mt-4 text-sm text-muted-foreground max-w-md mx-auto">
                Upload your resume and paste a job description. Watch AI agents analyze fit, research companies, and generate interview prep in real-time.
              </p>
            </div>
          )}

          {/* Agent Status Chips */}
          <div className="flex flex-wrap gap-2 justify-center">
            {AGENT_ORDER.map((id) => {
              const meta = AGENT_META[id];
              const state = agents[id];
              return (
                <div
                  key={id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded border font-mono text-xs ${
                    state.status === "running"
                      ? "border-accent bg-accent/10 text-accent"
                      : state.status === "done"
                        ? "border-accent/40 bg-accent/5 text-accent"
                        : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <span className="font-bold">{meta.short}</span>
                  {state.status === "running" && (
                    <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Resume Upload */}
          <div className="rounded-xl border border-border bg-card p-1">
            <div className="rounded-lg bg-background p-4">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-accent">
                  RESUME.pdf
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {resume.length.toLocaleString()} chars
                </span>
              </div>
              <ResumeUpload onResumeChange={setResume} resume={resume} disabled={running} />
            </div>
          </div>

          {/* Job Description */}
          <div className="rounded-xl border border-border bg-card p-1">
            <div className="rounded-lg bg-background p-4">
              <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-secondary">
                  JOB_DESCRIPTION.txt
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {jd.length.toLocaleString()} chars
                  </span>
                  <button
                    type="button"
                    onClick={() => setJd(SAMPLE_JD)}
                    className="font-mono text-[10px] text-accent hover:underline"
                  >
                    LOAD SAMPLE
                  </button>
                </div>
              </div>
              <textarea
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Paste the job description here..."
                className="h-48 w-full resize-none border-none bg-transparent font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            {running ? (
              <button
                onClick={stop}
                className="flex-1 flex items-center justify-center gap-2 rounded bg-destructive/10 border border-destructive/40 px-6 py-3 font-mono text-sm font-bold uppercase tracking-wider text-destructive hover:bg-destructive/20 transition-colors"
              >
                <X className="size-4" />
                ABORT
              </button>
            ) : (
              <button
                onClick={start}
                disabled={!resume.trim() || !jd.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded bg-accent px-6 py-3 font-mono text-sm font-bold uppercase tracking-wider text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Zap className="size-4" />
                START ANALYSIS
              </button>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - Results & Metrics */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Match Score - HUGE Display */}
          {matchScore !== null && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
                MATCH SCORE
              </div>
              <div className="font-mono text-8xl font-bold tabular-nums text-accent">
                {matchScore}
                <span className="text-4xl text-muted-foreground">%</span>
              </div>
              <div className="mt-6 h-3 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-accent transition-all duration-1000"
                  style={{ width: `${matchScore}%` }}
                />
              </div>
              {matchScore >= 70 && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-accent">
                  <span className="text-2xl">✓</span>
                  <span>Strong candidate match</span>
                </div>
              )}
            </div>
          )}

          {/* Graph Topology - Compact */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Graph Topology
              </span>
              <span className="font-mono text-[10px] text-accent">{running ? "LIVE" : "IDLE"}</span>
            </div>
            <div className="flex flex-col items-center gap-6">
              <GraphNode id="supervisor" state={agents.supervisor} width="w-32" primary />
              <div className="relative w-full flex justify-center">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-px bg-border" />
                <div className="absolute top-4 left-[16.66%] right-[16.66%] h-px bg-border" />
                <div className="absolute top-4 left-[16.66%] h-4 w-px bg-border" />
                <div className="absolute top-4 left-1/2 -translate-x-1/2 h-4 w-px bg-border" />
                <div className="absolute top-4 right-[16.66%] h-4 w-px bg-border" />
              </div>
              <div className="grid w-full grid-cols-3 gap-2">
                {(["researcher", "matcher", "prep"] as AgentId[]).map((id) => (
                  <GraphNode key={id} id={id} state={agents[id]} />
                ))}
              </div>
            </div>
          </div>

          {/* Key Gaps */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
              Key Gaps Identified
            </div>
            {gaps.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground/60">
                {agents.matcher.status === "done"
                  ? "✓ No blocking gaps identified."
                  : "⋯ Awaiting matcher analysis…"}
              </p>
            ) : (
              <ul className="space-y-3 max-h-[300px] overflow-y-auto">
                {gaps.map((g, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-6">
                    <span className="shrink-0 font-mono text-xs text-destructive">[{i + 1}]</span>
                    <div className="min-w-0 text-muted-foreground/95">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ node, ...props }) => <span {...props} />,
                          strong: ({ node, ...props }) => (
                            <strong className="font-semibold text-foreground" {...props} />
                          ),
                        }}
                      >
                        {g}
                      </ReactMarkdown>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Suggested Question */}
          <div className="rounded-xl bg-accent p-5 text-accent-foreground shadow-lg shadow-accent/20">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest mb-3">
              Suggested Prep Question
            </div>
            <p className="text-sm font-medium leading-relaxed">
              {suggestedQuestion ? (
                `"${suggestedQuestion}"`
              ) : (
                <span className="opacity-70">
                  Prep agent will generate a tailored question here.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION - Collapsible Trace & Reports */}
      <div className="flex-shrink-0 border-t border-border bg-card">
        {/* Execution Trace */}
        <div>
          <button
            onClick={() => setShowTrace(!showTrace)}
            className="w-full flex items-center justify-between px-6 py-3 hover:bg-background/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {showTrace ? "▼" : "▶"} Execution Trace
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/60">
                {trace.length} events
              </span>
            </div>
            <span className="font-mono text-[10px] text-accent">
              {(elapsed / 1000).toFixed(1)}s ELAPSED
            </span>
          </button>
          {showTrace && (
            <div
              ref={traceScrollRef}
              className="grid-bg scanline max-h-[300px] overflow-y-auto px-6 pb-4 space-y-2 font-mono text-xs"
            >
              {trace.length === 0 && !running ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <p className="text-xs">Awaiting execution...</p>
                </div>
              ) : (
                trace.map((t) => <TraceLine key={t.id} entry={t} />)
              )}
              {AGENT_ORDER.filter((id) => agents[id].status === "running").map((id) => (
                <div
                  key={`stream-${id}`}
                  className="animate-stream rounded border border-border/60 bg-background/60 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`font-mono text-[10px] font-bold ${AGENT_META[id].color}`}>
                      [{AGENT_META[id].label.toUpperCase()}]
                    </span>
                    <span className="ml-auto size-1.5 animate-pulse rounded-full bg-accent" />
                  </div>
                  <div className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words">
                    {agents[id].output || "thinking..."}
                  </div>
                </div>
              ))}
              <div className="scanline-bar" />
            </div>
          )}
        </div>

        {/* Agent Reports */}
        <div>
          <button
            onClick={() => setShowReports(!showReports)}
            className="w-full flex items-center justify-between px-6 py-3 hover:bg-background/50 transition-colors border-t border-border"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {showReports ? "▼" : "▶"} Agent Reports
              </span>
              <span className="font-mono text-[9px] text-accent">
                {AGENT_ORDER.filter((id) => agents[id].status === "done").length} / 3 COMPLETE
              </span>
            </div>
          </button>
          {showReports && (
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto">
              {(["researcher", "matcher", "prep"] as AgentId[]).map((id) => (
                <ArtifactCard key={id} id={id} state={agents[id]} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
