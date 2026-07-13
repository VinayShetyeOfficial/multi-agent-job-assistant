import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-accent">Error 404</div>
        <h1 className="mt-4 text-4xl font-bold text-foreground">NODE_NOT_FOUND</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This route is not registered in the graph topology.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-accent px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider text-accent-foreground transition-colors hover:bg-accent/90"
        >
          Return to console
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-destructive">
          Runtime Fault
        </div>
        <h1 className="mt-4 text-2xl font-bold text-foreground">Kernel panic in agent graph</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The orchestrator crashed. Restart the session or return home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider text-accent-foreground hover:bg-accent/90"
          >
            Retry
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-transparent px-5 py-2 font-mono text-xs font-bold uppercase tracking-wider text-foreground hover:bg-secondary"
          >
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AGENTIC.OS // RECRUIT — AI-Powered Job Assistant" },
      {
        name: "description",
        content:
          "Multi-agent AI system for intelligent job application analysis. Upload your resume and job description to get real-time match scoring, gap analysis, and interview prep powered by LangGraph.",
      },
      { name: "author", content: "Vinay Kumar" },
      { name: "theme-color", content: "#0f172a" },
      { name: "application-name", content: "AGENTIC.OS // RECRUIT" },

      // Open Graph / Facebook
      {
        property: "og:title",
        content: "AGENTIC.OS // RECRUIT — AI-Powered Job Assistant",
      },
      {
        property: "og:description",
        content:
          "Watch a Supervisor coordinate Research, Matcher, and Prep agents in real-time. Get AI-powered resume analysis, skill gap identification, and personalized interview preparation.",
      },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/android-chrome-512x512.png" },

      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AGENTIC.OS // RECRUIT — AI Job Assistant" },
      {
        name: "twitter:description",
        content:
          "Multi-agent AI system for intelligent job application analysis with real-time streaming.",
      },
      { name: "twitter:image", content: "/android-chrome-512x512.png" },

      // PWA
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "AGENTIC.OS" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },

      // Favicon - multiple formats for cross-platform support
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },

      // Apple Touch Icon
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },

      // Android Chrome Icons
      { rel: "icon", href: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
      { rel: "icon", href: "/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },

      // Web App Manifest
      { rel: "manifest", href: "/site.webmanifest" },

      // Font preconnects
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
