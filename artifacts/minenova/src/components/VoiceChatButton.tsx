import { Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import type { VoiceChatStatus } from "@/hooks/useVoiceChat";

interface VoiceChatButtonProps {
  status: VoiceChatStatus;
  isMuted: boolean;
  isRemoteSpeaking: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
}

export default function VoiceChatButton({
  status,
  isMuted,
  isRemoteSpeaking,
  onStart,
  onStop,
  onToggleMute,
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
    status === "idle"       ? "Voice" :
    status === "requesting" ? "Allow mic" :
    status === "connecting" ? "Connecting" :
    status === "connected"  ? (isMuted ? "Muted" : "Live") :
    status === "denied"     ? "Denied" :
    status === "error"      ? "Retry" :
    "Voice";

  return (
    <div className="fixed bottom-20 right-3 z-40 flex flex-col items-center gap-1.5">
      {/* Remote speaking ring */}
      {status === "connected" && isRemoteSpeaking && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-ping pointer-events-none" />
      )}

      {/* Main mic button */}
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

      {/* End call button */}
      {isLive && (
        <button
          onClick={onStop}
          className="w-8 h-8 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center active:scale-90 transition-all border border-red-500/20"
          title="End call"
        >
          <PhoneOff className="w-3.5 h-3.5" />
        </button>
      )}

      <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
    </div>
  );
}
