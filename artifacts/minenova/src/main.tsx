import DOMPurify from "dompurify";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

async function injectBodyScripts() {
  try {
    const res = await fetch("/api/body-scripts");
    if (!res.ok) return;
    const data = await res.json();
    const scripts: string = data?.scripts ?? "";
    if (!scripts.trim()) return;

    const container = document.createElement("div");
    container.innerHTML = DOMPurify.sanitize(scripts, { FORCE_BODY: true, ADD_TAGS: ["script"] }) as unknown as string;

    const scriptEls = Array.from(container.querySelectorAll("script"));
    for (const oldScript of scriptEls) {
      const newScript = document.createElement("script");
      Array.from(oldScript.attributes).forEach(attr => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      document.body.appendChild(newScript);
      oldScript.remove();
    }

    if (container.childNodes.length > 0) {
      document.body.appendChild(container);
    }
  } catch {
  }
}

injectBodyScripts();

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
