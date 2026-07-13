import { createFileRoute } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ResumeUpload } from "@/components/ResumeUpload";
import {
  Zap,
  X,
  LayoutDashboard,
  TerminalSquare,
  FileText,
  Activity,
  AlertCircle,
  CheckCircle2,
  Maximize2,
} from "lucide-react";

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
  { label: string; short: string; color: string; border: string; tool?: string }
> = {
  supervisor: {
    label: "Supervisor",
    short: "SUP",
    color: "text-emerald-400",
    border: "border-emerald-500/50",
  },
  researcher: {
    label: "Researcher",
    short: "RES",
    color: "text-blue-400",
    border: "border-blue-500/50",
    tool: "web_search",
  },
  matcher: {
    label: "Matcher",
    short: "MAT",
    color: "text-purple-400",
    border: "border-purple-500/50",
    tool: "read_resume",
  },
  prep: {
    label: "Prep Agent",
    short: "PREP",
    color: "text-amber-400",
    border: "border-amber-500/50",
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

// Aggressive smart formatter ONLY for the Supervisor report
const formatSupervisorOutput = (rawText: string) => {
  if (!rawText) return "";
  let text = rawText;
  
  // Remove rogue bullet points from the raw text completely
  text = text.replace(/•/g, "");
  
  // Force line breaks and bolding for known Supervisor key-value pairs
  text = text.replace(/(Candidate:)/gi, "\n\n**Candidate:**");
  text = text.replace(/(Role:)/gi, "\n\n**Role:**");
  text = text.replace(/(Company\/Stack:)/gi, "\n\n**Company/Stack:**");
  
  // Create clean sections for Dispatches
  text = text.replace(/(Dispatch → [A-Z]+:)/gi, "\n\n### $1\n");
  
  // Clean up any double spaces or excessively long newlines we might have created
  text = text.replace(/\n{3,}/g, "\n\n");
  
  return text.trim();
};

export const Route = createFileRoute("/")({
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

  // Modal state - Can now be an AgentId or "gaps"
  const [viewingOutput, setViewingOutput] = useState<AgentId | "gaps" | null>(null);

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
    [agents.matcher.output]
  );

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
      toast.error(
        "Please upload or paste your resume to get personalized analysis."
      );
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
              [id]: {
                ...a[id],
                status: "running",
                output: "",
                startedAt: Date.now(),
              },
            }));
            pushTrace({
              agent: id,
              kind: "info",
              text: `[${AGENT_META[id].label.toUpperCase()}] node activated`,
            });
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
              text: `[${AGENT_META[id].label.toUpperCase()}] finished`,
            });
          } else if (evt.type === "error") {
            const id = (evt.agent as AgentId) ?? "supervisor";
            setAgents((a) => ({ ...a, [id]: { ...a[id], status: "error" } }));
            pushTrace({
              agent: id,
              kind: "error",
              text: `ERROR: ${evt.message}`,
            });
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
    <div className="flex h-screen w-full flex-col font-sans overflow-hidden bg-slate-950 text-slate-200">
      <Toaster theme="dark" richColors position="top-right" />

      {/* FIXED TOP NAVIGATION */}
      <nav className="h-14 shrink-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-7 place-items-center rounded bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <LayoutDashboard className="size-4 text-white" />
          </div>
          <span className="font-mono text-sm font-bold tracking-tight text-slate-100">
            AGENTIC.OS <span className="text-slate-600 font-normal mx-1">/</span> RECRUIT
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 shadow-inner">
            <div
              className={`size-2.5 rounded-full ${
                running ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-slate-600"
              }`}
            />
            <span className="font-mono text-[11px] uppercase font-semibold text-slate-400">
              {running ? "SYSTEM ACTIVE" : "SYSTEM IDLE"}
            </span>
          </div>
          <div className="font-mono text-sm text-emerald-400 font-bold w-16 text-right tabular-nums">
            {(elapsed / 1000).toFixed(1)}s
          </div>
        </div>
      </nav>

      {/* DASHBOARD LAYOUT */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT SIDEBAR - EXPANDED WIDTH */}
        <aside className="w-[450px] shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col z-10 overflow-y-auto">
          <div className="p-6 flex flex-col gap-8">
            
            {/* Header */}
            <div>
              <h2 className="font-mono text-sm font-bold uppercase tracking-widest text-slate-200 flex items-center gap-2 mb-2">
                <FileText className="size-4" />
                Input Parameters
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Provide target role constraints and candidate context to initiate the agentic workflow.
              </p>
            </div>

            {/* Resume Upload Box */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="font-mono text-xs uppercase font-bold tracking-wider text-slate-300">
                  Candidate Resume
                </label>
                <span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                  {resume.length.toLocaleString()} chars
                </span>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 p-4 shadow-inner">
                <ResumeUpload
                  onResumeChange={setResume}
                  resume={resume}
                  disabled={running}
                />
              </div>
            </div>

            {/* JD Input Box */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="font-mono text-xs uppercase font-bold tracking-wider text-slate-300">
                  Target Description
                </label>
                <button
                  onClick={() => setJd(SAMPLE_JD)}
                  className="font-mono text-[10px] text-emerald-400 hover:text-emerald-300 hover:underline transition-all font-semibold"
                >
                  LOAD SAMPLE
                </button>
              </div>
              <div className="rounded border border-slate-800 bg-slate-950 shadow-inner overflow-hidden focus-within:border-emerald-500/50 transition-colors">
                <textarea
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Paste the job description here..."
                  className="h-56 w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-slate-300 placeholder:text-slate-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Action Area - VIBRANT BUTTON */}
            <div className="pt-2">
              {running ? (
                <button
                  onClick={stop}
                  className="w-full flex items-center justify-center gap-2 rounded bg-red-950/40 border border-red-500/50 px-4 py-4 font-mono text-sm font-bold uppercase tracking-wider text-red-400 hover:bg-red-900/40 transition-all"
                >
                  <X className="size-4.5" />
                  Terminate Graph
                </button>
              ) : (
                <button
                  onClick={start}
                  disabled={!resume.trim() || !jd.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded bg-emerald-600 px-4 py-4 font-mono text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Zap className="size-4.5" />
                  Execute Analysis
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* MAIN CANVAS - VISUALIZATION & LOGS */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
          
          {/* TOP HALF: Agent Graph Visualization & Core Metrics */}
          <div className="flex-1 flex min-h-0 border-b border-slate-800 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 relative overflow-hidden">
            
            {/* Grid Pattern Overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080801a_1px,transparent_1px),linear-gradient(to_bottom,#8080801a_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

            {/* Graph Visualization (Stretches full available height) */}
            <div className="flex-1 flex flex-col items-center justify-center p-8 relative z-10">
              <div className="absolute top-6 left-8 font-mono text-xs uppercase font-bold tracking-widest text-slate-500 flex items-center gap-2">
                <Activity className="size-4" />
                Graph Topology
              </div>

              {/* === THE FIXED PERFECT-TOUCH GRAPH LAYOUT === */}
              <div className="flex flex-col items-center w-full max-w-3xl mx-auto mt-4">
                {/* 1. Supervisor */}
                <div className="z-10 w-48">
                  <GraphNode 
                    id="supervisor" 
                    state={agents.supervisor} 
                    primary 
                    onView={() => setViewingOutput("supervisor")}
                  />
                </div>

                {/* 2. Connection Lines - Brighter contrast */}
                <div className="relative w-full h-16 -my-px pointer-events-none flex justify-center">
                  <div className="absolute top-0 w-[2px] h-8 bg-slate-700" />
                  <div className="absolute top-8 left-[calc(100%/6)] right-[calc(100%/6)] h-[2px] bg-slate-700" />
                  <div className="absolute top-8 left-[calc(100%/6)] w-[2px] h-8 bg-slate-700 -translate-x-1/2" />
                  <div className="absolute top-8 left-1/2 w-[2px] h-8 bg-slate-700 -translate-x-1/2" />
                  <div className="absolute top-8 right-[calc(100%/6)] w-[2px] h-8 bg-slate-700 translate-x-1/2" />
                </div>

                {/* 3. Worker Agents Row */}
                <div className="grid grid-cols-3 w-full gap-6 z-10">
                  <div className="flex justify-center">
                    <div className="w-full max-w-[180px]">
                      <GraphNode 
                        id="researcher" 
                        state={agents.researcher} 
                        onView={() => setViewingOutput("researcher")}
                      />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-full max-w-[180px]">
                      <GraphNode 
                        id="matcher" 
                        state={agents.matcher}
                        onView={() => setViewingOutput("matcher")}
                      />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <div className="w-full max-w-[180px]">
                      <GraphNode 
                        id="prep" 
                        state={agents.prep}
                        onView={() => setViewingOutput("prep")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Stats Sidebar */}
            <div className="w-[400px] shrink-0 border-l border-slate-800 bg-slate-900/80 p-6 flex flex-col gap-5 overflow-y-auto relative z-10">
               <div className="font-mono text-xs uppercase font-bold tracking-widest text-slate-500">
                  Case Summary
               </div>
               
               {/* Match Score Block - Compacted to save vertical space */}
               <div className="rounded-lg border border-slate-700 bg-slate-950 p-4 flex flex-col items-center justify-center relative shadow-lg shrink-0">
                 <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400 mb-1">Total Match</div>
                 {matchScore !== null ? (
                   <>
                     <div className="font-mono text-5xl font-bold tabular-nums text-white leading-none pb-2">
                       {matchScore}<span className="text-2xl text-slate-500">%</span>
                     </div>
                     <div className="absolute bottom-0 left-0 h-1.5 bg-slate-800 w-full rounded-b-lg overflow-hidden">
                       <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${matchScore}%` }} />
                     </div>
                   </>
                 ) : (
                   <div className="font-mono text-sm text-slate-600 py-3">Pending Execution</div>
                 )}
               </div>

               {/* Key Gaps Block - Expanding properly to take all remaining vertical space */}
               <div className="rounded-lg border border-slate-700 bg-slate-950 p-5 flex-1 flex flex-col min-h-0 shadow-lg relative group">
                 <div className="font-mono text-[10px] uppercase tracking-wider text-slate-400 flex justify-between items-center mb-3 shrink-0">
                   <div className="flex items-center gap-2">
                     <span>Critical Gaps</span>
                     {gaps.length > 0 && <span className="text-red-400 font-bold bg-red-950/50 px-1.5 py-0.5 rounded">{gaps.length}</span>}
                   </div>
                   {/* Maximize Button for Gaps */}
                   {gaps.length > 0 && (
                     <button 
                       onClick={() => setViewingOutput("gaps")}
                       className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-white transition-colors"
                       title="View full gaps report"
                     >
                       <Maximize2 className="size-3.5" />
                     </button>
                   )}
                 </div>
                 
                 <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                   {gaps.length === 0 ? (
                     <div className="h-full flex items-center justify-center font-mono text-xs text-slate-600 text-center">
                       {agents.matcher.status === "done" ? <span className="text-emerald-400 flex items-center gap-2"><CheckCircle2 className="size-4"/> Alignment OK</span> : "Awaiting matcher block..."}
                     </div>
                   ) : (
                     <ul className="space-y-4">
                       {gaps.map((g, i) => (
                         <li key={i} className="flex gap-3 leading-relaxed text-xs">
                           <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                           <div className="text-slate-300">
                             <ReactMarkdown
                               components={{
                                 p: ({ node, ...props }) => <span {...props} />,
                                 strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />
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
               </div>
            </div>
          </div>

          {/* BOTTOM HALF: Output Terminal (Takes strict 35% height) */}
          <div className="h-[35%] shrink-0 border-t border-slate-800 flex flex-col bg-[#050505] shadow-[inset_0_10px_20px_rgba(0,0,0,0.5)]">
            <div className="h-10 border-b border-slate-800 bg-slate-900 flex items-center px-6 shrink-0">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <TerminalSquare className="size-4" /> System Trace
              </span>
            </div>
            
            <div className="flex-1 p-5 font-mono text-xs overflow-y-auto custom-scrollbar" ref={traceScrollRef}>
              {trace.length === 0 && !running ? (
                <div className="h-full flex items-center justify-center text-slate-700">
                  SYSTEM READY. WAITING FOR EXECUTION.
                </div>
              ) : (
                <div className="space-y-2 pb-4">
                  {trace.map((t) => <TraceLine key={t.id} entry={t} />)}
                  {AGENT_ORDER.filter((id) => agents[id].status === "running").map((id) => (
                    <div key={`stream-${id}`} className="mt-4 border-l-[3px] border-slate-800 pl-4 ml-1 py-1">
                        <div className="flex items-center gap-2 mb-2 opacity-80">
                          <span className={`font-bold ${AGENT_META[id].color}`}>[{AGENT_META[id].label.toUpperCase()}]</span>
                          <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                        <div className="text-slate-400 whitespace-pre-wrap break-words leading-relaxed max-w-5xl">
                          {agents[id].output || "Establishing context..."}
                        </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </main>
      </div>

      {/* FULLSCREEN REPORT MODAL */}
      {viewingOutput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200">
          <div className="bg-slate-950 w-full max-w-5xl h-full max-h-[85vh] rounded-xl border border-slate-800 shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="h-16 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-6 shrink-0">
              <div className="flex items-center gap-3">
                {viewingOutput === "gaps" ? (
                   <>
                     <div className="p-2 rounded bg-slate-950 border border-red-500/50">
                       <AlertCircle className="size-5 text-red-400" />
                     </div>
                     <div>
                       <h3 className="font-mono text-lg font-bold text-red-400">
                         Critical Gaps Report
                       </h3>
                     </div>
                   </>
                ) : (
                   <>
                     <div className={`p-2 rounded bg-slate-950 border ${AGENT_META[viewingOutput as AgentId].border}`}>
                       <FileText className={`size-5 ${AGENT_META[viewingOutput as AgentId].color}`} />
                     </div>
                     <div>
                       <h3 className={`font-mono text-lg font-bold ${AGENT_META[viewingOutput as AgentId].color}`}>
                         {AGENT_META[viewingOutput as AgentId].label} Report
                       </h3>
                     </div>
                   </>
                )}
              </div>
              <button 
                onClick={() => setViewingOutput(null)}
                className="p-2 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X className="size-6" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
              {viewingOutput === "gaps" ? (
                 <div className="max-w-4xl mx-auto space-y-6">
                   {gaps.map((g, i) => (
                     <div key={i} className="flex gap-4 p-6 rounded-lg border border-slate-800 bg-slate-900/50 leading-relaxed text-sm">
                       <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                       <div className="text-slate-300">
                         <ReactMarkdown
                           components={{
                             p: ({ node, ...props }) => <span {...props} />,
                             strong: ({ node, ...props }) => <strong className="font-bold text-white text-base block mb-2" {...props} />
                           }}
                         >
                           {g}
                         </ReactMarkdown>
                       </div>
                     </div>
                   ))}
                 </div>
              ) : agents[viewingOutput as AgentId].output ? (
                <div className="prose-agent max-w-none text-sm leading-relaxed text-slate-300">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h2: ({ node, ...props }) => <h2 className={`mt-8 mb-4 text-base font-bold uppercase tracking-wider border-b border-slate-800 pb-2 ${AGENT_META[viewingOutput as AgentId].color}`} {...props} />,
                      h3: ({ node, ...props }) => <h3 className="mt-8 mb-4 text-sm font-bold text-white uppercase tracking-wide" {...props} />,
                      p: ({ node, ...props }) => <p className="mb-4 text-slate-300" {...props} />,
                      ul: ({ node, ...props }) => <ul className="mb-4 ml-6 list-disc space-y-2 marker:text-slate-600" {...props} />,
                      ol: ({ node, ...props }) => <ol className="mb-4 ml-6 list-decimal space-y-2 marker:text-slate-600" {...props} />,
                      strong: ({ node, ...props }) => <strong className="font-bold text-white" {...props} />,
                      code: ({ node, ...props }) => <code className="font-mono text-xs bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 text-slate-300" {...props} />,
                    }}
                  >
                    {/* Apply the formatter ONLY if viewing the Supervisor report */}
                    {viewingOutput === "supervisor"
                      ? formatSupervisorOutput(agents[viewingOutput].output)
                      : agents[viewingOutput].output}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500 font-mono text-sm">
                  {agents[viewingOutput as AgentId].status === "running" ? (
                    <><div className="size-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /> Generating analysis...</>
                  ) : (
                    "No output generated yet."
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------ Sub-components ------------ */

function GraphNode({
  id,
  state,
  primary = false,
  onView
}: {
  id: AgentId;
  state: AgentState;
  primary?: boolean;
  onView: () => void;
}) {
  const meta = AGENT_META[id];
  const active = state.status === "running";
  const done = state.status === "done";
  const err = state.status === "error";

  return (
    <div className={`w-full flex flex-col items-center relative group`}>
      <div
        className={[
          "relative flex flex-col items-center justify-center rounded-xl border-2 font-mono tracking-wider transition-all duration-300 w-full",
          primary ? "h-16" : "h-14",
          active
            ? `${meta.border} bg-slate-900 shadow-[0_0_20px_rgba(16,185,129,0.1)] scale-105`
            : done
              ? "border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-500 shadow-lg"
              : err
                ? "border-red-900 bg-red-950/20 text-red-400"
                : "border-slate-800 bg-slate-950/50 text-slate-600",
        ].join(" ")}
      >
        <span className={`text-xs font-bold uppercase ${active || done ? meta.color : "text-slate-600"}`}>
          {meta.label}
        </span>
        <span className={`text-[10px] mt-1 uppercase font-semibold ${active ? 'opacity-100 text-slate-300' : 'opacity-50'}`}>
          {state.status}
        </span>
        
        {/* Active Ping */}
        {active && (
          <span className="absolute -right-1.5 -top-1.5 flex size-3.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current ${meta.color}`}></span>
            <span className={`relative inline-flex rounded-full size-3.5 bg-current ${meta.color}`}></span>
          </span>
        )}

        {/* View Output Button - Appears when done */}
        {done && (
          <button 
            onClick={onView}
            className="absolute -bottom-3 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 border border-slate-600 text-slate-200 text-[10px] px-3 py-1 rounded-md flex items-center gap-1.5 hover:bg-slate-700 hover:text-white shadow-xl z-20"
          >
            <Maximize2 className="size-3" /> View
          </button>
        )}
      </div>
    </div>
  );
}

function TraceLine({ entry }: { entry: TraceEntry }) {
  const meta = AGENT_META[entry.agent];
  let color = "text-slate-400";
  
  if (entry.kind === "error") color = "text-red-400";
  else if (entry.kind === "tool") color = "text-slate-500 font-semibold";
  else if (entry.agent === "supervisor") color = "text-emerald-400";
  else if (entry.agent === "researcher") color = "text-blue-400";
  else if (entry.agent === "matcher") color = "text-purple-400";
  else if (entry.agent === "prep") color = "text-amber-400";

  return (
    <div className="flex items-start gap-3 hover:bg-white/5 px-3 py-1.5 rounded transition-colors">
      <span className="shrink-0 font-mono text-[10px] text-slate-600 mt-[2px]">
        {String(entry.id).padStart(4, "0")}
      </span>
      <span className={`shrink-0 font-mono text-[11px] font-bold mt-[1px] w-12 ${color}`}>
        {meta.short}
      </span>
      <span className="text-slate-400 break-words text-[11px] leading-relaxed">{entry.text}</span>
    </div>
  );
}

/* ------------ Helpers ------------ */

function extractSection(md: string, header: string): string[] {
  if (!md) return [];
  const re = new RegExp(
    `\\*\\*${escapeRegex(header)}\\*\\*([\\s\\S]*?)(?=\\n\\*\\*|$)`,
    "i"
  );
  const m = md.match(re);
  if (!m) return [];
  return extractBulletsFromChunk(m[1]);
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
        .trim()
    )
    .filter(Boolean);
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}