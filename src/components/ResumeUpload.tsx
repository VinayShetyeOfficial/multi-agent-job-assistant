import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
  X,
  File,
  Loader2,
  Sparkles,
  FileCheck,
  Zap,
  Code,
  Brain,
} from "lucide-react";

// Configure PDF.js worker with correct version matching installed package (6.1.200)
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.1.200/build/pdf.worker.min.mjs";
}

interface ResumeUploadProps {
  onResumeChange: (resume: string) => void;
  resume: string;
  disabled?: boolean;
}

const DEMO_RESUME = `VINAY KUMAR
Senior Full-Stack Developer & AI Engineer
Email: vinay.kumar@example.com | LinkedIn: linkedin.com/in/vinaykumar | GitHub: github.com/vinaykumar

PROFESSIONAL SUMMARY
Experienced Senior Full-Stack Developer with 6+ years specializing in modern web technologies, AI/ML integration, and multi-agent system development. Proven expertise in building production-ready applications with React, TypeScript, Python, and cloud technologies. Currently developing advanced LangGraph-based multi-agent systems for intelligent job assistance platforms.

TECHNICAL SKILLS
• Frontend: React, TypeScript, Next.js, TanStack Router, Tailwind CSS, Framer Motion
• Backend: Node.js, Python, FastAPI, Express.js, REST APIs, GraphQL
• AI/ML: LangGraph, LangChain, OpenAI API, Multi-Agent Systems, Prompt Engineering
• Cloud: AWS, Cloudflare, Docker, Kubernetes, CI/CD Pipelines
• Databases: PostgreSQL, MongoDB, Redis, Vector Databases
• Tools: Git, Vite, Webpack, ESLint, Prettier, Jest, Playwright

EXPERIENCE

Senior Full-Stack Developer | Wynisco Technologies (2022 - Present)
• Architected and developed multi-agent AI systems using LangGraph for automated job application analysis
• Built production-ready React applications with advanced streaming interfaces and real-time updates
• Implemented sophisticated UI/UX with terminal-inspired designs, animations, and responsive layouts
• Integrated multiple AI providers (OpenAI, Gemini, OpenRouter) with intelligent fallback mechanisms
• Developed server-side rendering solutions using TanStack Start and Nitro for optimal performance

Full-Stack Developer | Tech Innovations Inc (2019 - 2022)
• Led development of enterprise SaaS applications serving 10,000+ users
• Built scalable REST APIs using Node.js and Python with 99.9% uptime
• Implemented advanced front-end architectures with React, TypeScript, and modern state management
• Optimized application performance resulting in 40% faster load times
• Mentored junior developers and established coding standards and best practices

Junior Developer | StartupXYZ (2018 - 2019)
• Developed responsive web applications using React and modern JavaScript
• Collaborated with design teams to implement pixel-perfect UI components
• Integrated third-party APIs and payment processing systems
• Participated in agile development cycles and code reviews

PROJECTS

Multi-Agent Job Assistant Platform (2024)
• Built sophisticated supervisor-coordinated multi-agent system using LangGraph patterns
• Implemented real-time streaming architecture with Server-Sent Events
• Created terminal-inspired UI with advanced animations and state visualization
• Integrated resume parsing, job description analysis, and intelligent matching algorithms
• Technologies: React, TypeScript, TanStack Start, Tailwind CSS, LangGraph, AI APIs

E-Commerce Platform (2023)
• Developed full-stack e-commerce solution handling $1M+ in transactions
• Built scalable microservices architecture with Docker and Kubernetes
• Implemented advanced search, filtering, and recommendation systems
• Technologies: Next.js, Node.js, PostgreSQL, Redis, AWS

Real-Time Collaboration Tool (2022)
• Created real-time collaborative workspace with live editing capabilities
• Implemented WebSocket-based communication and conflict resolution
• Built responsive interface supporting 100+ concurrent users
• Technologies: React, Socket.io, Express.js, MongoDB

EDUCATION
Bachelor of Technology in Computer Science
Indian Institute of Technology (IIT) | 2014-2018
• Relevant Coursework: Data Structures, Algorithms, Machine Learning, Database Systems

CERTIFICATIONS
• AWS Certified Developer Associate (2023)
• Google Cloud Professional Developer (2022)
• Advanced React Patterns Certification (2023)

ACHIEVEMENTS
• Built and deployed 15+ production applications with 99.9% uptime
• Contributed to open-source projects with 500+ GitHub stars
• Speaker at React and AI conferences (2023-2024)
• Led team of 5 developers in successful project deliveries`;

