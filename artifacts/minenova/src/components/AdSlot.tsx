import { useEffect, useRef } from "react";

type AdSlotZone = "top" | "bottom" | "floating";

interface AdSlots {
  top: string;
  bottom: string;
  floating: string;
}

let cachedSlots: AdSlots | null = null;
let fetchPromise: Promise<AdSlots> | null = null;

function getAdSlots(): Promise<AdSlots> {
  if (cachedSlots) return Promise.resolve(cachedSlots);
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/ad-slots")
    .then(r => r.ok ? r.json() : { top: "", bottom: "", floating: "" })
    .then((data: AdSlots) => {
      cachedSlots = data;
      return data;
    })
    .catch(() => ({ top: "", bottom: "", floating: "" }));
  return fetchPromise;
}

function injectSlotHtml(container: HTMLElement, html: string) {
  container.innerHTML = "";
  if (!html.trim()) return;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;

  Array.from(wrapper.childNodes).forEach(node => container.appendChild(node.cloneNode(true)));

  const scripts = Array.from(container.querySelectorAll("script"));
  for (const s of scripts) {
    const live = document.createElement("script");
    Array.from(s.attributes).forEach(attr => live.setAttribute(attr.name, attr.value));
    live.textContent = s.textContent;
    s.replaceWith(live);
  }
}

interface AdSlotProps {
  zone: AdSlotZone;
}

export default function AdSlot({ zone }: AdSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getAdSlots().then(slots => {
      if (cancelled || !containerRef.current) return;
      const html = slots[zone] ?? "";
      injectSlotHtml(containerRef.current, html);
    });
    return () => { cancelled = true; };
  }, [zone]);

  if (zone === "floating") {
    return (
      <div
        ref={containerRef}
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md pointer-events-none [&>*]:pointer-events-auto empty:hidden"
        data-ad-zone="floating"
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full empty:hidden"
      data-ad-zone={zone}
    />
  );
}
