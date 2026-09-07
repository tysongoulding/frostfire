import { useState, useEffect, useRef } from "react";
import { MarkviewRenderer } from "../markdown/MarkviewRenderer";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Presentation,
  Play,
  RotateCcw,
  Clock,
} from "lucide-react";

interface SlidesViewerProps {
  content: string;
  title?: string;
}

export function SlidesViewer({ content, title = "Presentation Deck" }: SlidesViewerProps) {
  // Parse slides separated by '---' (standard Marp/Markdown slide separator)
  const rawSlides = content
    .split(/\n---\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const slides = rawSlides.length > 0 ? rawSlides : [content];
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showControls, setShowControls] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const totalSlides = slides.length;

  const nextSlide = () => {
    setCurrentSlide((prev) => Math.min(totalSlides - 1, prev + 1));
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => Math.max(0, prev - 1));
  };

  // Timer when in presentation mode
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isFullscreen) {
      interval = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isFullscreen]);

  // Keyboard navigation & Esc handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setCurrentSlide((prev) => Math.min(totalSlides - 1, prev + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentSlide((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentSlide(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentSlide(totalSlides - 1);
      } else if (e.key === "f" || e.key === "F5") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setIsFullscreen((prev) => !prev);
        }
      } else if (e.key === "Escape" && isFullscreen) {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalSlides, isFullscreen]);

  // Mouse move in fullscreen to auto-reveal controls
  const handleMouseMove = () => {
    if (!isFullscreen) return;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const activeContent = slides[currentSlide] || "";

  // If in Presentation Mode (100% screen overlay)
  if (isFullscreen) {
    return (
      <div
        onMouseMove={handleMouseMove}
        className="fixed inset-0 z-[100] bg-[#0a0d12] text-[#c9d1d9] flex flex-col justify-between p-8 sm:p-14 select-none overflow-hidden animate-in fade-in duration-200"
      >
        {/* Top Presenter Bar (Auto-hides) */}
        <div
          className={`flex items-center justify-between transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex items-center space-x-3">
            <Presentation className="w-5 h-5 text-pink-400" />
            <span className="text-sm font-semibold text-white font-mono">{title}</span>
            <span className="text-xs text-pink-300 bg-pink-500/10 px-2.5 py-0.5 rounded-full border border-pink-500/30 font-mono">
              Slide {currentSlide + 1} of {totalSlides}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Timer */}
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-[#161b22] border border-[#30363d] rounded-lg font-mono text-xs text-[#8b949e]">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>{formatTime(elapsedSeconds)}</span>
            </div>

            {/* Exit Fullscreen Button */}
            <button
              onClick={() => setIsFullscreen(false)}
              className="px-3 py-1 bg-[#21262d] hover:bg-red-950/50 hover:text-red-300 text-white rounded-lg border border-[#30363d] text-xs font-semibold flex items-center space-x-1.5 transition"
              title="Exit Fullscreen (Esc)"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Exit (Esc)</span>
            </button>
          </div>
        </div>

        {/* Presentation Slide Canvas (Hero Center) */}
        <div className="flex-1 flex items-center justify-center max-w-6xl w-full mx-auto my-4 overflow-y-auto">
          <div className="w-full bg-[#161b22] border border-[#30363d] rounded-3xl p-10 md:p-16 shadow-2xl space-y-6 animate-in zoom-in-95 duration-150">
            <MarkviewRenderer content={activeContent} showLineNumbers={false} />
          </div>
        </div>

        {/* Floating Bottom Navigation Bar (Auto-hides) */}
        <div
          className={`flex items-center justify-between max-w-4xl w-full mx-auto transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Previous / Next buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={prevSlide}
              disabled={currentSlide === 0}
              className={`p-2 rounded-xl border transition ${
                currentSlide === 0
                  ? "bg-[#161b22] border-[#30363d] text-[#8b949e] opacity-40 cursor-not-allowed"
                  : "bg-[#21262d] border-[#30363d] text-white hover:bg-[#30363d]"
              }`}
              title="Previous Slide (←)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <button
              onClick={nextSlide}
              disabled={currentSlide === totalSlides - 1}
              className={`px-4 py-2 rounded-xl font-semibold text-xs border transition flex items-center space-x-2 ${
                currentSlide === totalSlides - 1
                  ? "bg-[#161b22] border-[#30363d] text-[#8b949e] opacity-40 cursor-not-allowed"
                  : "bg-[#1f6feb] border-blue-500 text-white hover:bg-blue-600 shadow-lg"
              }`}
              title="Next Slide (→)"
            >
              <span>Next Slide</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Slide Indicator Dots */}
          <div className="flex items-center space-x-1.5">
            {slides.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentSlide(idx)}
                className={`h-2.5 rounded-full transition-all ${
                  currentSlide === idx ? "w-8 bg-pink-500" : "w-2.5 bg-[#30363d] hover:bg-[#8b949e]"
                }`}
                title={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>

          {/* Restart */}
          <button
            onClick={() => setCurrentSlide(0)}
            className="p-2 rounded-xl bg-[#161b22] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition"
            title="Restart Presentation"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Normal Embedded View in Studio
  return (
    <div className="flex flex-col h-full w-full bg-[#0d1117] rounded-xl border border-[#30363d] overflow-hidden select-none">
      {/* Slide Deck Top Control Bar */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-[#161b22] border-b border-[#30363d] text-xs flex-shrink-0">
        <div className="flex items-center space-x-2">
          <Presentation className="w-4 h-4 text-pink-400" />
          <span className="font-semibold text-white font-mono text-[11px] truncate max-w-xs">{title}</span>
          <span className="text-[10px] text-pink-300 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20 font-mono">
            Slide {currentSlide + 1} of {totalSlides}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Previous Button */}
          <button
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className={`p-1.5 rounded-lg border transition flex items-center space-x-1 ${
              currentSlide === 0
                ? "bg-[#0d1117] border-[#30363d] text-[#8b949e] opacity-50 cursor-not-allowed"
                : "bg-[#21262d] border-[#30363d] text-white hover:bg-[#30363d]"
            }`}
            title="Previous Slide (←)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Next Button */}
          <button
            onClick={nextSlide}
            disabled={currentSlide === totalSlides - 1}
            className={`p-1.5 rounded-lg border transition flex items-center space-x-1 ${
              currentSlide === totalSlides - 1
                ? "bg-[#0d1117] border-[#30363d] text-[#8b949e] opacity-50 cursor-not-allowed"
                : "bg-[#1f6feb] border-blue-500 text-white hover:bg-blue-600"
            }`}
            title="Next Slide (→)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Reset to Slide 1 */}
          <button
            onClick={() => setCurrentSlide(0)}
            className="p-1.5 rounded-lg bg-[#0d1117] hover:bg-[#21262d] text-[#8b949e] hover:text-white border border-[#30363d] transition"
            title="Restart Presentation (Home)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Presentation Mode Button */}
          <button
            onClick={() => setIsFullscreen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs shadow transition ml-1"
            title="Start Fullscreen Presentation Mode (F5)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Present</span>
          </button>
        </div>
      </div>

      {/* Main Slide Presentation Stage */}
      <div className="flex-1 overflow-auto p-6 md:p-10 flex items-center justify-center bg-[#0d1117]">
        {/* 16:9 Aspect Slide Canvas Frame */}
        <div className="w-full max-w-4xl aspect-[16/9] min-h-[420px] bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl p-8 md:p-12 flex flex-col justify-between overflow-y-auto animate-in fade-in duration-200">
          <div className="flex-1 flex flex-col justify-center">
            <MarkviewRenderer content={activeContent} showLineNumbers={false} />
          </div>

          {/* Slide Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-[#30363d]/50 text-[10px] text-[#8b949e]">
            <span className="font-mono flex items-center space-x-1">
              <Play className="w-2.5 h-2.5 text-pink-400" />
              <span>Rho Lota Presentation Deck</span>
            </span>
            <span className="font-mono font-semibold text-white">
              {currentSlide + 1} / {totalSlides}
            </span>
          </div>
        </div>
      </div>

      {/* Slide Thumbnails Drawer */}
      <div className="px-5 py-3 bg-[#161b22]/70 border-t border-[#30363d] flex items-center space-x-2 overflow-x-auto flex-shrink-0 select-none">
        <span className="text-[10px] font-semibold text-[#8b949e] uppercase mr-2 flex-shrink-0">
          Slides:
        </span>
        {slides.map((_, idx) => (
          <button
            key={idx}
            onClick={() => setCurrentSlide(idx)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex-shrink-0 ${
              currentSlide === idx
                ? "bg-pink-600 text-white font-bold shadow"
                : "bg-[#0d1117] border border-[#30363d] text-[#8b949e] hover:text-white hover:bg-[#21262d]"
            }`}
          >
            Slide {idx + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
