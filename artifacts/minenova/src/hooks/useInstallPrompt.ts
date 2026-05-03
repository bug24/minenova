import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | { type: "android"; trigger: () => void }
  | { type: "ios" }
  | { type: "none" };

const DISMISS_KEY = "mn_install_dismissed_until";
const VISIT_KEY = "mn_install_visits";
const VISITS_BEFORE_SHOW = 2;
const DELAY_MS = 20_000;

function isAlreadyInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true;
}

function isDismissedRecently(): boolean {
  const until = localStorage.getItem(DISMISS_KEY);
  if (!until) return false;
  return Date.now() < parseInt(until, 10);
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /safari/i.test(ua) && !/crios|fxios|opios/i.test(ua);
}

export function dismissInstallPrompt(days = 7) {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400_000));
}

export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>({ type: "none" });

  useEffect(() => {
    if (isAlreadyInstalled() || isDismissedRecently()) return;

    const visits = parseInt(localStorage.getItem(VISIT_KEY) ?? "0", 10) + 1;
    localStorage.setItem(VISIT_KEY, String(visits));

    if (visits < VISITS_BEFORE_SHOW) return;

    let timer: ReturnType<typeof setTimeout>;
    let deferred: BeforeInstallPromptEvent | null = null;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      timer = setTimeout(() => {
        if (deferred) {
          setState({
            type: "android",
            trigger: async () => {
              if (!deferred) return;
              await deferred.prompt();
              const { outcome } = await deferred.userChoice;
              if (outcome === "accepted") {
                dismissInstallPrompt(365);
              } else {
                dismissInstallPrompt(7);
              }
              deferred = null;
              setState({ type: "none" });
            },
          });
        }
      }, DELAY_MS);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    if (isIosSafari()) {
      timer = setTimeout(() => {
        setState({ type: "ios" });
      }, DELAY_MS);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  return state;
}
