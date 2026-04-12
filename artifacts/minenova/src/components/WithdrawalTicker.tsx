import { useState, useEffect } from "react";
import { useGetActivityFeed } from "@workspace/api-client-react";
import { TrendingUp } from "lucide-react";

const FAKE_ACTIVITY = [
  { id: 1, username: "crypto_hawk91", amount: 8.50, action: "withdrew" },
  { id: 2, username: "mine_king77", amount: 5.20, action: "withdrew" },
  { id: 3, username: "nova_miner", amount: 12.00, action: "withdrew" },
  { id: 4, username: "block_rider22", amount: 6.75, action: "withdrew" },
  { id: 5, username: "hash_queen", amount: 15.50, action: "withdrew" },
  { id: 6, username: "digital_pete", amount: 7.30, action: "withdrew" },
  { id: 7, username: "satoshi_fan88", amount: 9.00, action: "withdrew" },
  { id: 8, username: "coin_blaze", amount: 5.00, action: "withdrew" },
  { id: 9, username: "nova_whale", amount: 25.00, action: "withdrew" },
  { id: 10, username: "miner_x99", amount: 11.25, action: "withdrew" },
];

interface ActivityItem {
  id: number;
  username: string;
  amount: number;
  action: string;
}

export default function WithdrawalTicker() {
  const { data: activityFeed } = useGetActivityFeed();
  const [current, setCurrent] = useState<ActivityItem | null>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState<"in" | "out" | null>(null);

  const items: ActivityItem[] = (activityFeed && activityFeed.length > 0)
    ? activityFeed
    : FAKE_ACTIVITY;

  useEffect(() => {
    let idx = 0;
    const show = () => {
      const item = items[idx % items.length];
      idx++;
      setCurrent(item);
      setVisible(true);
      setAnimating("in");
      const hideTimer = setTimeout(() => {
        setAnimating("out");
        setTimeout(() => setVisible(false), 400);
      }, 4000);
      return hideTimer;
    };

    let hideTimer = show();
    const interval = setInterval(() => {
      clearTimeout(hideTimer);
      hideTimer = show();
    }, 5500);

    return () => {
      clearInterval(interval);
      clearTimeout(hideTimer);
    };
  }, [items.length]);

  if (!visible || !current) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 ${animating === "in" ? "ticker-in" : animating === "out" ? "ticker-out" : ""}`}
      data-testid="withdrawal-ticker"
    >
      <div className="bg-card border border-border rounded-full px-4 py-2 shadow-lg flex items-center gap-2 text-sm whitespace-nowrap">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
        <TrendingUp className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        <span className="font-medium text-foreground">{current.username}</span>
        <span className="text-muted-foreground">just {current.action}</span>
        <span className="font-bold text-emerald-500">${current.amount.toFixed(2)} USDT</span>
      </div>
    </div>
  );
}
