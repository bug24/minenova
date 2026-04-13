import { useState } from "react";
import { useGetUpgrades, usePurchaseUpgrade, getGetUpgradesQueryKey, useGetWallet, getGetWalletQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Copy, Cpu } from "lucide-react";

interface PurchaseResult {
  usdtAddress: string | null | undefined;
  paymentTag: string | null | undefined;
  message: string;
  usdtCost?: number | null;
}

const BADGE_STYLES: Record<string, string> = {
  Popular: "bg-purple-600 text-white",
  "Best Value": "bg-pink-600 text-white",
  Elite: "bg-emerald-600 text-white",
  USDT: "bg-amber-500 text-white",
  Auto: "bg-blue-600 text-white",
};

function getBuyButtonClass(tier: number): string {
  if (tier <= 2) return "from-blue-500 to-cyan-400";
  if (tier <= 4) return "from-orange-500 to-amber-400";
  return "from-emerald-500 to-teal-400";
}

export default function Upgrades() {
  const { data: upgrades, isLoading, isError } = useGetUpgrades();
  const { data: wallet } = useGetWallet();
  const purchaseUpgrade = usePurchaseUpgrade();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedUpgrade, setSelectedUpgrade] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"coins" | "usdt">("coins");
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [hasSent, setHasSent] = useState(false);

  const handlePurchase = () => {
    if (!selectedUpgrade) return;
    purchaseUpgrade.mutate({ upgradeId: selectedUpgrade, data: { paymentMethod } }, {
      onSuccess: (res) => {
        setSelectedUpgrade(null);
        setPurchaseResult({ usdtAddress: res.usdtAddress, paymentTag: res.paymentTag, message: res.message, usdtCost: selectedUpgradeData?.usdtCost });
        setHasSent(false);
        setResultOpen(true);
        queryClient.invalidateQueries({ queryKey: getGetUpgradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Purchase failed";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const selectedUpgradeData = upgrades?.find(u => u.id === selectedUpgrade);
  const coinBalance = wallet?.totalBalance ?? 0;

  const getBadgeLabel = (upgrade: NonNullable<typeof upgrades>[number]) => {
    if (upgrade.badge) return upgrade.badge;
    if (upgrade.isAutoMining) return "Auto";
    if (upgrade.usdtCost && !upgrade.coinCost) return "USDT";
    return null;
  };

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Upgrade Mining Rig</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Boost your speed and earn more coins per session</p>
      </div>

      <div className="bg-card border border-card-border rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Your Coin Balance</p>
          <p className="text-2xl font-bold text-primary">{coinBalance.toFixed(2)} <span className="text-sm text-muted-foreground font-normal">coins</span></p>
        </div>
        <Cpu className="w-8 h-8 text-muted-foreground" />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-6 text-center">
          <p className="text-sm font-medium text-destructive mb-1">Could not load upgrades</p>
          <p className="text-xs text-muted-foreground">Please refresh the page and try again.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {upgrades?.map(upgrade => {
            const badgeLabel = getBadgeLabel(upgrade);
            const buttonGradient = getBuyButtonClass(upgrade.tier);
            return (
              <div
                key={upgrade.id}
                className={`relative bg-card border rounded-2xl overflow-hidden transition-all ${upgrade.owned ? "border-emerald-500/40" : "border-card-border"}`}
                data-testid={`upgrade-card-${upgrade.id}`}
              >
                <div className="p-5 pb-4">
                  <div className="flex items-start gap-4">
                    <div className="text-3xl shrink-0 mt-0.5">{upgrade.icon ?? "⚡"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-bold text-base leading-tight">{upgrade.name}</h3>
                        {badgeLabel && (
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${BADGE_STYLES[badgeLabel] ?? "bg-primary text-white"}`}>
                            {badgeLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground leading-snug">{upgrade.description}</p>
                      <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="text-primary font-semibold">+{upgrade.hashRateBoost}%</span> speed
                        </span>
                        <span className="text-border">•</span>
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-foreground/80">{upgrade.dailyCapBoost}</span> daily cap
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {upgrade.owned ? (
                  <div className="mx-4 mb-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-semibold text-emerald-500">Active</span>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <button
                      onClick={() => {
                        setSelectedUpgrade(upgrade.id);
                        setPaymentMethod(upgrade.coinCost ? "coins" : "usdt");
                      }}
                      data-testid={`button-upgrade-${upgrade.id}`}
                      className={`w-full py-3 rounded-xl font-bold text-white text-sm bg-gradient-to-r ${buttonGradient} hover:opacity-90 active:scale-[0.98] transition-all shadow-md`}
                    >
                      {upgrade.coinCost
                        ? `Buy for ${upgrade.coinCost.toLocaleString()} coins`
                        : `Buy for $${upgrade.usdtCost} USDT`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {(!upgrades || upgrades.length === 0) && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No upgrade packages available yet.
            </div>
          )}
        </div>
      )}

      {/* Purchase Confirm Dialog */}
      <Dialog open={!!selectedUpgrade} onOpenChange={(open) => !open && setSelectedUpgrade(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Upgrade</DialogTitle>
          </DialogHeader>
          {selectedUpgradeData && (
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3 bg-muted rounded-xl p-4">
                <span className="text-3xl">{selectedUpgradeData.icon ?? "⚡"}</span>
                <div>
                  <h3 className="font-semibold">{selectedUpgradeData.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedUpgradeData.description}</p>
                </div>
              </div>

              {selectedUpgradeData.coinCost && selectedUpgradeData.usdtCost && (
                <div>
                  <p className="text-sm font-medium mb-2">Payment Method</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setPaymentMethod("coins")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "coins" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    >
                      <p className="text-sm font-semibold">{selectedUpgradeData.coinCost.toLocaleString()} coins</p>
                      <p className="text-xs text-muted-foreground">From balance</p>
                    </button>
                    <button
                      onClick={() => setPaymentMethod("usdt")}
                      className={`p-3 rounded-xl border text-left transition-all ${paymentMethod === "usdt" ? "border-amber-500 bg-amber-500/10" : "border-border hover:border-amber-500/50"}`}
                    >
                      <p className="text-sm font-semibold text-amber-500">${selectedUpgradeData.usdtCost} USDT</p>
                      <p className="text-xs text-muted-foreground">USDT payment</p>
                    </button>
                  </div>
                </div>
              )}

              {paymentMethod === "coins" && (
                <div className={`rounded-lg p-3 text-xs ${coinBalance < (selectedUpgradeData.coinCost ?? 0) ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-muted-foreground"}`}>
                  Your balance: <strong>{coinBalance.toFixed(2)} coins</strong>
                  {coinBalance < (selectedUpgradeData.coinCost ?? 0) && (
                    <span className="ml-2">— Insufficient balance</span>
                  )}
                </div>
              )}

              <Button
                className={`w-full bg-gradient-to-r ${getBuyButtonClass(selectedUpgradeData.tier)} border-0 text-white hover:opacity-90`}
                onClick={handlePurchase}
                disabled={purchaseUpgrade.isPending || (paymentMethod === "coins" && coinBalance < (selectedUpgradeData.coinCost ?? 0))}
                data-testid="button-confirm-purchase"
              >
                {purchaseUpgrade.isPending ? "Processing..." : (
                  paymentMethod === "coins"
                    ? `Buy for ${selectedUpgradeData.coinCost?.toLocaleString()} coins`
                    : `Buy for $${selectedUpgradeData.usdtCost} USDT`
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* USDT Payment Result */}
      <Dialog open={resultOpen} onOpenChange={(open) => { setResultOpen(open); if (!open) setHasSent(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{purchaseResult?.usdtAddress ? (hasSent ? "Payment Received" : "Complete Your Payment") : "Upgrade Activated!"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!purchaseResult?.usdtAddress ? (
              <div className="text-center py-4 space-y-3">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>
                <p className="font-semibold text-foreground">{purchaseResult?.message}</p>
                <Button className="w-full" onClick={() => setResultOpen(false)}>Done</Button>
              </div>
            ) : hasSent ? (
              <div className="space-y-4">
                <div className="text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                  </div>
                  <p className="font-semibold">Transfer Confirmed</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your upgrade is being processed. Allow 2–12 hours for activation.
                  </p>
                </div>
                <Button className="w-full" onClick={() => setResultOpen(false)}>Got it</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{purchaseResult?.message} TRC20 network.</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Send USDT to (TRC20)</p>
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
                  <Button className="w-full gap-2" onClick={() => setHasSent(true)}>
                    <CheckCircle2 className="w-4 h-4" />
                    I have sent ${purchaseResult.usdtCost} USDT
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
