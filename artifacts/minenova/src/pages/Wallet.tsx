import { useState } from "react";
import { useGetWallet, useRequestWithdrawal, useGetTransactions, getGetWalletQueryKey, getGetTransactionsQueryKey } from "@workspace/api-client-react";
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
import { Wallet, ArrowUpRight, Clock, CheckCircle2, XCircle, Copy, AlertCircle } from "lucide-react";

const withdrawSchema = z.object({
  walletAddress: z.string().min(10, "Enter a valid USDT wallet address"),
  amount: z.coerce.number().min(5, "Minimum withdrawal is $5 USDT"),
});

type WithdrawForm = z.infer<typeof withdrawSchema>;

interface WithdrawalResult {
  usdtAddress: string;
  paymentTag: string;
  amount: number;
  transactionId: number;
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

export default function WalletPage() {
  const { data: wallet, isLoading: walletLoading } = useGetWallet();
  const { data: transactions, isLoading: txLoading } = useGetTransactions();
  const requestWithdrawal = useRequestWithdrawal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<WithdrawalResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);

  const form = useForm<WithdrawForm>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: { walletAddress: "", amount: 5 },
  });

  const onWithdraw = (data: WithdrawForm) => {
    requestWithdrawal.mutate({ data }, {
      onSuccess: (res) => {
        setWithdrawOpen(false);
        setWithdrawalResult({ usdtAddress: res.usdtAddress, paymentTag: res.paymentTag, amount: res.amount, transactionId: res.transactionId });
        setResultOpen(true);
        form.reset();
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

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Wallet</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your earnings and withdrawals</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Balance", value: wallet?.totalBalance?.toFixed(2) ?? "0.00", unit: "coins", color: "text-primary" },
          { label: "Withdrawable", value: wallet?.withdrawableBalance?.toFixed(2) ?? "0.00", unit: "coins", color: "text-emerald-500" },
          { label: "Pending", value: wallet?.pendingBalance?.toFixed(2) ?? "0.00", unit: "coins", color: "text-yellow-500" },
          { label: "Total Withdrawn", value: `$${wallet?.totalWithdrawn?.toFixed(2) ?? "0.00"}`, unit: "USDT", color: "text-muted-foreground" },
        ].map(({ label, value, unit, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{unit}</p>
          </div>
        ))}
      </div>

      {/* Withdrawal Info */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              USDT Withdrawal
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Minimum withdrawal: ${wallet?.minimumWithdrawal ?? 5} USDT (100 coins = $1 USDT)</p>
          </div>
          <Button
            onClick={() => setWithdrawOpen(true)}
            disabled={walletLoading || (wallet?.withdrawableBalance ?? 0) < 500}
            className="gap-2"
            data-testid="button-withdraw"
          >
            <ArrowUpRight className="w-4 h-4" />
            Withdraw
          </Button>
        </div>

        {(wallet?.withdrawableBalance ?? 0) < 500 && !walletLoading && (
          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              You need at least 500 coins to withdraw $5 USDT. Keep mining to reach the minimum!
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

      {/* Withdraw Dialog */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpRight className="w-5 h-5 text-primary" />
              Withdraw USDT
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onWithdraw)} className="space-y-4 pt-2">
              <FormField
                control={form.control}
                name="walletAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your USDT Wallet Address</FormLabel>
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
                      <Input type="number" min="5" step="0.5" placeholder="Min $5" data-testid="input-amount" {...field} />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">Requires {(form.watch("amount") || 5) * 100} coins</p>
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={requestWithdrawal.isPending} data-testid="button-confirm-withdraw">
                {requestWithdrawal.isPending ? "Processing..." : "Submit Withdrawal"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Withdrawal Instructions Dialog */}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-emerald-500">Withdrawal Request Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              To complete your withdrawal of <strong>${withdrawalResult?.amount} USDT</strong>, send exactly that amount to the address below with your unique payment tag.
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">USDT Address (TRC20)</p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono break-all">
                    {withdrawalResult?.usdtAddress}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(withdrawalResult?.usdtAddress ?? "", "USDT address")}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Payment Tag (Required)</p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-sm font-mono font-bold text-primary">
                    {withdrawalResult?.paymentTag}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(withdrawalResult?.paymentTag ?? "", "Payment tag")}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
              <p className="text-xs text-yellow-600 dark:text-yellow-400">
                Important: Always include your payment tag in the transaction memo/note. Without it, we cannot identify your payment and process your withdrawal.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
