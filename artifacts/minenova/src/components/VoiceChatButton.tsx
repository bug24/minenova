import { Mic, MicOff, PhoneOff, Loader2, Volume2 } from "lucide-react";
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

  const label =
    status === "idle"       ? "Start voice chat" :
    status === "requesting" ? "Allow microphone…" :
    status === "connecting" ? "Connecting…" :
    status === "connected"  ? (isMuted ? "Muted — tap to unmute" : "Live — tap to mute") :
    status === "denied"     ? "Microphone denied" :
    status === "error"      ? "Connection failed — retry" :
    "Voice chat";

  if (inline) {
    const isIdle = status === "idle" || status === "denied" || status === "error";
    const isConnected = status === "connected";

    const containerStyle =
      isConnected && !isMuted
        ? "bg-emerald-500/15 border-emerald-500/40"
        : isConnected && isMuted
        ? "bg-red-500/15 border-red-500/40"
        : isBusy
        ? "bg-primary/10 border-primary/30"
        : status === "denied" || status === "error"
        ? "bg-destructive/10 border-destructive/30"
        : "border-card-border bg-gradient-to-r from-violet-600/10 via-purple-500/10 to-pink-500/10 border-purple-500/30";

    const iconStyle =
      isConnected && !isMuted ? "bg-emerald-500 text-white shadow-emerald-500/30 shadow-md" :
      isConnected && isMuted  ? "bg-red-500 text-white shadow-red-500/30 shadow-md" :
      isBusy                  ? "bg-primary/20 text-primary" :
      status === "denied" || status === "error"
                              ? "bg-destructive/20 text-destructive" :
      "bg-gradient-to-br from-violet-600 to-pink-500 text-white shadow-md shadow-purple-500/30";

    const labelStyle =
      isConnected && !isMuted ? "text-emerald-500 font-semibold" :
      isConnected && isMuted  ? "text-red-400 font-semibold" :
      isBusy                  ? "text-primary" :
      status === "denied" || status === "error"
                              ? "text-destructive" :
      "text-purple-300 font-semibold";

    return (
      <div className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${containerStyle}`}>
        {/* Mic/action button */}
        <button
          onClick={handleMain}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 shrink-0 ${iconStyle}`}
          title={label}
        >
          {isBusy
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : isIdle
            ? <Mic className="w-4 h-4" />
            : isMuted
            ? <MicOff className="w-4 h-4" />
            : <Mic className="w-4 h-4" />}
        </button>

        {/* Label + speaker indicator */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-none ${labelStyle}`}>{label}</p>
          {isConnected && isRemoteSpeaking && (
            <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
              <Volume2 className="w-3 h-3" /> Opponent speaking…
            </p>
          )}
        </div>

        {/* Live speaking pulse */}
        {isConnected && isRemoteSpeaking && (
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
        )}

        {/* End call */}
        {isLive && (
          <button
            onClick={onStop}
            className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center active:scale-90 transition-all border border-red-500/30 shrink-0"
            title="End call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Floating fallback (legacy)
  const btnColor =
    status === "connected" && !isMuted ? "bg-emerald-500 text-white shadow-emerald-500/40" :
    status === "connected" && isMuted   ? "bg-red-500 text-white shadow-red-500/40" :
    isBusy                              ? "bg-primary/20 text-primary shadow-primary/20" :
    status === "denied" || status === "error"
                                        ? "bg-destructive/20 text-destructive shadow-none" :
    "bg-gradient-to-br from-violet-600 to-pink-500 text-white shadow-lg shadow-purple-500/30";

  return (
    <div className="fixed bottom-20 right-3 z-40 flex flex-col items-center gap-1.5">
      {status === "connected" && isRemoteSpeaking && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-ping pointer-events-none" />
      )}
      <button
        onClick={handleMain}
        className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 relative ${btnColor}`}
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
