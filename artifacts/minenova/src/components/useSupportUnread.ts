import { useState, useEffect } from "react";

export function useSupportUnread() {
  const [count, setCount] = useState(0);
  const token = typeof window !== "undefined" ? localStorage.getItem("minenova_token") : null;

  useEffect(() => {
    if (!token) return;
    const fetch_ = () =>
      fetch("/api/support/unread-count", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : { count: 0 })
        .then(({ count }: { count: number }) => setCount(count))
        .catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 10000);
    return () => clearInterval(id);
  }, [token]);

  return count;
}
