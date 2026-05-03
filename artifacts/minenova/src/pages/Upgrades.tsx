import { useState, useEffect } from "react";
import { useGetUpgrades, usePurchaseUpgrade, getGetUpgradesQueryKey, getGetWalletQueryKey, getGetMiningStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetWallet } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Zap, CheckCircle2, Cpu, TrendingUp, Lock, Copy, DollarSign, Clock } from "lucide-react";

const BASE_COINS_PER_HOUR = 10;
const SESSION_HOURS = 12;
const COINS_PER_USDT = 1000;

function calcDailyUsdt(hashRateBoost: number, dailyCapBoost: number): number {
  const boostedRate = BASE_COINS_PER_HOUR * (1 + hashRateBoost / 100);
  const rawDailyCoins = boostedRate * SESSION_HOURS;
  return Math.min(rawDailyCoins, dailyCapBoost) / COINS_PER_USDT;
}

interface PurchaseResult {
  transactionId?: number | null;
  usdtAddress: string | null | undefined;
  paymentTag: string | null | undefined;
  message: string;
  usdtCost?: number | null;
  upgradeName?: string;
}

export default function Upgrades() {
  const { data: upgrades, isLoading, isError, refetch } = useGetUpgrades();
  const { data: wallet } = useGetWallet();
  const purchaseUpgrade = usePurchaseUpgrade();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedUpgrade, setSelectedUpgrade] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"coins" | "usdt">("coins");
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [hasSent, setHasSent] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);

  const selectedUpgradeData = upgrades?.find(u => u.id === selectedUpgrade);
  const coinBalance = wallet?.totalBalance ?? 0;
  const canAffordCoins = coinBalance >= (selectedUpgradeData?.coinCost ?? Infinity);

  useEffect(() => {
    if (selectedUpgrade && selectedUpgradeData) {
      if (!canAffordCoins && selectedUpgradeData.usdtCost) {
        setPaymentMethod("usdt");
      } else {
        setPaymentMethod(selectedUpgradeData.coinCost ? "coins" : "usdt");
      }
    }
  }, [selectedUpgrade, selectedUpgradeData, canAffordCoins]);

  const handlePurchase = () => {
    if (!selectedUpgrade) return;
    purchaseUpgrade.mutate({ upgradeId: selectedUpgrade, data: { paymentMethod } }, {
      onSuccess: (res) => {
        setSelectedUpgrade(null);
        setPurchaseResult({
          usdtAddress: res.usdtAddress,
          paymentTag: res.paymentTag,
          message: res.message,
          usdtCost: selectedUpgradeData?.usdtCost,
          upgradeName: selectedUpgradeData?.name,
        });
        setHasSent(false);
        setResultOpen(true);
        queryClient.invalidateQueries({ queryKey: getGetUpgradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Purchase failed";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const handleMarkPaid = async () => {
    const paymentTag = purchaseResult?.paymentTag;
    if (!paymentTag) {
      setHasSent(true);
      return;
    }

    setMarkingPaid(true);
    try {
      await fetch("/api/upgrades/payments/mark-paid", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentTag }),
      });
    } catch {
    } finally {
      setHasSent(true);
      setMarkingPaid(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Upgrade Mining Rig</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Increase your mining power and earn more</p>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Your Coin Balance</p>
          <p className="text-2xl font-bold text-primary">{coinBalance.toFixed(2)} <span className="text-sm text-muted-foreground">coins</span></p>
        </div>
        <Cpu className="w-8 h-8 text-muted-foreground" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-36 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : isError ? (
        <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-6 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">Could not load upgrades</p>
          <p className="text-xs text-muted-foreground">Please try again.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {upgrades?.map(upgrade => (
            <div
              key={upgrade.id}
              className={`bg-card border rounded-2xl p-5 transition-all ${upgrade.owned ? "border-emerald-500/30" : "border-card-border"}`}
              data-testid={`upgrade-card-${upgrade.id}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{upgrade.name}</h3>
                    <Badge variant="secondary" className="text-xs">Tier {upgrade.tier}</Badge>
                    {upgrade.isAutoMining && <Badge className="text-xs bg-purple-500/20 text-purple-500 border-0">Auto</Badge>}
                    {upgrade.owned && <Badge className="text-xs bg-emerald-500/20 text-emerald-500 border-0">Active</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{upgrade.description}</p>

                  <div className="flex flex-wrap gap-3 mb-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      <span>+{upgrade.hashRateBoost} MH/s</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Zap className="w-3.5 h-3.5 text-accent" />
                      <span>+{upgrade.dailyCapBoost} daily cap</span>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-500">
                      ~${calcDailyUsdt(upgrade.hashRateBoost, upgrade.dailyCapBoost).toFixed(2)} USDT/day
                    </span>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="space-y-1">
                    {upgrade.coinCost && (
                      <p className="text-sm font-semibold">{upgrade.coinCost} coins</p>
                    )}
                    {upgrade.usdtCost && (
                      <p className="text-sm font-semibold text-accent">${upgrade.usdtCost} USDT</p>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedUpgrade(upgrade.id);
                        setPaymentMethod(upgrade.coinCost ? "coins" : "usdt");
                      }}
                      className="mt-2 gap-1.5"
                      variant={upgrade.owned ? "outline" : "default"}
                      data-testid={`button-upgrade-${upgrade.id}`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      {upgrade.owned ? "Upgrade Again" : "Upgrade"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Purchase Dialog */}
      <Dialog open={!!selectedUpgrade} onOpenChange={(open) => !open && setSelectedUpgrade(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase Upgrade</DialogTitle>
          </DialogHeader>
          {selectedUpgradeData && (
            <div className="space-y-4 pt-2">
              <div className="bg-muted rounded-xl p-4">
                <h3 className="font-semibold">{selectedUpgradeData.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{selectedUpgradeData.description}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {selectedUpgradeData.coinCost && (
                    <button
                      onClick={() => setPaymentMethod("coins")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "coins" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    >
                      <p className="text-sm font-semibold">{selectedUpgradeData.coinCost} coins</p>
                      <p className="text-xs text-muted-foreground">From your balance</p>
                    </button>
                  )}
                  {selectedUpgradeData.usdtCost && (
                    <button
                      onClick={() => setPaymentMethod("usdt")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "usdt" ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}
                    >
                      <p className="text-sm font-semibold text-accent">${selectedUpgradeData.usdtCost} USDT</p>
                      <p className="text-xs text-muted-foreground">USDT payment</p>
                    </button>
                  )}
                </div>
              </div>

              {paymentMethod === "coins" && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                  Your balance: <strong>{coinBalance.toFixed(2)} coins</strong>
                  {coinBalance < (selectedUpgradeData.coinCost ?? 0) && (
                    <span className="text-destructive ml-2">Insufficient balance</span>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                onClick={handlePurchase}
                disabled={purchaseUpgrade.isPending || (paymentMethod === "coins" && coinBalance < (selectedUpgradeData.coinCost ?? 0))}
                data-testid="button-confirm-purchase"
              >
                {purchaseUpgrade.isPending ? "Processing..." : `Purchase with ${paymentMethod === "coins" ? "Coins" : "USDT"}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* USDT Payment Result */}
      <Dialog open={resultOpen} onOpenChange={(open) => { setResultOpen(open); if (!open) setHasSent(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {purchaseResult?.usdtAddress
                ? hasSent
                  ? "Payment Submitted"
                  : "Complete Your Payment"
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
                    Your payment will be reviewed and your <strong>{purchaseResult?.upgradeName}</strong> upgrade will be activated once confirmed. You'll receive an email notification.
                  </p>
                </div>
                <Button className="w-full" onClick={() => setResultOpen(false)}>Got it</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{purchaseResult?.message} BEP20 (BSC) network.</p>
                {purchaseResult?.usdtAddress && (
                  <div className="space-y-3">
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
                          <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 font-mono font-bold text-primary text-sm">{purchaseResult.paymentTag}</div>
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
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
