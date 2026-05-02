import { useState, useRef, useCallback, useEffect } from "react";

export type VoiceChatStatus =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "denied"
  | "unsupported"
  | "error";

interface UseVoiceChatOptions {
  isInitiator: boolean;
  sendSignal: (type: string, payload: unknown) => Promise<void>;
  enabled: boolean;
}

export interface UseVoiceChatReturn {
  status: VoiceChatStatus;
  isMuted: boolean;
  isRemoteSpeaking: boolean;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  handleRemoteSignal: (signalType: string, payload: unknown) => void;
}

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useVoiceChat({ isInitiator, sendSignal, enabled }: UseVoiceChatOptions): UseVoiceChatReturn {
  const [status, setStatus] = useState<VoiceChatStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const startedRef = useRef(false);
  const intentionalStopRef = useRef(false);

  const cleanup = useCallback(() => {
    intentionalStopRef.current = true;
    startedRef.current = false;
    remoteDescSetRef.current = false;
    pendingIceRef.current = [];

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      try { document.body.removeChild(remoteAudioRef.current); } catch { /* already gone */ }
      remoteAudioRef.current = null;
    }

    setIsRemoteSpeaking(false);
    setIsMuted(false);
    setStatus("idle");
    intentionalStopRef.current = false;
  }, []);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  useEffect(() => {
    if (!enabled && startedRef.current) cleanup();
  }, [enabled, cleanup]);

  const trackRemoteLevel = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        setIsRemoteSpeaking(buf.reduce((s, v) => s + v, 0) / buf.length > 12);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* AudioContext unavailable */ }
  }, []);

  const drainIce = useCallback(async (pc: RTCPeerConnection) => {
    for (const c of pendingIceRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* non-fatal */ }
    }
    pendingIceRef.current = [];
  }, []);

  const buildPC = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection(STUN_CONFIG);

    pc.onicecandidate = async ({ candidate }) => {
      if (candidate) {
        try { await sendSignal("ice-candidate", candidate.toJSON()); } catch { /* non-fatal */ }
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (!remoteAudioRef.current) {
        const audio = new Audio();
        audio.autoplay = true;
        document.body.appendChild(audio);
        remoteAudioRef.current = audio;
      }
      remoteAudioRef.current.srcObject = stream;
      trackRemoteLevel(stream);
      setStatus("connected");
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "disconnected" || state === "closed") {
        const wasIntentional = intentionalStopRef.current;
        cleanup();
        if (!wasIntentional) setStatus("error");
      }
    };

    return pc;
  }, [sendSignal, trackRemoteLevel, cleanup]);

  const acquireMic = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) { setStatus("unsupported"); return null; }
    setStatus("requesting");
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      setStatus((err as Error).name === "NotAllowedError" ? "denied" : "error");
      return null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;

    const stream = await acquireMic();
    if (!stream) { startedRef.current = false; return; }
    localStreamRef.current = stream;

    const pc = buildPC();
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    setStatus("connecting");

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal("offer", offer);
      } catch { setStatus("error"); }
    }
    // Non-initiator: connected state arrived from auto-answer in handleRemoteSignal
  }, [enabled, isInitiator, acquireMic, buildPC, sendSignal]);

  const handleRemoteSignal = useCallback(async (signalType: string, payload: unknown) => {
    if (!enabled) return;

    if (signalType === "offer") {
      const offer = payload as RTCSessionDescriptionInit;

      if (!startedRef.current) {
        // Auto-answer: acquire mic and respond without requiring a manual button tap
        startedRef.current = true;
        const stream = await acquireMic();
        if (!stream) { startedRef.current = false; return; }
        localStreamRef.current = stream;

        const pc = buildPC();
        pcRef.current = pc;
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        setStatus("connecting");

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          remoteDescSetRef.current = true;
          await drainIce(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendSignal("answer", answer);
        } catch { setStatus("error"); }
        return;
      }

      // Already started (non-initiator tapped first, then offer arrived)
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescSetRef.current = true;
        await drainIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal("answer", answer);
      } catch { setStatus("error"); }

    } else if (signalType === "answer") {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit));
        remoteDescSetRef.current = true;
        await drainIce(pc);
      } catch { /* non-fatal */ }

    } else if (signalType === "ice-candidate") {
      const pc = pcRef.current;
      if (!pc || !remoteDescSetRef.current) {
        pendingIceRef.current.push(payload as RTCIceCandidateInit);
        return;
      }
      try { await pc.addIceCandidate(new RTCIceCandidate(payload as RTCIceCandidateInit)); } catch { /* non-fatal */ }
    }
  }, [enabled, acquireMic, buildPC, sendSignal, drainIce]);

  const stop = useCallback(() => { cleanup(); }, [cleanup]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMuted(v => !v);
  }, []);

  return { status, isMuted, isRemoteSpeaking, start, stop, toggleMute, handleRemoteSignal };
}
