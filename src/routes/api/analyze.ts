import { createFileRoute } from "@tanstack/react-router";

// Supported providers:
// - "lovable" (default): proxies to Lovable gateway
// - "openrouter": use OpenRouter API (OpenAI-compatible interface)
// - "gemini": best-effort OpenAI-compatible proxy using a Gemini key (may require provider support)
const MODEL = "google/gemini-2.5-flash";

function getProviderConfig() {
  const provider = (process.env.AI_PROVIDER || "lovable").toLowerCase();
  if (provider === "openrouter") {
    return {
      url: "https://api.openrouter.ai/v1/chat/completions",
      key: process.env.OPENROUTER_API_KEY,
      name: "openrouter",
    };
  }

  if (provider === "gemini") {
    // Some Gemini deployments expose an OpenAI-compatible endpoint or accept a Bearer key.
    // This is a best-effort fallback that uses the OpenAI-compatible chat/completions API path.
    // If you have a specific Gemini endpoint (or Google Cloud service account flow), set
    // AI_GATEWAY_URL to that URL and AI_API_KEY to the appropriate bearer token.
    return {
      url: process.env.AI_GATEWAY_URL || "https://api.openai.com/v1/chat/completions",
      key: process.env.GEMINI_API_KEY,
      name: "gemini",
    };
  }

  // default: lovable gateway
  return {
    url: process.env.AI_GATEWAY_URL || "https://ai.gateway.lovable.dev/v1/chat/completions",
    key: process.env.LOVABLE_API_KEY,
    name: "lovable",
  };
}

type AgentId = "supervisor" | "researcher" | "matcher" | "prep";

interface AgentSpec {
  id: AgentId;
  label: string;
  system: string;
  buildUser: (ctx: { jd: string; prior: Record<string, string> }) => string;
}

