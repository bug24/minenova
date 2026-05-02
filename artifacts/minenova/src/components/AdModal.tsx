import { useEffect, useRef, useState } from "react";
import { ExternalLink, MonitorPlay } from "lucide-react";

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

function injectAdHtml(container: HTMLElement, providerScript: string, body: string) {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `${providerScript}${body}`;

  const allScripts = Array.from(wrapper.querySelectorAll("script"));
  for (const oldScript of allScripts) {
    const newScript = document.createElement("script");
    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
    newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  }

  Array.from(wrapper.childNodes).forEach(node => container.appendChild(node.cloneNode(true)));

  const liveScripts = Array.from(container.querySelectorAll("script"));
  for (const s of liveScripts) {
    const live = document.createElement("script");
    Array.from(s.attributes).forEach(attr => live.setAttribute(attr.name, attr.value));
    live.textContent = s.textContent;
    s.replaceWith(live);
  }
}

export default function AdModal({ ad, totalAds, currentAd, gradient, onComplete }: AdModalProps) {
  const [elapsed, setElapsed] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [tabOpened, setTabOpened] = useState(false);
  const total = Math.max(1, ad.durationSeconds);
  const scriptContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ad.type === "script" && scriptContainerRef.current) {
      injectAdHtml(
        scriptContainerRef.current,
        ad.providerScript ?? "",
        ad.urlOrCode ?? "",
      );
    }
  }, [ad.id, ad.type, ad.providerScript, ad.urlOrCode, currentAd]);

  useEffect(() => {
    if (ad.type !== "external_link") return;
    setPopupBlocked(false);
    setTabOpened(false);
    const win = window.open(ad.urlOrCode ?? "", "_blank", "noopener,noreferrer");
    if (win) {
      setTabOpened(true);
    } else {
      setPopupBlocked(true);
    }
  }, [ad.id, ad.type, ad.urlOrCode, currentAd]);

  useEffect(() => {
    setElapsed(0);
    setCanSkip(false);
    if (ad.type === "external_link" && !tabOpened) return;
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
  }, [ad.id, currentAd, total, ad.type, tabOpened]);

  const handleOpenManually = () => {
    window.open(ad.urlOrCode ?? "", "_blank", "noopener,noreferrer");
    setPopupBlocked(false);
    setTabOpened(true);
  };

  const progress = Math.min(100, (elapsed / total) * 100);
  const remaining = Math.max(0, Math.ceil(total - elapsed));

  const statusLabel = (() => {
    if (canSkip) return "Ad complete!";
    if (ad.type === "external_link" && popupBlocked) return "Open the ad to start the timer…";
    if (ad.type === "external_link") return "Ad playing in new tab…";
    return "Watching ad…";
  })();

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
        <div className="relative bg-black w-full" style={{ minHeight: ad.type === "script" ? 80 : 220 }}>
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
            <div
              className="w-full flex flex-col items-center justify-center gap-4 p-6"
              style={{ height: 220 }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)" }}
              >
                <MonitorPlay className="w-8 h-8 text-purple-400" />
              </div>
              {popupBlocked ? (
                <>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-foreground">Popup blocked by your browser</p>
                    <p className="text-xs text-muted-foreground">
                      Tap the button below to open the ad, then keep this window open.
                    </p>
                  </div>
                  <button
                    onClick={handleOpenManually}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                    style={{ background: gradient }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Ad
                  </button>
                </>
              ) : (
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">Ad opened in a new tab</p>
                  <p className="text-xs text-muted-foreground max-w-[260px]">
                    Keep this window open — your boost will activate once the timer finishes.
                  </p>
                </div>
              )}
            </div>
          )}
          {ad.type === "script" && (
            <div
              ref={scriptContainerRef}
              className="w-full flex items-center justify-center p-2"
              style={{ minHeight: 80 }}
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
            <span>{statusLabel}</span>
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
