import { useState, useRef } from "react";
import {
  useGetUpgrades,
  usePurchaseUpgrade,
  useBundlePurchaseUpgrade,
  getGetUpgradesQueryKey,
  getGetWalletQueryKey,
  getGetMiningStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetWallet } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, CheckCircle2, Cpu, TrendingUp, Lock, Copy, DollarSign,
  Clock, MessageCircle, Package, ChevronRight,
} from "lucide-react";
import SupportChat from "@/components/SupportChat";

interface PurchaseResult {
  usdtAddress: string | null | undefined;
  paymentTag: string | null | undefined;
  message: string;
  usdtCost?: number | null;
  coinCost?: number | null;
  upgradeName?: string;
  isCoin: boolean;
}

type ModalMode =
  | { type: "single"; upgradeId: number }
  | { type: "bundle"; targetLevel: number };

export default function Upgrades() {
  const { data: upgrades, isLoading, isError, refetch } = useGetUpgrades();
  const { data: wallet } = useGetWallet();
  const purchaseUpgrade = usePurchaseUpgrade();
  const bundlePurchase = useBundlePurchaseUpgrade();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [modal, setModal] = useState<ModalMode | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"coins" | "usdt">("coins");
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [hasSent, setHasSent] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [supportInitialMessage, setSupportInitialMessage] = useState<string | undefined>(undefined);
  const supportChatTriggerRef = useRef<number>(0);

  const coinBalance = wallet?.totalBalance ?? 0;

  const selectedUpgrade = modal?.type === "single"
    ? upgrades?.find(u => u.id === modal.upgradeId)
    : null;

  const bundleTarget = modal?.type === "bundle"
    ? upgrades?.find(u => u.tier === modal.targetLevel)
    : null;

  const bundlePrice = bundleTarget?.bundlePrice ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetUpgradesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
  };

  const openSingleModal = (upgradeId: number) => {
    const u = upgrades?.find(x => x.id === upgradeId);
    if (!u) return;
    const defaultMethod: "coins" | "usdt" = !u.coinCost
      ? "usdt"
      : (!u.usdtCost ? "coins" : (coinBalance >= (u.coinCost ?? 0) ? "coins" : "usdt"));
    setPaymentMethod(defaultMethod);
    setModal({ type: "single", upgradeId });
  };

  const openBundleModal = (targetLevel: number) => {
    const u = upgrades?.find(x => x.tier === targetLevel);
    const bundle = u?.bundlePrice;
    if (!bundle) return;
    const canAffordCoins = coinBalance >= bundle.coins;
    setPaymentMethod(canAffordCoins ? "coins" : "usdt");
    setModal({ type: "bundle", targetLevel });
  };

  const handleSinglePurchase = () => {
    if (modal?.type !== "single") return;
    purchaseUpgrade.mutate(
      { upgradeId: modal.upgradeId, data: { paymentMethod } },
      {
        onSuccess: (res) => {
          setModal(null);
          setPurchaseResult({
            usdtAddress: res.usdtAddress,
            paymentTag: res.paymentTag,
            message: res.message,
            usdtCost: selectedUpgrade?.usdtCost,
            coinCost: selectedUpgrade?.coinCost,
            upgradeName: selectedUpgrade?.name,
            isCoin: paymentMethod === "coins",
          });
          setHasSent(false);
          setResultOpen(true);
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = (err as { data?: { error?: string } })?.data?.error ?? "Purchase failed";
          toast({ variant: "destructive", title: "Error", description: msg });
        },
      }
    );
  };

  const handleBundlePurchase = () => {
    if (modal?.type !== "bundle") return;
    bundlePurchase.mutate(
      { data: { targetLevel: modal.targetLevel, paymentMethod } },
      {
        onSuccess: (res) => {
          setModal(null);
          setPurchaseResult({
            usdtAddress: res.usdtAddress,
            paymentTag: res.paymentTag,
            message: res.message,
            usdtCost: paymentMethod === "usdt" ? res.totalCost : null,
            coinCost: paymentMethod === "coins" ? res.totalCost : null,
            upgradeName: `Levels ${res.levelsUnlocked.join(", ")}`,
            isCoin: paymentMethod === "coins",
          });
          setHasSent(false);
          setResultOpen(true);
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = (err as { data?: { error?: string } })?.data?.error ?? "Bundle purchase failed";
          toast({ variant: "destructive", title: "Error", description: msg });
        },
      }
    );
  };

  const handleMarkPaid = async () => {
    const paymentTag = purchaseResult?.paymentTag;
    if (!paymentTag) { setHasSent(true); return; }
    setMarkingPaid(true);
    try {
      await fetch("/api/upgrades/payments/mark-paid", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentTag }),
      });
    } catch { /* ignore */ } finally {
      setHasSent(true);
      setMarkingPaid(false);
    }
  };

  const handleSendPOP = () => {
    const upgradeName = purchaseResult?.upgradeName ?? "upgrade";
    const paymentTag = purchaseResult?.paymentTag;
    const usdtCost = purchaseResult?.usdtCost;
    const msg = paymentTag
      ? `Hi, I just paid $${usdtCost} USDT for the ${upgradeName}. My payment tag is: ${paymentTag}. Please verify my payment.`
      : `Hi, I just purchased the ${upgradeName} upgrade with coins. Please confirm the activation.`;
    setSupportInitialMessage(msg);
    supportChatTriggerRef.current += 1;
    setResultOpen(false);
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>("[data-testid='button-support-chat-open']");
      btn?.click();
    }, 100);
  };

  const isPending = purchaseUpgrade.isPending || bundlePurchase.isPending;

  // Compute the current user level from the upgrades list
  const nextUpgrade = upgrades?.find(u => u.isNext);
  const currentUserLevel = nextUpgrade ? nextUpgrade.tier - 1 : (upgrades?.length ?? 0);

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Upgrade Mining Rig</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Unlock levels sequentially to increase your mining power</p>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Your Coin Balance</p>
          <p className="text-2xl font-bold text-primary">{coinBalance.toFixed(2)} <span className="text-sm text-muted-foreground">coins</span></p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Mining Level</p>
          <p className="text-2xl font-bold">{currentUserLevel}</p>
        </div>
        <Cpu className="w-8 h-8 text-muted-foreground" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-6 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">Could not load upgrades</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="relative space-y-1">
          {upgrades?.map((upgrade, idx) => {
            const isUnlocked = upgrade.isUnlocked;
            const isNext = upgrade.isNext;
            const isLocked = !isUnlocked && !isNext;
            const hasBundleOption = !!upgrade.bundlePrice;

            return (
              <div key={upgrade.id} className="relative flex gap-3">
                {/* Connector line */}
                {idx < (upgrades.length - 1) && (
                  <div className="absolute left-[22px] top-[44px] w-0.5 h-[calc(100%-12px)] bg-border z-0" />
                )}

                {/* Level circle */}
                <div className={`relative z-10 flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold border-2 mt-1
                  ${isUnlocked
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : isNext
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-card border-border text-muted-foreground"
                  }`}>
                  {isUnlocked ? <CheckCircle2 className="w-5 h-5" /> : upgrade.tier}
                </div>

                {/* Card */}
                <div
                  className={`flex-1 mb-3 rounded-2xl border p-4 transition-all
                    ${isUnlocked
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : isNext
                        ? "border-primary/30 bg-primary/5"
                        : "border-border bg-card opacity-80"
                    }`}
                  data-testid={`upgrade-card-${upgrade.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-base">{upgrade.icon}</span>
                        <h3 className="font-semibold text-sm">{upgrade.name}</h3>
                        {upgrade.badge && (
                          <Badge className="text-xs bg-accent/20 text-accent border-0">{upgrade.badge}</Badge>
                        )}
                        {upgrade.isAutoMining && (
                          <Badge className="text-xs bg-purple-500/20 text-purple-500 border-0">Auto</Badge>
                        )}
                        {isUnlocked && (
                          <Badge className="text-xs bg-emerald-500/20 text-emerald-600 border-0">Active</Badge>
                        )}
                        {isNext && (
                          <Badge className="text-xs bg-primary/20 text-primary border-0">Next</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{upgrade.description}</p>

                      <div className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <TrendingUp className="w-3 h-3 text-primary" />
                          <span>+{upgrade.hashRateBoost} MH/s</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Zap className="w-3 h-3 text-accent" />
                          <span>+{upgrade.dailyCapBoost} daily cap</span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-emerald-600">
                          <DollarSign className="w-3 h-3" />
                          <span>
                            {upgrade.coinCost ? `${upgrade.coinCost.toLocaleString()} coins` : ""}
                            {upgrade.coinCost && upgrade.usdtCost ? " · " : ""}
                            {upgrade.usdtCost ? `$${upgrade.usdtCost} USDT` : ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex-shrink-0 flex flex-col gap-2 items-end">
                      {isUnlocked ? (
                        <div className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Unlocked
                        </div>
                      ) : isNext ? (
                        <Button
                          size="sm"
                          onClick={() => openSingleModal(upgrade.id)}
                          className="gap-1.5"
                          data-testid={`button-upgrade-${upgrade.id}`}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Upgrade
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground text-xs">
                          <Lock className="w-3 h-3" />
                          Locked
                        </div>
                      )}

                      {/* Bundle skip button */}
                      {isLocked && hasBundleOption && (
                        <button
                          onClick={() => openBundleModal(upgrade.tier)}
                          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                          data-testid={`button-bundle-${upgrade.tier}`}
                        >
                          <Package className="w-3 h-3" />
                          Bundle skip
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bundle price preview */}
                  {isLocked && upgrade.bundlePrice && (
                    <div className="mt-2 pt-2 border-t border-border/50 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">Bundle to here:</span>
                      <span className="text-xs font-semibold text-primary">
                        {upgrade.bundlePrice.coins.toLocaleString()} coins
                      </span>
                      <span className="text-xs text-muted-foreground">or</span>
                      <span className="text-xs font-semibold text-accent">
                        ${upgrade.bundlePrice.usdt} USDT
                      </span>
                      <Badge className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">
                        {upgrade.bundlePrice.usdtDiscountPct}% off USDT · {upgrade.bundlePrice.coinDiscountPct}% off coins
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Single-level Purchase Dialog ─────────────────────────────── */}
      <Dialog open={modal?.type === "single"} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase Upgrade</DialogTitle>
          </DialogHeader>
          {selectedUpgrade && (
            <div className="space-y-4 pt-2">
              <div className="bg-muted rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{selectedUpgrade.icon}</span>
                  <h3 className="font-semibold">{selectedUpgrade.name}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{selectedUpgrade.description}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {selectedUpgrade.coinCost && (
                    <button
                      onClick={() => setPaymentMethod("coins")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "coins" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    >
                      <p className="text-sm font-semibold">{selectedUpgrade.coinCost.toLocaleString()} coins</p>
                      <p className="text-xs text-muted-foreground">From your balance</p>
                    </button>
                  )}
                  {selectedUpgrade.usdtCost && (
                    <button
                      onClick={() => setPaymentMethod("usdt")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "usdt" ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}
                    >
                      <p className="text-sm font-semibold text-accent">${selectedUpgrade.usdtCost} USDT</p>
                      <p className="text-xs text-muted-foreground">USDT payment</p>
                    </button>
                  )}
                </div>
              </div>

              {paymentMethod === "coins" && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                  Your balance: <strong>{coinBalance.toFixed(2)} coins</strong>
                  {coinBalance < (selectedUpgrade.coinCost ?? 0) && (
                    <span className="text-destructive ml-2">Insufficient balance</span>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleSinglePurchase}
                disabled={isPending || (paymentMethod === "coins" && coinBalance < (selectedUpgrade.coinCost ?? 0))}
                data-testid="button-confirm-purchase"
              >
                {isPending ? "Processing..." : `Purchase with ${paymentMethod === "coins" ? "Coins" : "USDT"}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bundle Purchase Dialog ──────────────────────────────────── */}
      <Dialog open={modal?.type === "bundle"} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Bundle Skip to Level {modal?.type === "bundle" ? modal.targetLevel : ""}
            </DialogTitle>
          </DialogHeader>
          {bundleTarget && bundlePrice && (
            <div className="space-y-4 pt-2">
              <div className="bg-muted rounded-xl p-4">
                <p className="text-sm text-muted-foreground">
                  Unlock all levels up to <strong>{bundleTarget.name}</strong> at once with a bundle discount.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">Coins</p>
                    <p className="text-sm font-bold text-primary">{bundlePrice.coins.toLocaleString()}</p>
                    <p className="text-xs text-emerald-600">{bundlePrice.coinDiscountPct}% off</p>
                  </div>
                  <div className="bg-accent/10 border border-accent/20 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">USDT</p>
                    <p className="text-sm font-bold text-accent">${bundlePrice.usdt}</p>
                    <p className="text-xs text-emerald-600">{bundlePrice.usdtDiscountPct}% off</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPaymentMethod("coins")}
                    className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "coins" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                  >
                    <p className="text-sm font-semibold">{bundlePrice.coins.toLocaleString()} coins</p>
                    <p className="text-xs text-muted-foreground">5% bundle discount</p>
                  </button>
                  <button
                    onClick={() => setPaymentMethod("usdt")}
                    className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "usdt" ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}
                  >
                    <p className="text-sm font-semibold text-accent">${bundlePrice.usdt} USDT</p>
                    <p className="text-xs text-muted-foreground">10% bundle discount</p>
                  </button>
                </div>
              </div>

              {paymentMethod === "coins" && coinBalance < bundlePrice.coins && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-xs text-destructive">
                  Insufficient balance. Need {bundlePrice.coins.toLocaleString()} coins, you have {coinBalance.toFixed(0)}.
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={handleBundlePurchase}
                disabled={isPending || (paymentMethod === "coins" && coinBalance < bundlePrice.coins)}
                data-testid="button-confirm-bundle"
              >
                <Package className="w-4 h-4" />
                {isPending ? "Processing..." : `Bundle with ${paymentMethod === "coins" ? "Coins" : "USDT"}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Purchase Result Dialog ──────────────────────────────────── */}
      <Dialog
        open={resultOpen}
        onOpenChange={(open) => { setResultOpen(open); if (!open) setHasSent(false); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {purchaseResult?.usdtAddress
                ? hasSent ? "Payment Submitted" : "Complete Your Payment"
                : "Upgrade Activated"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {hasSent ? (
              <div className="space-y-4">
                <div className="text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
                    <Clock className="w-7 h-7 text-primary" />
                  </div>
                  <p className="font-semibold text-foreground">Awaiting Admin Verification</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Thank you for sending <strong>${purchaseResult?.usdtCost} USDT</strong>.
                  </p>
                </div>
                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                  <p className="text-sm font-semibold text-primary mb-1">⏱ Admin will verify within 2–12 hours</p>
                  <p className="text-xs text-muted-foreground">
                    Your <strong>{purchaseResult?.upgradeName}</strong> upgrade will be activated once confirmed.
                  </p>
                </div>
                <button
                  onClick={handleSendPOP}
                  className="w-full flex items-center justify-center gap-2 border border-primary/30 text-primary rounded-xl py-2.5 text-sm font-medium hover:bg-primary/10 transition-colors"
                  data-testid="button-send-pop"
                >
                  <MessageCircle className="w-4 h-4" />
                  Send POP to Admin
                </button>
                <Button className="w-full" onClick={() => setResultOpen(false)}>Got it</Button>
              </div>
            ) : (
              <>
                {purchaseResult?.usdtAddress ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{purchaseResult.message}</p>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Send USDT to (BEP20)</p>
                      <div className="flex gap-2">
                        <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all">{purchaseResult.usdtAddress}</div>
                        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(purchaseResult.usdtAddress ?? "")}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {purchaseResult.paymentTag && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Payment Tag (Required)</p>
                        <div className="flex gap-2">
                          <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 font-mono font-bold text-primary text-sm">
                            {purchaseResult.paymentTag}
                          </div>
                          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(purchaseResult.paymentTag ?? "")}>
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        Always include your payment tag in the memo/note field. Without it we cannot process your upgrade.
                      </p>
                    </div>
                    <Button className="w-full gap-2" onClick={handleMarkPaid} disabled={markingPaid}>
                      <CheckCircle2 className="w-4 h-4" />
                      {markingPaid ? "Notifying admin..." : `I have sent $${purchaseResult.usdtCost} USDT`}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-center py-2">
                      <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                      </div>
                      <p className="font-semibold text-foreground">Upgrade Activated!</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        <strong>{purchaseResult?.upgradeName}</strong> is now active.
                      </p>
                    </div>
                    <button
                      onClick={handleSendPOP}
                      className="w-full flex items-center justify-center gap-2 border border-primary/30 text-primary rounded-xl py-2.5 text-sm font-medium hover:bg-primary/10 transition-colors"
                      data-testid="button-send-pop-coins"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Send POP to Admin
                    </button>
                    <Button className="w-full" onClick={() => setResultOpen(false)}>Got it</Button>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <SupportChat
        key={supportChatTriggerRef.current}
        initialMessage={supportInitialMessage}
      />
    </div>
  );
}
