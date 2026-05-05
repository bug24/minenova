import { useState, useRef, useCallback } from "react";
import html2canvas from "html2canvas";
import {
  useGetWallet,
  useRequestWithdrawal,
  useGetTransactions,
  useGetUpgrades,
  getGetWalletQueryKey,
  getGetTransactionsQueryKey,
  type Transaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet, ArrowUpRight, Clock, CheckCircle2, XCircle, AlertCircle,
  TrendingUp, Zap, Twitter, Facebook, MessageCircle, Share2, MailWarning,
  Pickaxe, Gift, Gamepad2, CreditCard, RefreshCcw, Hash, CalendarDays, Info,
  Download,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

const COINS_PER_USDT = 1000;
const MINIMUM_COINS = 5000;
const MINIMUM_USDT = 5;

const withdrawSchema = z.object({
  walletAddress: z.string().min(10, "Enter a valid USDT wallet address"),
  amount: z.coerce.number().min(MINIMUM_USDT, `Minimum withdrawal is $${MINIMUM_USDT} USDT`),
});

type WithdrawForm = z.infer<typeof withdrawSchema>;

interface WithdrawalResult {
  usdtAddress: string;
  paymentTag: string;
  amount: number;
  transactionId: number;
  grossAmount: number;
  feeDeducted: number;
}

function getStatusBadge(status: string) {
  if (status === "completed") return <Badge className="bg-emerald-500/20 text-emerald-500 border-0 text-xs">Completed</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-500/20 text-yellow-500 border-0 text-xs">Pending</Badge>;
  if (status === "failed") return <Badge className="bg-destructive/20 text-destructive border-0 text-xs">Failed</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

const TYPE_LABELS: Record<string, string> = {
  withdrawal: "Withdrawal",
  mining: "Mining Reward",
  task: "Task Reward",
  referral: "Referral Bonus",
  bonus: "Bonus",
  upgrade: "Upgrade Purchase",
  upgrade_payment: "Upgrade Payment",
  mines_bet: "Mines Wager",
  mines_win: "Mines Win",
  mines_cashout: "Mines Cashout",
  ludo_entry: "Ludo Entry Fee",
  ludo_win: "Ludo Win",
  ludo_fee: "Ludo Platform Fee",
  ludo_refund: "Ludo Refund",
  whot_entry: "Whot Entry Fee",
  whot_win: "Whot Win",
  whot_fee: "Whot Platform Fee",
  whot_refund: "Whot Refund",
  trivia_entry: "Trivia Entry Fee",
  trivia_win: "Trivia Win",
  trivia_fee: "Trivia Platform Fee",
  trivia_refund: "Trivia Refund",
};

function getTypeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getTypeIcon(type: string, size = "w-4 h-4") {
  if (type === "withdrawal") return <ArrowUpRight className={`${size} text-rose-500`} />;
  if (type === "mining") return <Pickaxe className={`${size} text-emerald-500`} />;
  if (type === "task") return <CheckCircle2 className={`${size} text-primary`} />;
  if (type === "referral" || type === "bonus") return <Gift className={`${size} text-amber-500`} />;
  if (type === "upgrade" || type === "upgrade_payment") return <CreditCard className={`${size} text-orange-500`} />;
  if (type.startsWith("mines_") || type.startsWith("ludo_") || type.startsWith("whot_") || type.startsWith("trivia_")) {
    if (type.endsWith("_win") || type.endsWith("_cashout")) return <CheckCircle2 className={`${size} text-emerald-500`} />;
    if (type.endsWith("_refund")) return <RefreshCcw className={`${size} text-sky-400`} />;
    return <Gamepad2 className={`${size} text-violet-400`} />;
  }
  return <Clock className={`${size} text-muted-foreground`} />;
}

type WithdrawStep = "choose" | "form" | "result";

export default function WalletPage() {
  const { data: wallet, isLoading: walletLoading } = useGetWallet();
  const { data: transactions, isLoading: txLoading } = useGetTransactions();
  const { data: upgrades } = useGetUpgrades();
  const requestWithdrawal = useRequestWithdrawal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<WithdrawStep>("choose");
  const [withdrawalResult, setWithdrawalResult] = useState<WithdrawalResult | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [shareTx, setShareTx] = useState<Transaction | null>(null);
  const [screenshotting, setScreenshotting] = useState(false);
  const [sharedWithdrawalIds, setSharedWithdrawalIds] = useState<Set<number>>(new Set());
  const receiptRef = useRef<HTMLDivElement>(null);
  const shareTxReceiptRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();

  const referralCode = user?.referralCode ?? "";
  const referralUrl = referralCode
    ? `${window.location.origin}/register?ref=${referralCode}`
    : window.location.origin;

  const buildShareMsg = useCallback((amountUsdt: number, platform: "twitter" | "whatsapp" | "facebook") => {
    const base = `I just withdrew $${amountUsdt.toFixed(2)} USDT from MineNova! 💰\n\nThis platform actually pays — mine crypto and cash out as USDT with no delays.\n\nJoin free with my link:\n${referralUrl}`;
    if (platform === "twitter") {
      return `Just withdrew $${amountUsdt.toFixed(2)} USDT from MineNova! 💸 Mine crypto & get paid — no stress, no delays.\n\nTry it free 👇\n${referralUrl}`;
    }
    return base;
  }, [referralUrl]);

  const claimShareBonus = useCallback(async (withdrawalId: number) => {
    if (sharedWithdrawalIds.has(withdrawalId)) return;
    try {
      const token = localStorage.getItem("minenova_token");
      const res = await fetch("/api/wallet/withdrawal-share-bonus", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ withdrawalId }),
      });
      if (res.ok) {
        const data = await res.json() as { bonus: number; message: string };
        setSharedWithdrawalIds(prev => new Set([...prev, withdrawalId]));
        if (data.bonus > 0) {
          toast({ title: `+${data.bonus} coins bonus!`, description: data.message });
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
        }
      }
    } catch { /* non-fatal */ }
  }, [sharedWithdrawalIds, toast, queryClient]);

  /** Captures a receipt card as a JPEG File + data URL. Returns null on failure. */
  const captureReceiptJpeg = useCallback(async (
    ref: React.RefObject<HTMLDivElement | null>,
    amountUsdt: number,
  ): Promise<{ file: File; url: string } | null> => {
    if (!ref.current) return null;
    const canvas = await html2canvas(ref.current, { backgroundColor: "#0f0f0f", scale: 2 });
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const filename = `minenova-receipt-${amountUsdt.toFixed(2)}usdt.jpg`;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob returned null")), "image/jpeg", 0.9);
    });
    const file = new File([blob], filename, { type: "image/jpeg" });
    return { file, url: dataUrl };
  }, []);

  /** Downloads the receipt card as a JPEG file. */
  const downloadReceiptJpeg = useCallback(async (
    ref: React.RefObject<HTMLDivElement | null>,
    amountUsdt: number,
    withdrawalId?: number,
  ) => {
    setScreenshotting(true);
    try {
      const result = await captureReceiptJpeg(ref, amountUsdt);
      if (!result) return;
      const link = document.createElement("a");
      link.href = result.url;
      link.download = `minenova-receipt-${amountUsdt.toFixed(2)}usdt.jpg`;
      link.click();
      toast({ title: "Receipt saved!", description: "JPG saved to your downloads." });
      if (withdrawalId != null) claimShareBonus(withdrawalId);
    } catch {
      toast({ variant: "destructive", title: "Screenshot failed", description: "Please try again." });
    } finally {
      setScreenshotting(false);
    }
  }, [captureReceiptJpeg, claimShareBonus, toast]);

  /**
   * Social share: captures the receipt as JPEG, attempts Web Share API with the
   * image file attached. Falls back to downloading the JPEG + opening intent URL
   * on browsers/desktops that don't support file sharing.
   * User cancellation via the native share sheet returns early with no fallback.
   */
  const handleShare = useCallback(async (
    platform: "twitter" | "whatsapp" | "facebook",
    amount: number,
    withdrawalId: number,
    ref: React.RefObject<HTMLDivElement | null>,
  ) => {
    const msg = buildShareMsg(amount, platform);
    const intentUrls: Record<string, string> = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}`,
      whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(msg)}`,
    };
    setScreenshotting(true);
    try {
      const result = await captureReceiptJpeg(ref, amount);
      if (!result) {
        toast({ variant: "destructive", title: "Screenshot failed", description: "Please try again." });
        window.open(intentUrls[platform], "_blank");
        claimShareBonus(withdrawalId);
        return;
      }
      if (navigator.canShare?.({ files: [result.file] })) {
        try {
          await navigator.share({ files: [result.file], title: "MineNova Withdrawal", text: msg });
          claimShareBonus(withdrawalId);
          return;
        } catch (err) {
          // User explicitly cancelled the native share sheet — do not fall through to fallback
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Other share errors (e.g. API glitch) — fall through to download + intent fallback
        }
      }
      // Fallback: save JPEG then open intent URL so user can attach the image manually
      const link = document.createElement("a");
      link.href = result.url;
      link.download = `minenova-receipt-${amount.toFixed(2)}usdt.jpg`;
      link.click();
      toast({ title: "Receipt saved!", description: "Attach the saved image to your post." });
      window.open(intentUrls[platform], "_blank");
      claimShareBonus(withdrawalId);
    } catch {
      // Capture threw unexpectedly — show error, still open intent URL with text only
      toast({ variant: "destructive", title: "Screenshot failed", description: "Sharing text only." });
      window.open(intentUrls[platform], "_blank");
      claimShareBonus(withdrawalId);
    } finally {
      setScreenshotting(false);
    }
  }, [buildShareMsg, captureReceiptJpeg, claimShareBonus, toast]);
  const coinBalance = wallet?.withdrawableBalance ?? 0;
  const usdtValue = coinBalance / COINS_PER_USDT;
  const canWithdraw = coinBalance >= MINIMUM_COINS;
  const emailVerified = user?.emailVerified ?? true;

  const maxUsdt = Math.floor(usdtValue * 100) / 100;

  const form = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { walletAddress: "", amount: MINIMUM_USDT },
  });

  const openWithdraw = () => {
    setStep("choose");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setTimeout(() => {
      setStep("choose");
      form.reset();
    }, 300);
  };

  const onWithdraw = (data: WithdrawForm) => {
    const gross = data.amount;
    const fee = feeEnabled && feePct > 0
      ? Math.round(gross * feePct / 100 * 100) / 100
      : 0;
    requestWithdrawal.mutate({ data }, {
      onSuccess: (res) => {
        setWithdrawalResult({ usdtAddress: res.usdtAddress, paymentTag: res.paymentTag, amount: res.amount, transactionId: res.transactionId, grossAmount: gross, feeDeducted: fee });
        setStep("result");
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Withdrawal failed";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard` });
  };

  const handleUpgradeInstead = () => {
    closeDialog();
    setLocation("/upgrades");
  };

  const nearbyUpgrades = upgrades?.filter(u => !u.owned && u.coinCost && u.coinCost <= coinBalance * 1.5 && u.coinCost > coinBalance * 0.5);

  const feeEnabled = wallet?.withdrawalFeeEnabled ?? false;
  const feePct = wallet?.withdrawalFeePct ?? 0;

  const watchedAmount = Number(form.watch("amount")) || MINIMUM_USDT;
  const requiredCoins = watchedAmount * COINS_PER_USDT;
  const feeAmount = feeEnabled && feePct > 0
    ? Math.round(watchedAmount * feePct / 100 * 100) / 100
    : 0;
  const netPayout = Math.round((watchedAmount - feeAmount) * 100) / 100;

  return (
    <div className="px-4 pt-2 pb-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-serif">Wallet</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your earnings and withdrawals</p>
      </div>

      {/* Main balance card */}
      <div
        className="rounded-2xl p-5 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4c1d95 100%)" }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10" style={{ background: "radial-gradient(circle, white, transparent)", transform: "translate(30%, -30%)" }} />
        <p className="text-white/70 text-xs font-medium uppercase tracking-wider mb-1">Total Balance</p>
        <p className="text-4xl font-black font-serif mb-0.5">{coinBalance.toFixed(2)}</p>
        <p className="text-white/80 text-sm">coins · <span className="font-semibold">${usdtValue.toFixed(2)} USDT</span></p>
        <p className="text-white/50 text-xs mt-3">1 USDT = 1,000 coins</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-card-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Earned</p>
          <p className="text-lg font-bold text-foreground">{(wallet?.totalBalance ?? 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">coins</p>
        </div>
        <div className="bg-card border border-card-border rounded-2xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Withdrawn</p>
          <p className="text-lg font-bold text-emerald-500">${(wallet?.totalWithdrawn ?? 0).toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">USDT</p>
        </div>
      </div>

      {/* Withdraw section */}
      <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              USDT Withdrawal
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Min. 5,000 coins = 5 USDT</p>
          </div>
          <Button
            onClick={openWithdraw}
            disabled={walletLoading || !emailVerified}
            className="gap-2"
            data-testid="button-withdraw"
          >
            <ArrowUpRight className="w-4 h-4" />
            Withdraw
          </Button>
        </div>

        {!emailVerified && !walletLoading && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <MailWarning className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-500">Email verification required</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Please verify your email address before withdrawing. Check the banner at the top of the page to resend the verification link.
              </p>
            </div>
          </div>
        )}
        {!canWithdraw && !walletLoading && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
                Minimum withdrawal is 5,000 coins (5 USDT)
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You need {Math.max(0, MINIMUM_COINS - coinBalance).toFixed(0)} more coins to unlock withdrawals.
              </p>
            </div>
          </div>
        )}

        {canWithdraw && nearbyUpgrades && nearbyUpgrades.length > 0 && (
          <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 rounded-xl p-3">
            <Zap className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-xs text-primary">
              You're close to upgrading your mining level — upgrade now to earn faster!
            </p>
          </div>
        )}
      </div>

      {/* Transaction History */}
      <div>
        <h3 className="font-semibold mb-3">Transaction History</h3>
        {txLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : transactions && transactions.length > 0 ? (
          <div className="space-y-2">
            {transactions.map(tx => (
              <div key={tx.id} className="flex flex-col gap-1">
                <button
                  onClick={() => setSelectedTx(tx)}
                  className="w-full bg-card border border-card-border rounded-xl p-3 flex items-center gap-3 text-left hover:bg-accent/50 active:scale-[0.99] transition-all"
                  data-testid={`tx-${tx.id}`}
                >
                  <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                    {getTypeIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description}</p>
                    <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                    <p className={`text-sm font-bold ${tx.amount >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {tx.amount >= 0 ? "+" : ""}{tx.amount.toFixed(2)}
                    </p>
                    {getStatusBadge(tx.status)}
                  </div>
                </button>
                {tx.type === "withdrawal" && (
                  <button
                    onClick={() => setShareTx(tx)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-primary/5 border border-primary/20 text-primary hover:bg-primary/10 active:scale-[0.99] transition-all text-xs font-semibold"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Share withdrawal receipt &amp; earn coins
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No transactions yet. Start mining to earn!</p>
          </div>
        )}
      </div>

      {/* Withdrawal Dialog */}
      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-primary" />
              {step === "choose" ? "Withdraw USDT" : step === "form" ? "Enter Withdrawal Details" : "Withdrawal Submitted"}
            </DialogTitle>
          </DialogHeader>

          {/* Step 1: Choose action */}
          {step === "choose" && (
            <div className="space-y-4 pt-2">
              {/* Balance summary */}
              <div className="bg-muted rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Your balance</p>
                <p className="text-2xl font-black text-foreground">{coinBalance.toFixed(0)} <span className="text-base font-normal text-muted-foreground">coins</span></p>
                <p className="text-sm text-primary font-semibold">≈ ${usdtValue.toFixed(2)} USDT</p>
              </div>

              {!canWithdraw ? (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-center">
                  <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-foreground">Minimum withdrawal is 5,000 coins</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You need {Math.max(0, MINIMUM_COINS - coinBalance).toFixed(0)} more coins (${((MINIMUM_COINS - coinBalance) / COINS_PER_USDT).toFixed(2)} USDT) to withdraw.
                  </p>
                  <Button variant="outline" className="mt-3 w-full gap-2" onClick={handleUpgradeInstead}>
                    <TrendingUp className="w-4 h-4" />
                    Upgrade Mining Instead
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground text-center">What would you like to do with your earnings?</p>

                  {nearbyUpgrades && nearbyUpgrades.length > 0 && (
                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3">
                      <p className="text-xs text-primary font-medium">
                        💡 Upgrade your mining power instead and earn even faster!
                      </p>
                      {nearbyUpgrades.slice(0, 1).map(u => (
                        <p key={u.id} className="text-xs text-muted-foreground mt-1">
                          "{u.name}" — {u.coinCost?.toLocaleString()} coins (${((u.coinCost ?? 0) / COINS_PER_USDT).toFixed(2)} USDT)
                        </p>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleUpgradeInstead}
                    className="w-full rounded-xl p-4 text-left border border-primary/30 hover:border-primary/60 transition-colors flex items-center gap-3"
                    style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(91,33,182,0.08))" }}
                    data-testid="button-upgrade-instead"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Upgrade Instead</p>
                      <p className="text-xs text-muted-foreground">Boost mining power for higher earnings</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setStep("form")}
                    className="w-full rounded-xl p-4 text-left border border-emerald-500/30 hover:border-emerald-500/60 transition-colors flex items-center gap-3"
                    style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.08))" }}
                    data-testid="button-withdraw-now"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Withdraw Now</p>
                      <p className="text-xs text-muted-foreground">Transfer up to ${maxUsdt.toFixed(2)} USDT to your wallet</p>
                    </div>
                  </button>

                  {feeEnabled && feePct > 0 && (
                    <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-rose-400">
                        A <strong>{feePct}% withdrawal fee</strong> applies. You will receive less than the amount you request.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Withdrawal form */}
          {step === "form" && (
            <div className="space-y-4 pt-2">
              <div className="bg-muted rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Available to withdraw</span>
                <span className="text-sm font-bold text-foreground">{coinBalance.toFixed(0)} coins (${usdtValue.toFixed(2)} USDT)</span>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onWithdraw)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="walletAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>USDT Wallet Address (BEP20)</FormLabel>
                        <FormControl>
                          <Input placeholder="BEP20 address (0x...)" data-testid="input-wallet-address" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount (USDT)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={MINIMUM_USDT}
                            max={maxUsdt}
                            step="0.01"
                            placeholder={`Min $${MINIMUM_USDT}`}
                            data-testid="input-amount"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground">
                          Deducts {requiredCoins.toLocaleString()} coins from your balance
                        </p>
                      </FormItem>
                    )}
                  />

                  {feeEnabled && feePct > 0 && (
                    <div className="bg-muted rounded-xl px-4 py-3 space-y-1.5 text-sm">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Requested</span>
                        <span>${watchedAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-rose-500">
                        <span>Fee ({feePct}%)</span>
                        <span>−${feeAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-semibold text-emerald-500 border-t border-border pt-1.5">
                        <span>You receive</span>
                        <span>${netPayout.toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("choose")}>
                      Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={requestWithdrawal.isPending} data-testid="button-confirm-withdraw">
                      {requestWithdrawal.isPending ? "Processing..." : "Submit"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          )}

          {/* Step 3: Result */}
          {step === "result" && withdrawalResult && (
            <div className="space-y-4 pt-2">
              <div className="text-center py-2">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                </div>
                <p className="font-semibold text-foreground">Withdrawal Request Submitted</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your request is being reviewed. You will receive your USDT once approved.
                </p>
              </div>

              {/* Payout breakdown receipt */}
              <div className="bg-muted rounded-xl px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Amount requested</span>
                  <span>${withdrawalResult.grossAmount.toFixed(2)} USDT</span>
                </div>
                {withdrawalResult.feeDeducted > 0 && (
                  <div className="flex justify-between text-rose-500">
                    <span>Fee deducted ({feePct}%)</span>
                    <span>−${withdrawalResult.feeDeducted.toFixed(2)} USDT</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-emerald-500 border-t border-border pt-2">
                  <span>You will receive</span>
                  <span>${withdrawalResult.amount.toFixed(2)} USDT</span>
                </div>
              </div>

              <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                <p className="text-sm font-semibold text-primary mb-1">⏱ Please allow 2–12 hours</p>
                <p className="text-xs text-muted-foreground">
                  Our team will review and process your withdrawal within 2–12 hours. Check your transaction history for updates.
                </p>
              </div>

              {/* Receipt card (screenshottable) */}
              <div ref={receiptRef} className="rounded-2xl overflow-hidden border border-emerald-500/30" style={{ background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)" }}>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">MineNova — Withdrawal</p>
                      <p className="text-[10px] text-white/40">{new Date().toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-center py-2">
                    <p className="text-3xl font-black text-white">${withdrawalResult.amount.toFixed(2)}</p>
                    <p className="text-xs text-white/50">USDT requested</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-white/40">Join free with my referral link:</p>
                    <p className="text-xs font-mono text-emerald-400 break-all">{referralUrl}</p>
                  </div>
                </div>
              </div>

              {/* Share section */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Share2 className="w-3 h-3" /> Share with your referral link
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleShare("twitter", withdrawalResult.amount, withdrawalResult.transactionId, receiptRef)}
                    disabled={screenshotting}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                  >
                    {screenshotting ? <RefreshCcw className="w-4 h-4 text-sky-400 animate-spin" /> : <Twitter className="w-4 h-4 text-sky-400" />}
                    <span className="text-xs text-sky-400 font-medium">Twitter</span>
                  </button>
                  <button
                    onClick={() => handleShare("whatsapp", withdrawalResult.amount, withdrawalResult.transactionId, receiptRef)}
                    disabled={screenshotting}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    {screenshotting ? <RefreshCcw className="w-4 h-4 text-emerald-500 animate-spin" /> : <MessageCircle className="w-4 h-4 text-emerald-500" />}
                    <span className="text-xs text-emerald-500 font-medium">WhatsApp</span>
                  </button>
                  <button
                    onClick={() => handleShare("facebook", withdrawalResult.amount, withdrawalResult.transactionId, receiptRef)}
                    disabled={screenshotting}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                  >
                    {screenshotting ? <RefreshCcw className="w-4 h-4 text-blue-500 animate-spin" /> : <Facebook className="w-4 h-4 text-blue-500" />}
                    <span className="text-xs text-blue-500 font-medium">Facebook</span>
                  </button>
                </div>
                <button
                  onClick={() => downloadReceiptJpeg(receiptRef, withdrawalResult.amount, withdrawalResult.transactionId)}
                  disabled={screenshotting}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-border hover:bg-accent/50 transition-colors text-xs text-muted-foreground disabled:opacity-50"
                >
                  {screenshotting ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {screenshotting ? "Capturing…" : "Download JPG"}
                </button>
              </div>

              <Button className="w-full" onClick={closeDialog}>Got it</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Transaction Detail Modal */}
      <Dialog open={!!selectedTx} onOpenChange={open => { if (!open) setSelectedTx(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="w-4 h-4 text-primary" />
              Transaction Details
            </DialogTitle>
          </DialogHeader>
          {selectedTx && (() => {
            const tx = selectedTx;
            const dt = new Date(tx.createdAt);
            const isCredit = tx.amount >= 0;
            return (
              <div className="space-y-4 pt-1">
                {/* Icon + type header */}
                <div className="flex items-center gap-3 p-4 bg-muted rounded-xl">
                  <div className="w-11 h-11 rounded-xl bg-background flex items-center justify-center flex-shrink-0">
                    {getTypeIcon(tx.type, "w-5 h-5")}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm">{getTypeLabel(tx.type)}</p>
                    <p className={`text-xl font-black ${isCredit ? "text-emerald-500" : "text-rose-500"}`}>
                      {isCredit ? "+" : ""}{tx.amount.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">coins</span>
                    </p>
                  </div>
                  <div className="ml-auto flex-shrink-0">{getStatusBadge(tx.status)}</div>
                </div>

                {/* Details rows */}
                <div className="space-y-0 divide-y divide-border rounded-xl border border-card-border overflow-hidden">
                  <div className="flex justify-between items-start px-4 py-3 bg-card">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Hash className="w-3 h-3" /> Transaction ID
                    </span>
                    <span className="text-xs font-mono text-foreground font-semibold">#{tx.id}</span>
                  </div>

                  <div className="flex justify-between items-start px-4 py-3 bg-card">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <CalendarDays className="w-3 h-3" /> Date &amp; Time
                    </span>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-foreground">{dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
                      <p className="text-[11px] text-muted-foreground">{dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-start px-4 py-3 bg-card">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Info className="w-3 h-3" /> Description
                    </span>
                    <span className="text-xs text-foreground text-right max-w-[60%] leading-relaxed">{tx.description}</span>
                  </div>

                  {tx.amount !== 0 && (
                    <div className="flex justify-between items-center px-4 py-3 bg-card">
                      <span className="text-xs text-muted-foreground">USDT value</span>
                      <span className="text-xs font-semibold text-foreground">
                        {isCredit ? "+" : ""}${(Math.abs(tx.amount) / COINS_PER_USDT).toFixed(4)} USDT
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {tx.type === "withdrawal" && (
                    <Button
                      className="flex-1 gap-1.5"
                      variant="outline"
                      onClick={() => { setSelectedTx(null); setShareTx(tx); }}
                    >
                      <Share2 className="w-3.5 h-3.5" /> Share
                    </Button>
                  )}
                  <Button className="flex-1" variant="outline" onClick={() => setSelectedTx(null)}>Close</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Share from History Modal */}
      <Dialog open={!!shareTx} onOpenChange={open => { if (!open) setShareTx(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Share2 className="w-4 h-4 text-primary" />
              Share Withdrawal
            </DialogTitle>
          </DialogHeader>
          {shareTx && (() => {
            const amountUsdt = Math.abs(shareTx.amount);
            return (
              <div className="space-y-4 pt-1">
                <div ref={shareTxReceiptRef} className="rounded-2xl border border-emerald-500/30 p-4 space-y-3" style={{ background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 100%)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">MineNova — Withdrawal #{shareTx.id}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-black text-white">${amountUsdt.toFixed(2)} <span className="text-sm font-normal text-white/50">USDT</span></p>
                  </div>
                  <div className="text-center">
                    <p className="text-[11px] text-white/40">Join free with my referral link:</p>
                    <p className="text-xs font-mono text-emerald-400 break-all">{referralUrl}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center flex items-center gap-1 justify-center">
                    <Share2 className="w-3 h-3" /> Share with your referral link
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleShare("twitter", amountUsdt, shareTx.id, shareTxReceiptRef)}
                      disabled={screenshotting}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors disabled:opacity-50"
                    >
                      {screenshotting ? <RefreshCcw className="w-4 h-4 text-sky-400 animate-spin" /> : <Twitter className="w-4 h-4 text-sky-400" />}
                      <span className="text-xs text-sky-400 font-medium">Twitter</span>
                    </button>
                    <button
                      onClick={() => handleShare("whatsapp", amountUsdt, shareTx.id, shareTxReceiptRef)}
                      disabled={screenshotting}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                    >
                      {screenshotting ? <RefreshCcw className="w-4 h-4 text-emerald-500 animate-spin" /> : <MessageCircle className="w-4 h-4 text-emerald-500" />}
                      <span className="text-xs text-emerald-500 font-medium">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => handleShare("facebook", amountUsdt, shareTx.id, shareTxReceiptRef)}
                      disabled={screenshotting}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                    >
                      {screenshotting ? <RefreshCcw className="w-4 h-4 text-blue-500 animate-spin" /> : <Facebook className="w-4 h-4 text-blue-500" />}
                      <span className="text-xs text-blue-500 font-medium">Facebook</span>
                    </button>
                  </div>
                  <button
                    onClick={() => downloadReceiptJpeg(shareTxReceiptRef, amountUsdt, shareTx.id)}
                    disabled={screenshotting}
                    className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-border hover:bg-accent/50 transition-colors text-xs text-muted-foreground disabled:opacity-50"
                  >
                    {screenshotting ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {screenshotting ? "Capturing…" : "Download JPG"}
                  </button>
                </div>
                <Button className="w-full" variant="outline" onClick={() => setShareTx(null)}>Done</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