const SAMPLE_RESUMES = {
  "AI Engineer": `ALEX CHEN
AI Engineer & Machine Learning Specialist
Email: alex.chen@email.com | LinkedIn: /in/alexchen

EXPERIENCE
• 5+ years in AI/ML development with Python, TensorFlow, PyTorch
• Built production ML pipelines processing 1M+ data points daily
• Expertise in LLMs, multi-agent systems, and prompt engineering
• PhD in Computer Science with focus on Natural Language Processing`,

  "Frontend Developer": `SARAH JOHNSON
Senior Frontend Developer
Email: sarah.j@email.com | GitHub: /sarahj

EXPERIENCE
• 7+ years React, TypeScript, and modern frontend frameworks
• Expert in responsive design, accessibility, and performance optimization
• Built component libraries used by 50+ developers
• Strong UX/UI design background with Figma proficiency`,

  "Backend Developer": `MIKE RODRIGUEZ
Backend Engineer & Cloud Architect
Email: mike.r@email.com | LinkedIn: /in/mikerodriguez

EXPERIENCE
• 8+ years building scalable backend systems
• Expertise in Node.js, Python, Go, and microservices architecture
• AWS/GCP certified with extensive DevOps experience
• Led teams building systems handling millions of requests`,
};

export const ResumeUpload: React.FC<ResumeUploadProps> = ({
  onResumeChange,
  resume,
  disabled = false,
}) => {
  const [uploadStatus, setUploadStatus] = useState<"idle" | "processing" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [inputMethod, setInputMethod] = useState<"upload" | "text">("upload");

  const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
      console.log("Starting PDF extraction for:", file.name, "Size:", file.size);
      const arrayBuffer = await file.arrayBuffer();
      console.log("ArrayBuffer loaded, size:", arrayBuffer.byteLength);

      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: false,
        standardFontDataUrl: "https://unpkg.com/pdfjs-dist@6.1.200/standard_fonts/",
        // Disable some checks that can cause issues
        stopAtErrors: false,
        isEvalSupported: false,
        useWorkerFetch: false,
      });

      console.log("PDF loading task created");
      const pdf = await loadingTask.promise;
      console.log("PDF loaded successfully. Pages:", pdf.numPages);

      let fullText = "";

      for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .filter((item): item is any => "str" in item && item.str?.trim())
            .map((item: any) => item.str.trim())
            .join(" ")
            .replace(/\s+/g, " ");
          if (pageText) {
            fullText += pageText + "\n\n";
          }
          console.log(`Page ${i} extracted: ${pageText.length} chars`);
        } catch (pageError) {
          console.warn(`Error on page ${i}:`, pageError);
        }
      }

      if (!fullText.trim()) {
        throw new Error("No text extracted from PDF. The PDF might be image-based or protected.");
      }

      console.log("Total text extracted:", fullText.length, "chars");
      return fullText.trim();
    } catch (error) {
      console.error("PDF Error Details:", error);
      if (error instanceof Error) {
        // Provide more helpful error messages
        if (error.message.includes("Invalid PDF")) {
          throw new Error("Invalid PDF file. Please try a different PDF or convert to DOCX/TXT.");
        } else if (error.message.includes("password")) {
          throw new Error("PDF is password protected. Please unlock it first or use DOCX/TXT.");
        } else if (error.message.includes("Worker")) {
          throw new Error("PDF processing error. Please try converting to DOCX or TXT format.");
        } else {
          throw new Error(`PDF Error: ${error.message}. Try DOCX or TXT format.`);
        }
      }
      throw new Error("Failed to read PDF. Try converting to DOCX or TXT format.");
    }
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const extractTextFromTxt = async (file: File): Promise<string> => {
    return await file.text();
  };

  const processFile = async (file: File) => {
    setUploadStatus("processing");
    setErrorMessage("");
    setFileName(file.name);

    try {
      let extractedText = "";
      const fileType = file.type.toLowerCase();
      const fileName = file.name.toLowerCase();

      if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
        extractedText = await extractTextFromPdf(file);
      } else if (
        fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        fileName.endsWith(".docx")
      ) {
        extractedText = await extractTextFromDocx(file);
      } else if (fileType === "text/plain" || fileName.endsWith(".txt")) {
        extractedText = await extractTextFromTxt(file);
      } else {
        throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT files.");
      }

      if (!extractedText.trim()) {
        throw new Error("No text could be extracted from the file.");
      }

      onResumeChange(extractedText.trim());
      setUploadStatus("success");
    } catch (error) {
      setUploadStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to process file");
    }
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      if (disabled) return;

      if (rejectedFiles.length > 0) {
        setUploadStatus("error");
        setErrorMessage("File too large or invalid format. Max 10MB, PDF/DOCX/TXT only.");
        return;
      }

      if (acceptedFiles.length > 0) {
        processFile(acceptedFiles[0]);
      }
    },
    [disabled],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024, // 10MB
    disabled,
  });

  const clearResume = () => {
    onResumeChange("");
    setUploadStatus("idle");
    setFileName("");
    setErrorMessage("");
  };

  const loadSampleResume = (key: string) => {
    if (key === "demo") {
      onResumeChange(DEMO_RESUME);
    } else {
      onResumeChange(SAMPLE_RESUMES[key as keyof typeof SAMPLE_RESUMES]);
    }
    setUploadStatus("success");
    setFileName(`${key} Sample Resume.txt`);
  };

  return (
    <div className="space-y-4">
      {/* Method Selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setInputMethod("upload")}
          className={`flex-1 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
            inputMethod === "upload"
              ? "border-accent bg-accent/10 text-accent"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload className="mr-2 inline size-3" />
          Upload File
        </button>
        <button
          type="button"
          onClick={() => setInputMethod("text")}
          className={`flex-1 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
            inputMethod === "text"
              ? "border-accent bg-accent/10 text-accent"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="mr-2 inline size-3" />
          Paste Text
        </button>
      </div>

      <AnimatePresence mode="wait">
        {inputMethod === "upload" ? (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Upload Zone */}
            <div
              {...getRootProps()}
              className={`relative overflow-hidden rounded-lg border-2 border-dashed p-8 text-center transition-all duration-300 resume-dropzone ${
                isDragActive
                  ? "animate-upload-pulse border-accent bg-accent/5 shadow-lg shadow-accent/20"
                  : uploadStatus === "success"
                    ? "border-accent/40 bg-accent/5"
                    : uploadStatus === "error"
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-border bg-background hover:border-accent/40 hover:bg-accent/5"
              } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <input {...getInputProps()} />

              {/* Scanning animation overlay */}
              {uploadStatus === "processing" && (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent animate-processing-scan" />
                </div>
              )}

              <div className="relative z-10 space-y-4">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-border bg-background">
                  {uploadStatus === "processing" ? (
                    <Loader2 className="size-6 animate-spin text-accent" />
                  ) : uploadStatus === "success" ? (
                    <CheckCircle className="size-6 text-accent" />
                  ) : uploadStatus === "error" ? (
                    <AlertTriangle className="size-6 text-destructive" />
                  ) : (
                    <Upload className="size-6 text-muted-foreground" />
                  )}
                </div>

                <div>
                  {uploadStatus === "processing" ? (
                    <div className="space-y-2">
                      <p className="font-mono text-sm font-bold text-accent">PROCESSING FILE...</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        extracting → parsing → analyzing
                      </p>
                    </div>
                  ) : uploadStatus === "success" ? (
                    <div className="space-y-2">
                      <p className="font-mono text-sm font-bold text-accent">RESUME LOADED ✓</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {fileName} • {resume.length.toLocaleString()} chars
                      </p>
                    </div>
                  ) : uploadStatus === "error" ? (
                    <div className="space-y-2">
                      <p className="font-mono text-sm font-bold text-destructive">
                        PROCESSING FAILED
                      </p>
                      <p className="text-xs text-destructive">{errorMessage}</p>
                    </div>
                  ) : isDragActive ? (
                    <div className="space-y-2">
                      <p className="font-mono text-sm font-bold text-accent">
                        DROP FILE TO ANALYZE
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        PDF, DOCX, TXT supported
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-semibold text-foreground">Drop your resume here</p>
                      <p className="text-sm text-muted-foreground">or click to browse files</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        PDF, DOCX, TXT • Max 10MB
                      </p>
                    </div>
                  )}
                </div>

                {(uploadStatus === "success" || uploadStatus === "error") && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearResume();
                    }}
                    className="inline-flex items-center gap-2 rounded border border-muted px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                    Clear
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            <textarea
              value={resume}
              onChange={(e) => onResumeChange(e.target.value)}
              placeholder="Paste your resume text here..."
              disabled={disabled}
              className="h-40 w-full resize-none rounded border border-border bg-background p-4 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:border-accent focus:outline-none focus:ring-0"
              spellCheck={false}
            />
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-muted-foreground">
                {resume.length.toLocaleString()} characters
              </p>
              {resume && (
                <button
                  type="button"
                  onClick={clearResume}
                  className="inline-flex items-center gap-1 rounded border border-muted px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                  Clear
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sample Resume Buttons */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Sample Resumes
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => loadSampleResume("demo")}
            className="group rounded border border-accent/30 bg-accent/5 px-3 py-2 text-center transition-all hover:border-accent/50 hover:bg-accent/10"
          >
            <div className="font-mono text-xs font-bold text-accent">DEMO</div>
            <div className="text-xs text-muted-foreground">Full-Stack + AI</div>
          </button>
          {Object.keys(SAMPLE_RESUMES).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => loadSampleResume(key)}
              className="group rounded border border-border bg-background px-3 py-2 text-center transition-all hover:border-accent/40 hover:bg-accent/5"
            >
              <div className="font-mono text-xs font-bold text-foreground">{key.split(" ")[0]}</div>
              <div className="text-xs text-muted-foreground">{key}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
