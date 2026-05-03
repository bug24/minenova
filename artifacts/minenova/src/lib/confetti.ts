// Lightweight canvas-based confetti burst — no external library required.

const COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#a855f7",
  "#ef4444", "#ec4899", "#06b6d4", "#84cc16",
  "#fbbf24", "#34d399", "#60a5fa", "#c084fc",
];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  size: number;
  rot: number; rotSpeed: number;
  shape: "rect" | "circle" | "strip";
  alpha: number;
}

export function burstConfetti(originX?: number, originY?: number) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d")!;
  const cx = originX ?? canvas.width / 2;
  const cy = originY ?? canvas.height * 0.38;

  const shapes: Particle["shape"][] = ["rect", "circle", "strip"];

  const particles: Particle[] = Array.from({ length: 140 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 14 + 4;
    return {
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed * (Math.random() * 0.6 + 0.7),
      vy: Math.sin(angle) * speed - Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: Math.random() * 9 + 5,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.25,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      alpha: 1,
    };
  });

  const DURATION = 3200;
  const start = performance.now();

  function animate(now: number) {
    const elapsed = now - start;
    if (elapsed > DURATION) {
      canvas.remove();
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const progress = elapsed / DURATION;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.38;
      p.vx *= 0.985;
      p.rot += p.rotSpeed;
      p.alpha = Math.max(0, 1 - Math.pow(progress, 1.6));

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;

      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.65);
      } else if (p.shape === "circle") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
      }

      ctx.restore();
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}
