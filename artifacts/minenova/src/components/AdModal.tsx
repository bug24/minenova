import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export interface AdData {
  id: number;
  title: string;
  type: "video" | "image" | "script" | "external_link";
  urlOrCode: string | null;
  providerScript?: string | null;
  durationSeconds: number;
  placement: string;
  isActive: boolean;
}

interface AdModalProps {
  ad: AdData;
  totalAds: number;
  currentAd: number;
  gradient: string;
  onComplete: () => void;
}

export default function AdModal({ ad, totalAds, currentAd, gradient, onComplete }: AdModalProps) {
  const [elapsed, setElapsed] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const total = Math.max(1, ad.durationSeconds);
  const srcDoc = useMemo(() => {
    if (ad.type !== "script") return "";
    const provider = ad.providerScript ?? "";
    const body = ad.urlOrCode ?? "";
    return `<!doctype html><html><head><meta charset="utf-8">${provider}</head><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;">${body}</body></html>`;
  }, [ad]);

  useEffect(() => {
    setElapsed(0);
    setCanSkip(false);
    const interval = setInterval(() => {
      setElapsed(e => {
        const next = e + 0.1;
        if (next >= total) {
          clearInterval(interval);
          setCanSkip(true);
          return total;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [ad.id, currentAd, total]);

  useEffect(() => {
    if (ad.type === "script" && iframeRef.current) iframeRef.current.srcdoc = srcDoc;
  }, [ad, srcDoc]);

  const progress = Math.min(100, (elapsed / total) * 100);
  const remaining = Math.max(0, Math.ceil(total - elapsed));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card border border-card-border rounded-2xl overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Ad {currentAd} of {totalAds}
            </p>
            <p className="text-sm font-bold text-foreground truncate max-w-[220px]">{ad.title}</p>
          </div>
          <div className="text-sm font-mono font-bold text-muted-foreground min-w-[28px] text-right">
            {remaining}s
          </div>
        </div>

        {/* Ad content */}
        <div className="relative bg-black w-full" style={{ minHeight: 220 }}>
          {ad.type === "image" && (
            <img
              src={ad.urlOrCode ?? ""}
              alt={ad.title}
              className="w-full object-contain"
              style={{ maxHeight: 320 }}
            />
          )}
          {ad.type === "video" && (
            <video
              src={ad.urlOrCode ?? ""}
              autoPlay
              muted
              playsInline
              className="w-full"
              style={{ maxHeight: 320 }}
            />
          )}
          {ad.type === "external_link" && (
            <iframe
              src={ad.urlOrCode ?? ""}
              title={ad.title}
              sandbox="allow-scripts allow-same-origin allow-popups"
              className="w-full"
              style={{ height: 320, border: "none" }}
            />
          )}
          {ad.type === "script" && (
            <iframe
              ref={iframeRef}
              title={ad.title}
              sandbox="allow-scripts allow-popups"
              className="w-full"
              style={{ minHeight: 220, border: "none", background: "#000" }}
            />
          )}
        </div>

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-100"
              style={{ width: `${progress}%`, background: gradient }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
            <span>{canSkip ? "Ad complete!" : "Watching ad..."}</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Action */}
        <div className="px-4 pb-4 pt-2">
          <button
            onClick={() => canSkip && onComplete()}
            disabled={!canSkip}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={canSkip ? { background: gradient } : { background: "rgba(255,255,255,0.1)" }}
          >
            {canSkip
              ? currentAd < totalAds
                ? "Continue to next ad →"
                : "Close & Activate Boost"
              : `Wait ${remaining}s to continue`}
          </button>
        </div>
      </div>
    </div>
  );
}
