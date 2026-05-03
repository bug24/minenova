import { X, Download, Share } from "lucide-react";
import { useInstallPrompt, dismissInstallPrompt } from "@/hooks/useInstallPrompt";

export default function InstallPromptBanner() {
  const install = useInstallPrompt();

  if (install.type === "none") return null;

  const handleDismiss = () => {
    dismissInstallPrompt(7);
    window.location.reload();
  };

  return (
    <div className="fixed bottom-20 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className="w-full max-w-sm pointer-events-auto rounded-2xl border border-primary/30 bg-card shadow-2xl shadow-black/40 overflow-hidden"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* Top accent bar */}
        <div className="h-0.5 w-full" style={{ background: "linear-gradient(90deg, #FF3C00, #ff7a00)" }} />

        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="shrink-0 w-11 h-11 rounded-xl overflow-hidden">
              <img src="/icons/icon-192.png" alt="MineNova" className="w-full h-full object-cover" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">Add MineNova to your Home Screen</p>
              {install.type === "android" ? (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get quicker access and mine without opening your browser.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tap <Share className="inline w-3 h-3 mx-0.5 text-sky-400" /> then <strong className="text-foreground">Add to Home Screen</strong>.
                </p>
              )}
            </div>

            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-3">
            {install.type === "android" ? (
              <>
                <button
                  onClick={install.trigger}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
                  style={{ background: "linear-gradient(135deg, #FF3C00, #ff7a00)" }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Install App
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
                >
                  Not now
                </button>
              </>
            ) : (
              <button
                onClick={handleDismiss}
                className="flex-1 py-2 rounded-xl text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
              >
                Got it
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
