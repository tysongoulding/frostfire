import { useState } from "react";
import { CheckCircle2, Circle, ListTodo, FileCode } from "lucide-react";

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  files: string[];
  status: "pending" | "in_progress" | "completed";
}

const SAMPLE_PLAN_STEPS: PlanStep[] = [
  {
    id: "step-1",
    title: "Scaffold Desktop UI Framework",
    description: "Initialize Tauri 2.0 workspace and React 19 component architecture.",
    files: ["lota/package.json", "lota/src-tauri/Cargo.toml"],
    status: "completed",
  },
  {
    id: "step-2",
    title: "Implement Streaming Hook Pipeline",
    description: "Connect Rig agent token streams with requestAnimationFrame batching.",
    files: ["lota/src/hooks/useRhoEngine.ts", "lota/src/hooks/useStreamingFeed.ts"],
    status: "completed",
  },
  {
    id: "step-3",
    title: "Rig Extractor & Multi-Persona Support",
    description: "Expose Rig persona profiles, dynamic toolboxes, and model selectors.",
    files: ["lota/src/components/agent/AgentInspector.tsx"],
    status: "in_progress",
  },
];

export function StructuredPlanView() {
  const [steps, setSteps] = useState<PlanStep[]>(SAMPLE_PLAN_STEPS);

  const toggleStep = (id: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.id === id
          ? {
              ...step,
              status: step.status === "completed" ? "pending" : "completed",
            }
          : step
      )
    );
  };

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-4xl mx-auto text-xs text-[#c9d1d9]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white mb-1 flex items-center space-x-2">
            <ListTodo className="w-4 h-4 text-[#58a6ff]" />
            <span>Structured Plan & Task Tracker</span>
          </h2>
          <p className="text-[#8b949e]">
            Structured execution plan derived via Rig Agent extractors.
          </p>
        </div>

        <div className="text-right">
          <span className="font-semibold text-white text-sm">{progressPercent}%</span>
          <div className="text-[10px] text-[#8b949e]">
            {completedCount}/{steps.length} completed
          </div>
        </div>
      </div>

      <div className="w-full bg-[#161b22] h-2 rounded-full overflow-hidden border border-[#30363d]">
        <div
          className="bg-blue-600 h-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="space-y-2.5">
        {steps.map((step) => {
          const isDone = step.status === "completed";
          return (
            <div
              key={step.id}
              onClick={() => toggleStep(step.id)}
              className={`p-3.5 rounded-xl border transition cursor-pointer flex items-start space-x-3 select-none ${
                isDone
                  ? "bg-[#161b22]/50 border-[#30363d] opacity-80"
                  : "bg-[#161b22] border-[#30363d] hover:border-[#58a6ff]"
              }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <Circle className="w-4 h-4 text-[#8b949e]" />
                )}
              </div>

              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4
                    className={`font-semibold text-xs ${
                      isDone ? "text-[#8b949e] line-through" : "text-white"
                    }`}
                  >
                    {step.title}
                  </h4>
                  <span
                    className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-medium ${
                      isDone
                        ? "bg-green-950/30 text-green-400 border border-green-800/40"
                        : "bg-blue-950/30 text-blue-400 border border-blue-800/40"
                    }`}
                  >
                    {step.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-[11px] text-[#8b949e] mt-0.5">{step.description}</p>

                {step.files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {step.files.map((f) => (
                      <span
                        key={f}
                        className="flex items-center space-x-1 bg-[#0d1117] border border-[#30363d] px-1.5 py-0.5 rounded text-[10px] font-mono text-[#58a6ff]"
                      >
                        <FileCode className="w-3 h-3" />
                        <span>{f}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
