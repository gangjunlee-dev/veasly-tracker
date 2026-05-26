type ChimeKind = "success" | "warn" | "error";

const TONES: Record<ChimeKind, Array<{ freq: number; duration: number; gain: number }>> = {
  success: [
    { freq: 880, duration: 0.08, gain: 0.12 },
    { freq: 1320, duration: 0.12, gain: 0.12 },
  ],
  warn: [
    { freq: 660, duration: 0.16, gain: 0.1 },
  ],
  error: [
    { freq: 220, duration: 0.18, gain: 0.14 },
    { freq: 180, duration: 0.18, gain: 0.14 },
  ],
};

let cachedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!cachedCtx) cachedCtx = new Ctor();
  return cachedCtx;
}

export function playChime(kind: ChimeKind): void {
  const ctx = getCtx();
  if (!ctx) return;

  // 일부 브라우저는 user gesture 전엔 suspended 상태. resume 후 재생.
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }

  const tones = TONES[kind];
  let offset = 0;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = tone.freq;
    gainNode.gain.setValueAtTime(0, ctx.currentTime + offset);
    gainNode.gain.linearRampToValueAtTime(tone.gain, ctx.currentTime + offset + 0.01);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + offset + tone.duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + tone.duration + 0.02);
    offset += tone.duration;
  }
}
