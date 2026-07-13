import { createFileRoute } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ResumeUpload } from "@/components/ResumeUpload";

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

export const Route = createFileRoute("/index-backup")({
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

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Toaster theme="dark" richColors position="top-right" />

      {/* NAV */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="grid size-6 place-items-center rounded-sm bg-accent">
                <div className="size-2 rounded-[1px] bg-background" />
              </div>
              <span className="font-mono text-sm font-bold tracking-tighter text-accent">
                AGENTIC.OS <span className="text-muted-foreground">//</span> RECRUIT
              </span>
            </div>
            <div className="hidden gap-6 font-mono text-[11px] uppercase tracking-widest text-muted-foreground md:flex">
              <a href="#console" className="transition-colors hover:text-foreground">
                Console
              </a>
              <a href="#architecture" className="transition-colors hover:text-foreground">
                Architecture
              </a>
              <a
                href="https://github.com/langchain-ai/langgraph"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                LangGraph
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1 sm:flex">
              <div
                className={`size-1.5 rounded-full ${running ? "bg-accent animate-pulse" : "bg-muted-foreground"}`}
              />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {running ? "Graph executing" : "System ready"}
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
        {/* HERO / INPUT */}
        <section id="console" className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-3 py-1">
              <span className="size-1.5 rounded-full bg-accent" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
                v2.0 · Resume + JD Analysis
              </span>
            </div>
            <h1 className="text-balance text-4xl font-bold leading-[1.05] tracking-tight md:text-5xl">
              Orchestrate your
              <br />
              next{" "}
              <span className="text-accent [text-shadow:0_0_30px_color-mix(in_oklab,var(--accent)_50%,transparent)]">
                hire.
              </span>
            </h1>
            <p className="max-w-[38ch] text-sm leading-relaxed text-muted-foreground">
              Upload your resume and paste a job description. Watch a supervisor route specialized
              agents to analyze your fit, gather company intel, and generate interview prep — all
              streaming in real time.
            </p>
            <div className="space-y-2 border-l-2 border-border pl-4">
              {AGENT_ORDER.map((id) => (
                <div key={id} className="flex items-center gap-3">
                  <span className={`font-mono text-[10px] font-bold ${AGENT_META[id].color}`}>
                    {AGENT_META[id].short}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {AGENT_META[id].description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6 lg:col-span-8">
            {/* Resume Upload Section */}
            <div className="rounded-xl border border-border bg-card p-1 shadow-2xl shadow-black/40">
              <div className="rounded-lg bg-background p-5">
                <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
                  <div className="flex gap-2">
                    <div className="rounded bg-[color:var(--agent-matcher)] px-2.5 py-1 font-mono text-[10px] text-background">
                      RESUME.pdf
                    </div>
                    <div className="hidden rounded border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground sm:block">
                      personalized analysis
                    </div>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span>{resume.length.toLocaleString()} chars</span>
                  </div>
                </div>
                <ResumeUpload onResumeChange={setResume} resume={resume} disabled={running} />
              </div>
            </div>

            {/* Job Description Section */}
            <div className="rounded-xl border border-border bg-card p-1 shadow-2xl shadow-black/40">
              <div className="rounded-lg bg-background p-5">
                <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
                  <div className="flex gap-2">
                    <div className="rounded bg-secondary px-2.5 py-1 font-mono text-[10px] text-foreground">
                      JOB_DESCRIPTION.txt
                    </div>
                    <div className="hidden rounded border border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground sm:block">
                      utf-8 · plain
                    </div>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span>{jd.length.toLocaleString()} chars</span>
                    <button
                      type="button"
                      onClick={() => setJd(SAMPLE_JD)}
                      className="rounded border border-border px-2 py-0.5 uppercase tracking-wider transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      Load sample
                    </button>
                  </div>
                </div>
                <textarea
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  spellCheck={false}
                  placeholder="Paste the Job Description here..."
                  className="h-40 w-full resize-none border-none bg-transparent font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-0"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-accent" />
                      MODEL: gemini-2.5-flash
                    </span>
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">STREAM: sse</span>
                  </div>
                  <div className="flex gap-2">
                    {running && (
                      <button
                        onClick={stop}
                        className="rounded border border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/20"
                      >
                        Abort
                      </button>
                    )}
                    <button
                      onClick={start}
                      disabled={running || !resume.trim() || !jd.trim()}
                      className="group flex items-center gap-2 rounded bg-accent px-6 py-2.5 font-mono text-xs font-bold uppercase tracking-wider text-accent-foreground shadow-lg shadow-accent/20 transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {running ? "Executing..." : "Start Analysis"}
                      <span className="transition-transform group-hover:translate-x-0.5">→</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* COMMAND CENTER */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:h-[720px]">
          {/* Left: Graph */}
          <div className="flex flex-col rounded-xl border border-border bg-card p-5 lg:col-span-3">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Graph Topology
              </span>
              <span className="font-mono text-[10px] text-accent">{running ? "LIVE" : "IDLE"}</span>
            </div>

            <div className="relative flex flex-1 flex-col items-center justify-center gap-8">
              <GraphNode id="supervisor" state={agents.supervisor} width="w-32" primary />

              {/* Connector lines: SUP → RES / MAT / PREP */}
              <div className="relative w-full flex justify-center">
                {/* Vertical stem down from SUP */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-6 w-px bg-border" />

                {/* Horizontal crossbar */}
                <div className="absolute top-6 left-[16.66%] right-[16.66%] h-px bg-border" />

                {/* Left drop to RES */}
                <div className="absolute top-6 left-[16.66%] h-6 w-px bg-border" />

                {/* Center drop to MAT */}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 h-6 w-px bg-border" />

                {/* Right drop to PREP */}
                <div className="absolute top-6 right-[16.66%] h-6 w-px bg-border" />
              </div>

              <div className="grid w-full grid-cols-3 gap-2">
                {(["researcher", "matcher", "prep"] as AgentId[]).map((id) => (
                  <GraphNode key={id} id={id} state={agents[id]} />
                ))}
              </div>

              <div className="mt-auto w-full space-y-2 border-t border-border pt-4">
                <ToolRow name="web_search" active={agents.researcher.status === "running"} />
                <ToolRow name="read_resume" active={agents.matcher.status === "running"} />
                <ToolRow name="synthesize" active={agents.prep.status === "running"} />
              </div>
            </div>
          </div>

          {/* Main: Trace */}
          <div className="scanline flex flex-col overflow-hidden rounded-xl border border-border bg-card lg:col-span-6">
            <div className="flex items-center justify-between border-b border-border bg-background/50 px-4 py-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Execution Trace
                </span>
                <span className="font-mono text-[9px] text-muted-foreground/60">
                  /var/log/agents.stream
                </span>
              </div>
              <span className="font-mono text-[10px] text-accent">
                {(elapsed / 1000).toFixed(1)}s ELAPSED
              </span>
            </div>

            <div
              ref={traceScrollRef}
              className="grid-bg flex-1 space-y-2 overflow-y-auto p-5 font-mono text-xs leading-relaxed min-h-[380px]"
            >
              {trace.length === 0 && !running && (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <div className="font-mono text-[10px] uppercase tracking-[0.25em]">
                    Awaiting instruction
                  </div>
                  <p className="max-w-xs text-xs">
                    The trace will stream here once the supervisor dispatches the first agent.
                  </p>
                </div>
              )}

              {trace.map((t) => (
                <TraceLine key={t.id} entry={t} />
              ))}

              {AGENT_ORDER.filter((id) => agents[id].status === "running").map((id) => (
                <div
                  key={`stream-${id}`}
                  className="animate-stream rounded border border-border/60 bg-background/60 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`font-mono text-[10px] font-bold ${AGENT_META[id].color}`}>
                      [{AGENT_META[id].label.toUpperCase()}]
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">streaming…</span>
                    <span className="ml-auto inline-block size-1.5 animate-pulse rounded-full bg-accent" />
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[11px] text-foreground/90">
                    {agents[id].output || (
                      <span className="text-muted-foreground">
                        thinking
                        <span className="animate-blink">▍</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {running && AGENT_ORDER.every((id) => agents[id].status !== "running") && (
                <div className="flex items-center gap-2 text-accent">
                  <div className="size-1.5 animate-pulse rounded-full bg-accent" />
                  <span>routing next node...</span>
                </div>
              )}
            </div>
            <div className="scanline-bar" />
          </div>

          {/* Right: Artifacts */}
          <div className="space-y-4 lg:col-span-3">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Match Score
              </div>
              <div className="flex items-baseline gap-2">
                <div className="font-mono text-5xl font-bold tabular-nums">
                  {matchScore ?? "--"}
                  <span className="text-xl text-muted-foreground">%</span>
                </div>
                {agents.matcher.status === "running" && (
                  <span className="font-mono text-[10px] text-accent animate-pulse">
                    computing…
                  </span>
                )}
              </div>
              <div className="mt-3 h-1 w-full overflow-hidden bg-border">
                <div
                  className="h-full bg-accent transition-all duration-500"
                  style={{ width: `${matchScore ?? 0}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Key Gaps
              </div>
              {gaps.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground/60">
                  {agents.matcher.status === "done"
                    ? "No blocking gaps identified."
                    : "Awaiting matcher output…"}
                </p>
              ) : (
                <ul className="space-y-3">
                  {gaps.slice(0, 4).map((g, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm leading-7">
                      <span className="mt-1 shrink-0 font-mono text-destructive">[!]</span>
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

            <div className="rounded-xl bg-accent p-5 text-accent-foreground shadow-lg shadow-accent/20">
              <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-widest">
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
        </section>

        {/* CASE FILE — full agent outputs */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {(["researcher", "matcher", "prep"] as AgentId[]).map((id) => (
            <ArtifactCard
              key={id}
              id={id}
              state={agents[id]}
              className={id === "prep" ? "lg:col-span-2" : undefined}
            />
          ))}
        </section>

        {/* ARCHITECTURE */}
        <section id="architecture" className="rounded-xl border border-border bg-card p-8 md:p-12">
          <div className="mb-10 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Architecture Overview
            </div>
            <h2 className="mt-3 text-2xl font-bold md:text-3xl">Built on LangGraph cycles</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              A stateful supervisor routes tasks across specialized agents, each with their own tool
              set. State is shared, handoffs are explicit, and every step is streamed to the trace.
            </p>
          </div>

          <ArchitectureDiagram />

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <ArchitecturePillar
              title="Cycles > Chains"
              body="Agents can loop back, refine findings, and self-correct on output quality — not just run once."
            />
            <ArchitecturePillar
              title="Shared State"
              body="A typed state object flows between nodes so context persists without token bloat."
            />
            <ArchitecturePillar
              title="Human-in-the-loop"
              body="Built-in breakpoints let a recruiter approve findings before the matcher escalates."
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 px-6 py-6 font-mono text-[10px] text-muted-foreground md:flex-row">
          <span>AGENTIC.OS v1.0.4 // KERNEL STABLE</span>
          <span className="flex gap-6">
            <span>MODEL: GEMINI-2.5-FLASH</span>
            <span>UPTIME: 99.99%</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ------------ Sub-components ------------ */

function GraphNode({
  id,
  state,
  width = "w-full",
  primary = false,
}: {
  id: AgentId;
  state: AgentState;
  width?: string;
  primary?: boolean;
}) {
  const meta = AGENT_META[id];
  const active = state.status === "running";
  const done = state.status === "done";
  const err = state.status === "error";

  return (
    <div className={`${width} flex flex-col items-center`}>
      <div
        className={[
          "relative flex items-center justify-center rounded border font-mono text-[10px] font-bold tracking-wider transition-colors",
          primary ? "h-11" : "h-9",
          "w-full px-2",
          active
            ? "animate-node-active border-accent bg-accent/10 text-accent"
            : done
              ? "border-accent/40 bg-accent/5 text-accent"
              : err
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border bg-background text-muted-foreground",
        ].join(" ")}
      >
        {meta.short}
        {active && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent" />}
      </div>
      <div className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {state.status}
      </div>
    </div>
  );
}

function ToolRow({ name, active }: { name: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between font-mono text-[9px]">
      <span className="text-muted-foreground">TOOL: {name.toUpperCase()}</span>
      <span className={active ? "text-accent animate-pulse" : "text-muted-foreground/60"}>
        {active ? "RUNNING" : "IDLE"}
      </span>
    </div>
  );
}

function TraceLine({ entry }: { entry: TraceEntry }) {
  const meta = AGENT_META[entry.agent];
  const color =
    entry.kind === "error"
      ? "text-destructive"
      : entry.kind === "tool"
        ? "text-[color:var(--agent-researcher)]"
        : meta.color;

  return (
    <div className="animate-stream flex gap-2">
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
        {String(entry.id).padStart(3, "0")}
      </span>
      <span className={`shrink-0 font-mono text-[10px] font-bold ${color}`}>
        [{meta.label.toUpperCase()}]
      </span>
      <span className="text-foreground/90">{entry.text}</span>
    </div>
  );
}

function ArtifactCard({
  id,
  state,
  className,
}: {
  id: AgentId;
  state: AgentState;
  className?: string;
}) {
  const meta = AGENT_META[id];
  return (
    <div className={`rounded-xl border border-border bg-card p-6 ${className ?? ""}`}>
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <span className={`font-mono text-[10px] font-bold ${meta.color}`}>{meta.short}</span>
          <h3 className="font-semibold text-foreground">{meta.label} Report</h3>
        </div>
        <span
          className={[
            "rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
            state.status === "done"
              ? "border-accent/40 text-accent"
              : state.status === "running"
                ? "border-accent/40 text-accent animate-pulse"
                : state.status === "error"
                  ? "border-destructive/40 text-destructive"
                  : "border-border text-muted-foreground",
          ].join(" ")}
        >
          {state.status}
        </span>
      </div>
      {state.output ? (
        <div className="prose-agent break-words text-sm leading-7 text-foreground/90">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h2: ({ node, ...props }) => (
                <h2
                  className="mt-6 mb-3 text-base font-semibold uppercase tracking-[0.2em] text-accent/90"
                  {...props}
                />
              ),
              h3: ({ node, ...props }) => (
                <h3
                  className="mt-5 mb-2 text-sm font-semibold tracking-[0.08em] text-foreground"
                  {...props}
                />
              ),
              p: ({ node, ...props }) => (
                <p className="mb-4 text-[0.95rem] leading-7 text-muted-foreground/90" {...props} />
              ),
              ul: ({ node, ...props }) => (
                <ul
                  className="mb-4 ml-5 list-disc space-y-2 text-[0.95rem] leading-7 text-muted-foreground/90"
                  {...props}
                />
              ),
              li: ({ node, ...props }) => (
                <li className="text-[0.95rem] leading-7 text-muted-foreground/90" {...props} />
              ),
              strong: ({ node, ...props }) => (
                <strong className="font-semibold text-foreground" {...props} />
              ),
            }}
          >
            {state.output}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="font-mono text-xs text-muted-foreground/60">
          {state.status === "running" ? "Streaming output…" : "No output yet. Run the graph."}
        </p>
      )}
    </div>
  );
}

function ArchitecturePillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-accent/40 pl-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-accent">
        {title}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6">
      <div className="rounded-lg border border-border bg-background p-6">
        <div className="flex flex-col items-center gap-4">
          {/* Input */}
          <div className="rounded border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            JOB_DESCRIPTION
          </div>
          <div className="h-6 w-px bg-border" />

          {/* Supervisor */}
          <div className="rounded border border-accent/50 bg-accent/10 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
            ▸ SUPERVISOR NODE
          </div>

          {/* Branches */}
          <div className="relative w-full max-w-lg">
            <div className="mx-auto h-6 w-px bg-border" />
            <div className="mx-auto h-px w-full bg-border" />
            <div className="grid grid-cols-3">
              {(["researcher", "matcher", "prep"] as AgentId[]).map((id) => (
                <div key={id} className="flex flex-col items-center">
                  <div className="h-6 w-px bg-border" />
                  <div
                    className={`rounded border border-border bg-background px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${AGENT_META[id].color}`}
                  >
                    {AGENT_META[id].label}
                  </div>
                  {AGENT_META[id].tool && (
                    <>
                      <div className="my-1 h-4 w-px bg-border/60" />
                      <div className="rounded border border-border/60 bg-background px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                        {AGENT_META[id].tool}()
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 h-px w-32 bg-border" />
          <div className="rounded border border-accent/30 bg-accent/5 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-accent">
            CASE_FILE.pdf
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------ Helpers ------------ */

function extractSection(md: string, header: string): string[] {
  if (!md) return [];
  const re = new RegExp(`\\*\\*${escapeRegex(header)}\\*\\*([\\s\\S]*?)(?=\\n\\*\\*|$)`, "i");
  const m = md.match(re);
  if (!m) return [];
  return extractBulletsFromChunk(m[1]);
}

function extractBullets(md: string, header: string): string[] {
  return extractSection(md, header);
}

function extractBulletsFromChunk(chunk: string): string[] {
  return chunk
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+\.\s+/.test(l))
    .map((l) =>
      l
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
