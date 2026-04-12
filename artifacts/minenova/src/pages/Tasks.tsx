import { useGetTasks, useCompleteTask, getGetTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Play, Share2, Twitter, Facebook, MessageCircle, Gift, LogIn, Coins } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

function getTaskIcon(taskType: string) {
  if (taskType === "share_twitter") return <Twitter className="w-5 h-5 text-sky-400" />;
  if (taskType === "share_facebook") return <Facebook className="w-5 h-5 text-blue-600" />;
  if (taskType === "share_whatsapp") return <MessageCircle className="w-5 h-5 text-emerald-500" />;
  if (taskType === "daily_login") return <LogIn className="w-5 h-5 text-primary" />;
  if (taskType === "watch_video") return <Play className="w-5 h-5 text-rose-500" />;
  if (taskType === "invite_friend") return <Gift className="w-5 h-5 text-accent" />;
  return <Coins className="w-5 h-5 text-muted-foreground" />;
}

function getShareUrl(taskType: string, shareUrl: string | null | undefined, text: string) {
  if (!shareUrl) return null;
  const encoded = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(shareUrl);
  if (taskType === "share_twitter") return `https://twitter.com/intent/tweet?text=${encoded}&url=${encodedUrl}`;
  if (taskType === "share_facebook") return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  if (taskType === "share_whatsapp") return `https://api.whatsapp.com/send?text=${encoded}%20${encodedUrl}`;
  return null;
}

export default function Tasks() {
  const { data: tasks, isLoading } = useGetTasks();
  const completeTask = useCompleteTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const handleComplete = (taskId: number, taskType: string, shareUrl?: string | null) => {
    if (taskType.startsWith("share_")) {
      const shareText = `Join me on MineNova! Earn free crypto daily by mining. Use my referral code: ${user?.referralCode}`;
      const url = getShareUrl(taskType, shareUrl, shareText);
      if (url) window.open(url, "_blank");
    }

    completeTask.mutate({ taskId }, {
      onSuccess: (res) => {
        toast({ title: "Task completed!", description: `Earned ${res.coinsEarned} coins. Balance: ${res.newBalance.toFixed(2)}` });
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not complete task";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const completed = tasks?.filter(t => t.completedToday).length ?? 0;
  const total = tasks?.length ?? 0;
  const totalRewards = tasks?.reduce((sum, t) => sum + (t.completedToday ? 0 : t.reward), 0) ?? 0;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Daily Tasks</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Complete tasks to earn extra coins every day</p>
      </div>

      {/* Progress */}
      <div className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Today's Progress</p>
          <p className="text-2xl font-bold">{completed}<span className="text-muted-foreground text-lg">/{total}</span></p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Remaining Rewards</p>
          <p className="text-2xl font-bold text-primary">{totalRewards.toFixed(1)} <span className="text-sm text-muted-foreground">coins</span></p>
        </div>
      </div>

      {/* Tasks List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {tasks?.map(task => (
            <div
              key={task.id}
              className={`bg-card border rounded-xl p-4 flex items-center gap-4 transition-opacity ${task.completedToday ? "opacity-60 border-border" : "border-card-border"}`}
              data-testid={`task-card-${task.id}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${task.completedToday ? "bg-muted" : "bg-muted/50"}`}>
                {task.completedToday ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : getTaskIcon(task.taskType)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{task.title}</p>
                  {task.completedToday && <Badge variant="secondary" className="text-xs text-emerald-500">Done</Badge>}
                  {task.taskType.startsWith("share_") && !task.completedToday && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Share2 className="w-2.5 h-2.5" /> Share
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-primary">+{task.reward}</p>
                <p className="text-xs text-muted-foreground">coins</p>
                {!task.completedToday && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={() => handleComplete(task.id, task.taskType, task.shareUrl)}
                    disabled={completeTask.isPending}
                    data-testid={`button-complete-task-${task.id}`}
                  >
                    {task.taskType.startsWith("share_") ? "Share" : "Complete"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <p className="text-sm font-medium text-primary mb-1">Pro Tip</p>
        <p className="text-xs text-muted-foreground">
          Share your referral link on all 3 social platforms to earn 15 bonus coins daily.
          Your referral link is automatically included in the share message.
        </p>
      </div>
    </div>
  );
}
