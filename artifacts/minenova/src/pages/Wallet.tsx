import { useState } from "react";
import {
  useGetWallet,
  useRequestWithdrawal,
  useGetTransactions,
  useGetUpgrades,
  getGetWalletQueryKey,
  getGetTransactionsQueryKey,
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
import { Wallet, ArrowUpRight, Clock, CheckCircle2, XCircle, Copy, AlertCircle, TrendingUp, Zap, Twitter, Facebook, MessageCircle, Share2, MailWarning } from "lucide-react";
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

function getTypeIcon(type: string) {
  if (type === "withdrawal") return <ArrowUpRight className="w-4 h-4 text-rose-500" />;
  if (type === "mining") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (type === "task") return <CheckCircle2 className="w-4 h-4 text-primary" />;
  if (type === "upgrade") return <XCircle className="w-4 h-4 text-orange-500" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
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
  const [hasSentWithdrawal, setHasSentWithdrawal] = useState(false);

  const { user } = useAuth();
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
      setHasSentWithdrawal(false);
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

  const watchedAmount = form.watch("amount") || MINIMUM_USDT;
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
              <div key={tx.id} className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3" data-testid={`tx-${tx.id}`}>
                <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                  {getTypeIcon(tx.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tx.description}</p>
                  <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${tx.amount >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                    {tx.amount >= 0 ? "+" : ""}{tx.amount.toFixed(2)}
                  </p>
                  {getStatusBadge(tx.status)}
                </div>
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
                        <FormLabel>USDT Wallet Address (TRC20)</FormLabel>
                        <FormControl>
                          <Input placeholder="TRC20 address (TRX...)" data-testid="input-wallet-address" {...field} />
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
              {hasSentWithdrawal ? (
                <>
                  <div className="text-center py-2">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                    </div>
                    <p className="font-semibold text-foreground">Transfer Confirmed</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your withdrawal of <strong>${withdrawalResult.amount.toFixed(2)} USDT</strong> is being processed.
                      {withdrawalResult.feeDeducted > 0 && (
                        <span className="block text-xs text-rose-400 mt-1">${withdrawalResult.feeDeducted.toFixed(2)} USDT fee was deducted from your requested ${withdrawalResult.grossAmount.toFixed(2)} USDT.</span>
                      )}
                    </p>
                  </div>
                  <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                    <p className="text-sm font-semibold text-primary mb-1">⏱ Please allow 2–12 hours</p>
                    <p className="text-xs text-muted-foreground">
                      Our team will verify your payment and process your withdrawal within 2–12 hours. Check your transaction history for updates.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center flex items-center gap-1 justify-center">
                      <Share2 className="w-3 h-3" /> Share your withdrawal with friends
                    </p>
                    {(() => {
                      const shareMsg = encodeURIComponent(`I just withdrew $${withdrawalResult.amount} USDT from MineNova! 💰\n\nThis platform actually pays — mine crypto and cash out as USDT with no delays.\n\nTry it free and start earning today!`);
                      return (
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${shareMsg}`, "_blank")}
                            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                          >
                            <Twitter className="w-4 h-4 text-sky-400" />
                            <span className="text-xs text-sky-400 font-medium">Twitter</span>
                          </button>
                          <button
                            onClick={() => window.open(`https://api.whatsapp.com/send?text=${shareMsg}`, "_blank")}
                            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                          >
                            <MessageCircle className="w-4 h-4 text-emerald-500" />
                            <span className="text-xs text-emerald-500 font-medium">WhatsApp</span>
                          </button>
                          <button
                            onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?quote=${shareMsg}`, "_blank")}
                            className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                          >
                            <Facebook className="w-4 h-4 text-blue-500" />
                            <span className="text-xs text-blue-500 font-medium">Facebook</span>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <Button className="w-full" onClick={closeDialog}>Got it</Button>
                </>
              ) : (
                <>
                  <div className="text-center">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                      <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                    </div>
                    <p className="font-semibold text-foreground">Withdrawal Request Submitted</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Send USDT to the address below via TRC20 network with your payment tag.
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
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">USDT Address (TRC20)</p>
                      <div className="flex gap-2">
                        <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all">
                          {withdrawalResult.usdtAddress}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(withdrawalResult.usdtAddress, "USDT address")}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Payment Tag (Required)</p>
                      <div className="flex gap-2">
                        <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-sm font-mono font-bold text-primary">
                          {withdrawalResult.paymentTag}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(withdrawalResult.paymentTag, "Payment tag")}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      Always include your payment tag in the memo/note field. Without it we cannot process your withdrawal.
                    </p>
                  </div>
                  <Button className="w-full gap-2" onClick={() => setHasSentWithdrawal(true)}>
                    <CheckCircle2 className="w-4 h-4" />
                    I have sent ${withdrawalResult.amount} USDT
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
