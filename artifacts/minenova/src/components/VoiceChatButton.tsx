import { Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import type { VoiceChatStatus } from "@/hooks/useVoiceChat";

interface VoiceChatButtonProps {
  status: VoiceChatStatus;
  isMuted: boolean;
  isRemoteSpeaking: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  inline?: boolean;
}

export default function VoiceChatButton({
  status,
  isMuted,
  isRemoteSpeaking,
  onStart,
  onStop,
  onToggleMute,
  inline = false,
}: VoiceChatButtonProps) {
  if (status === "unsupported") return null;

  const isLive = status === "connected" || status === "connecting" || status === "requesting";
  const isBusy = status === "requesting" || status === "connecting";

  const handleMain = () => {
    if (isLive) { onToggleMute(); }
    else { onStart(); }
  };

  const btnColor =
    status === "connected" && !isMuted ? "bg-emerald-500 text-white shadow-emerald-500/40" :
    status === "connected" && isMuted   ? "bg-red-500 text-white shadow-red-500/40" :
    isBusy                              ? "bg-primary/20 text-primary shadow-primary/20" :
    status === "denied" || status === "error"
                                        ? "bg-destructive/20 text-destructive shadow-none" :
    "bg-card border border-card-border text-muted-foreground shadow-none";

  const label =
    status === "idle"       ? "Voice chat" :
    status === "requesting" ? "Allow mic…" :
    status === "connecting" ? "Connecting…" :
    status === "connected"  ? (isMuted ? "Muted — tap to unmute" : "Live — tap to mute") :
    status === "denied"     ? "Mic denied" :
    status === "error"      ? "Tap to retry" :
    "Voice chat";

  if (inline) {
    return (
      <div className="flex items-center gap-2.5 bg-card border border-card-border rounded-xl px-3 py-2">
        {/* Mic button */}
        <button
          onClick={handleMain}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90 shrink-0 shadow-sm ${btnColor}`}
          title={label}
        >
          {isBusy
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : isMuted
            ? <MicOff className="w-4 h-4" />
            : <Mic className="w-4 h-4" />}
        </button>

        {/* Label */}
        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{label}</span>

        {/* Remote speaking indicator */}
        {status === "connected" && isRemoteSpeaking && (
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
        )}

        {/* End call */}
        {isLive && (
          <button
            onClick={onStop}
            className="w-7 h-7 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center active:scale-90 transition-all border border-red-500/20 shrink-0"
            title="End call"
          >
            <PhoneOff className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 right-3 z-40 flex flex-col items-center gap-1.5">
      {status === "connected" && isRemoteSpeaking && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-ping pointer-events-none" />
      )}
      <button
        onClick={handleMain}
        className={`w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 relative ${btnColor}`}
        title={label}
      >
        {isBusy
          ? <Loader2 className="w-5 h-5 animate-spin" />
          : isMuted
          ? <MicOff className="w-5 h-5" />
          : <Mic className="w-5 h-5" />}
      </button>
      {isLive && (
        <button
          onClick={onStop}
          className="w-8 h-8 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center active:scale-90 transition-all border border-red-500/20"
          title="End call"
        >
          <PhoneOff className="w-3.5 h-3.5" />
        </button>
      )}
      <span className="text-[9px] text-muted-foreground leading-none">{label.split(" — ")[0]}</span>
    </div>
  );
}
