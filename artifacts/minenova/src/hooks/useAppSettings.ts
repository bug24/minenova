import { useEffect, useState } from "react";

interface AppSettings {
  withdrawalTickerEnabled: boolean;
  voiceChatEnabled: boolean;
}

const DEFAULT: AppSettings = { withdrawalTickerEnabled: true, voiceChatEnabled: true };

export function useAppSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT);

  useEffect(() => {
    fetch("/api/app-settings")
      .then(r => r.ok ? r.json() : null)
      .then((data: AppSettings | null) => {
        if (data) setSettings(data);
      })
      .catch(() => {});
  }, []);

  return settings;
}
