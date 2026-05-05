import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";
import { X, Play, CheckCircle2, Clock } from "lucide-react";

const WATCH_DURATION = 30;

const VIDEO_PURIFY_CONFIG = {
  FORCE_BODY: true as const,
  ADD_TAGS: ["iframe", "video", "source"] as string[],
  ADD_ATTR: [
    "src", "width", "height", "frameborder", "scrolling",
    "allowtransparency", "allow", "allowfullscreen", "loading",
    "name", "title", "style", "autoplay", "muted", "playsinline",
    "controls", "type",
  ] as string[],
};

/**
 * Normalises admin-supplied value into safe embeddable HTML.
 * Accepts: full <iframe>/<video> HTML, Vimeo URL, YouTube URL, or raw .mp4 URL.
 */
function normalizeEmbed(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already HTML — use as-is (will be sanitized by DOMPurify)
  if (trimmed.startsWith("<")) return trimmed;
  // Vimeo watch URL → player iframe
  const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&muted=1" width="560" height="315" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Video"></iframe>`;
  }
  // YouTube watch / short URL → embed iframe
  const ytMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (ytMatch) {
    return `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1" width="560" height="315" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video"></iframe>`;
  }
  // Direct video file URL (.mp4 / .webm / .ogg)
  if (/^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(trimmed)) {
    return `<video src="${trimmed}" autoplay muted playsinline controls style="width:100%;max-height:315px;"></video>`;
  }
  // Generic URL fallback — wrap in iframe
  if (/^https?:\/\//.test(trimmed)) {
    return `<iframe src="${trimmed}" width="560" height="315" frameborder="0" allow="autoplay; fullscreen" allowfullscreen title="Video"></iframe>`;
  }
  return "";
}

interface WatchVideoModalProps {
  onComplete: () => void;
  onClose: () => void;
  completing: boolean;
}

export default function WatchVideoModal({ onComplete, onClose, completing }: WatchVideoModalProps) {
  const [rawEmbed, setRawEmbed] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/watch-video-embed")
      .then(r => r.json())
      .then((data: { embed?: string }) => {
        if (!cancelled) setRawEmbed(data.embed ?? "");
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const normalizedEmbed = rawEmbed !== null ? normalizeEmbed(rawEmbed) : null;
  const hasVideo = !!normalizedEmbed;

  // Only count down when a valid video is loaded
  useEffect(() => {
    if (!hasVideo) return;
    if (elapsed >= WATCH_DURATION) return;
    const interval = setInterval(() => {
      setElapsed(e => {
        const next = e + 0.1;
        if (next >= WATCH_DURATION) { clearInterval(interval); return WATCH_DURATION; }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [hasVideo, elapsed]);

  useEffect(() => {
    if (!containerRef.current || !normalizedEmbed) return;
    const sanitized = DOMPurify.sanitize(normalizedEmbed, VIDEO_PURIFY_CONFIG);
    containerRef.current.innerHTML = sanitized;
  }, [normalizedEmbed]);

  const canClaim = hasVideo && elapsed >= WATCH_DURATION;
  const remaining = Math.max(0, Math.ceil(WATCH_DURATION - elapsed));
  const progress = hasVideo ? Math.min(100, (elapsed / WATCH_DURATION) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-card border border-card-border rounded-2xl overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-rose-500" />
            <p className="text-sm font-bold text-foreground">Watch Video</p>
          </div>
          <div className="flex items-center gap-3">
            {hasVideo && !canClaim && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-mono font-bold">{remaining}s</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Close (no reward)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video area */}
        <div className="bg-black w-full flex items-center justify-center" style={{ minHeight: 220 }}>
          {fetchError ? (
            <p className="text-sm text-destructive p-6 text-center">
              Could not load video. Please try again later.
            </p>
          ) : rawEmbed === null ? (
            <div className="flex flex-col items-center gap-2 p-6">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted-foreground">Loading video…</p>
            </div>
          ) : !hasVideo ? (
            <p className="text-sm text-muted-foreground p-6 text-center">
              No video configured yet. Check back soon!
            </p>
          ) : (
            <div
              ref={containerRef}
              className="w-full flex items-center justify-center [&_iframe]:w-full [&_iframe]:max-h-[315px] [&_video]:w-full [&_video]:max-h-[315px]"
            />
          )}
        </div>

        {/* Progress bar — only shown when video is available */}
        {hasVideo && (
          <div className="px-4 pt-3 pb-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100 bg-rose-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
              <span>{canClaim ? "You can now claim your reward!" : `You can close in ${remaining}s`}</span>
              <span>{Math.round(progress)}%</span>
            </div>
          </div>
        )}

        {/* Action */}
        <div className="px-4 pb-4 pt-2 space-y-2">
          <button
            onClick={() => canClaim && !completing && onComplete()}
            disabled={!canClaim || completing}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={canClaim ? { background: "linear-gradient(135deg, #e11d48, #be123c)" } : { background: "rgba(255,255,255,0.08)" }}
          >
            {completing
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Claiming…</>
              : canClaim
              ? <><CheckCircle2 className="w-4 h-4" /> Complete & Claim</>
              : hasVideo
              ? `Watch for ${remaining}s more…`
              : "No video available"}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Closing early via ✕ will not grant the reward.
          </p>
        </div>
      </div>
    </div>
  );
}