const AGENTS: AgentSpec[] = [
  {
    id: "supervisor",
    label: "Supervisor",
    system:
      "You are the SUPERVISOR node of a multi-agent job-application system. " +
      "Your job is to briefly analyze a Job Description and dispatch work to three specialists: " +
      "RESEARCHER (company/market intel), MATCHER (resume-vs-JD gap analysis), PREP (interview prep). " +
      "Respond in 3-5 short bullet points in the format:\n" +
      "• Role: <extracted title>\n• Company/Stack: <key tech>\n• Dispatch → RESEARCHER: <one-line brief>\n• Dispatch → MATCHER: <one-line brief>\n• Dispatch → PREP: <one-line brief>\n" +
      "No preamble. Be terse. Use plain text.",
    buildUser: ({ jd }) => `JOB DESCRIPTION:\n"""\n${jd}\n"""`,
  },
  {
    id: "researcher",
    label: "Researcher",
    system:
      "You are the RESEARCHER agent. Given a JD, produce concise intelligence a candidate needs BEFORE interviewing. " +
      "Return markdown with sections: **Company Snapshot**, **Tech & Stack Signals**, **Market/Competitive Context**, **Culture Cues**. " +
      "3-6 bullets per section. Ground claims in what the JD implies; if unknown, say so. Be crisp, no fluff.",
    buildUser: ({ jd, prior }) =>
      `SUPERVISOR BRIEF:\n${prior.supervisor}\n\nJOB DESCRIPTION:\n"""\n${jd}\n"""`,
  },
  {
    id: "matcher",
    label: "Matcher",
    system:
      "You are the MATCHER agent. Perform a gap analysis between a generic Senior Engineer candidate profile " +
      "(6 years experience, Python/TypeScript, cloud, some LLM work, no formal ML PhD) and the JD requirements. " +
      "Return markdown with: **Match Score: XX%** on the first line, then **Strong Matches** (bullets), **Partial Matches** (bullets), **Gaps** (bullets), **Recommendation** (1 short paragraph). " +
      "Score realistically 55–92. No preamble.",
    buildUser: ({ jd, prior }) =>
      `RESEARCH CONTEXT:\n${prior.researcher}\n\nJOB DESCRIPTION:\n"""\n${jd}\n"""`,
  },
  {
    id: "prep",
    label: "Prep Agent",
    system:
      "You are the PREP agent. Using the JD, research context, and gap analysis, produce a tailored interview prep sheet. " +
      "Return markdown with: **Likely Technical Questions** (5, each 1 line), **Behavioral Prompts** (3), **Questions to Ask Them** (3), **48-Hour Study Plan** (3 bullets). " +
      "Be specific to the role, not generic.",
    buildUser: ({ jd, prior }) =>
      `RESEARCH:\n${prior.researcher}\n\nMATCH ANALYSIS:\n${prior.matcher}\n\nJOB DESCRIPTION:\n"""\n${jd}\n"""`,
  },
];

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cfg = getProviderConfig();
        const apiKey = cfg.key;
        if (!apiKey) {
          return new Response(`Missing API key for provider ${cfg.name} on server`, {
            status: 500,
          });
        }

        let jd = "";
        try {
          const body = (await request.json()) as { jd?: string };
          jd = (body.jd ?? "").trim();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        if (jd.length < 20) {
          return new Response("Job description too short", { status: 400 });
        }
        if (jd.length > 8000) jd = jd.slice(0, 8000);

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(sseEvent(obj)));

            const prior: Record<string, string> = {};
            try {
              send({ type: "start", ts: Date.now() });

              for (const agent of AGENTS) {
                send({ type: "agent_start", agent: agent.id, label: agent.label });
                // If using Gemini (Google) API keys (AQ.*), many endpoints are NOT
                // OpenAI-compatible. Provide a best-effort non-streaming fallback
                // that posts a single prompt to a configurable Gemini-compatible URL.
                if (cfg.name === "gemini") {
                  const prompt = `${agent.system}\n\n${agent.buildUser({ jd, prior })}`;
                  // Model short name (no leading "models/") must be used in the path.
                  const modelShort = MODEL.replace("google/", "");
                  const geminiUrl = process.env.GEMINI_API_URL ||
                    `https://generativelanguage.googleapis.com/v1/models/${modelShort}:generateContent?key=${apiKey}`;

                  let parsedText = "";
                  try {
                    // Use the generateContent body shape the API accepts
                    // Use the same simple request shape that worked in curl:
                    // { "contents":[{"parts":[{"text":"..."}]}] }
                    const body = {
                      contents: [
                        {
                          parts: [{ text: prompt }],
                        },
                      ],
                    };

                    const gemRes = await fetch(geminiUrl, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(body),
                    });

                    if (!gemRes.ok) {
                      const t = await gemRes.text().catch(() => "");
                      send({ type: "error", agent: agent.id, message: `Gateway error ${gemRes.status}: ${t.slice(0,200)}` });
                      break;
                    }

                    const data = await gemRes.json().catch(() => ({}));
                    // Parse common generateContent response shapes
                    // Prefer the parts/text shape returned by generateContent
                    parsedText = (
                      // e.g. data.candidates[0].content.parts[0].text
                      (data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") as string) ||
                      // alternate shapes
                      data.candidates?.[0]?.content ||
                      data.candidates?.[0]?.output?.[0]?.content ||
                      data.output?.text ||
                      data.choices?.[0]?.message?.content ||
                      data.choices?.[0]?.text ||
                      ""
                    ) as string;
                  } catch (err) {
                    send({ type: "error", agent: agent.id, message: err instanceof Error ? err.message : String(err) });
                    break;
                  }

                  prior[agent.id] = parsedText;
                  send({ type: "token", agent: agent.id, delta: parsedText });
                  send({ type: "agent_done", agent: agent.id, content: parsedText });
                  continue;
                }

                const res = await fetch(cfg.url, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    model: MODEL,
                    stream: true,
                    messages: [
                      { role: "system", content: agent.system },
                      { role: "user", content: agent.buildUser({ jd, prior }) },
                    ],
                  }),
                });

                if (res.status === 429) {
                  send({
                    type: "error",
                    agent: agent.id,
                    message: "Rate limited by AI gateway. Try again shortly.",
                  });
                  break;
                }
                if (res.status === 402) {
                  send({
                    type: "error",
                    agent: agent.id,
                    message:
                      "AI credits exhausted on this workspace. Add credits to continue.",
                  });
                  break;
                }
                if (!res.ok || !res.body) {
                  const text = await res.text().catch(() => "");
                  send({
                    type: "error",
                    agent: agent.id,
                    message: `Gateway error ${res.status}: ${text.slice(0, 200)}`,
                  });
                  break;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let full = "";

                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() ?? "";
                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    const data = trimmed.slice(5).trim();
                    if (data === "[DONE]") continue;
                    try {
                      const parsed = JSON.parse(data);
                      const delta: string | undefined =
                        parsed.choices?.[0]?.delta?.content;
                      if (delta) {
                        full += delta;
                        send({ type: "token", agent: agent.id, delta });
                      }
                    } catch {
                      // ignore parse errors on partial chunks
                    }
                  }
                }

                prior[agent.id] = full;
                send({
                  type: "agent_done",
                  agent: agent.id,
                  content: full,
                });
              }

              send({ type: "done", ts: Date.now() });
            } catch (err) {
              send({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
