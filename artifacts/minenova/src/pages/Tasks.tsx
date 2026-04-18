import { useState } from "react";
import { useGetTasks, useCompleteTask, getGetTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Play, Share2, Twitter, Facebook, MessageCircle, Gift, LogIn, Coins, Link2 } from "lucide-react";

function getTaskIcon(taskType: string) {
  if (taskType === "share_twitter") return <Twitter className="w-5 h-5 text-sky-400" />;
  if (taskType === "share_facebook") return <Facebook className="w-5 h-5 text-blue-600" />;
  if (taskType === "share_whatsapp") return <MessageCircle className="w-5 h-5 text-emerald-500" />;
  if (taskType === "daily_login") return <LogIn className="w-5 h-5 text-primary" />;
  if (taskType === "watch_video") return <Play className="w-5 h-5 text-rose-500" />;
  if (taskType === "invite_friend") return <Gift className="w-5 h-5 text-accent" />;
  return <Coins className="w-5 h-5 text-muted-foreground" />;
}

function buildShareIntentUrl(taskType: string, shareUrl: string | null | undefined, shareText: string | null | undefined) {
  if (!shareUrl) return null;
  const text = shareText ?? "";
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(shareUrl);
  if (taskType === "share_twitter") return `https://twitter.com/intent/tweet?text=${encodedText}`;
  if (taskType === "share_facebook") return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
  if (taskType === "share_whatsapp") return `https://api.whatsapp.com/send?text=${encodedText}`;
  return null;
}

export default function Tasks() {
  const { data: tasks, isLoading, isError, refetch } = useGetTasks();
  const completeTask = useCompleteTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingConfirmId, setPendingConfirmId] = useState<number | null>(null);
  const [invitingId, setInvitingId] = useState<number | null>(null);

  const handleShare = (taskId: number, taskType: string, shareUrl?: string | null, shareText?: string | null) => {
    const url = buildShareIntentUrl(taskType, shareUrl, shareText);
    if (url) {
      window.open(url, "_blank");
      setPendingConfirmId(taskId);
    }
  };

  const handleInviteShare = async (taskId: number, shareUrl: string, shareText: string | null | undefined) => {
    setInvitingId(taskId);
    const shareData = {
      title: "Join me on MineNova!",
      text: shareText ?? `Earn free crypto daily — no hardware needed! Join using my referral link:`,
      url: shareUrl,
    };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        setPendingConfirmId(taskId);
      } catch {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast({ title: "Link copied!", description: "Your referral link was copied. Share it with friends and confirm to claim your coins!" });
        } catch {
          toast({ title: "Your referral link", description: shareUrl });
        }
        setPendingConfirmId(taskId);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast({ title: "Link copied!", description: "Share your referral link with friends and confirm below to earn coins!" });
      } catch {
        toast({ title: "Your referral link", description: shareUrl });
      }
      setPendingConfirmId(taskId);
    }
    setInvitingId(null);
  };

  const handleConfirmShare = (taskId: number) => {
    completeTask.mutate({ taskId }, {
      onSuccess: (res) => {
        toast({ title: "Coins earned!", description: `+${res.coinsEarned} coins added to your balance.` });
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        setPendingConfirmId(null);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not complete task";
        toast({ variant: "destructive", title: "Error", description: msg });
        setPendingConfirmId(null);
      },
    });
  };

  const handleNonShareComplete = (taskId: number) => {
    completeTask.mutate({ taskId }, {
      onSuccess: (res) => {
        toast({ title: "Task completed!", description: `Earned ${res.coinsEarned} coins.` });
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
      ) : isError ? (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 text-center space-y-3">
          <p className="text-sm font-medium text-destructive">Could not load tasks</p>
          <p className="text-xs text-muted-foreground">Please try again.</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : !tasks?.length ? (
        <div className="bg-card border border-card-border rounded-xl p-8 text-center">
          <p className="text-sm font-medium mb-1">No tasks available right now</p>
          <p className="text-xs text-muted-foreground">Check back soon — new tasks are added daily!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const isShareTask = task.taskType.startsWith("share_");
            const isInviteTask = task.taskType === "invite_friend";
            const isPendingConfirm = pendingConfirmId === task.id;
            const isInviting = invitingId === task.id;
            return (
              <div
                key={task.id}
                className={`bg-card border rounded-xl p-4 transition-all ${task.completedToday ? "opacity-60 border-border" : isPendingConfirm ? "border-primary/40 bg-primary/5" : "border-card-border"}`}
                data-testid={`task-card-${task.id}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${task.completedToday ? "bg-muted" : "bg-muted/50"}`}>
                    {task.completedToday ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : getTaskIcon(task.taskType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{task.title}</p>
                      {task.completedToday && <Badge variant="secondary" className="text-xs text-emerald-500">Done</Badge>}
                      {isShareTask && !task.completedToday && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Share2 className="w-2.5 h-2.5" /> Share
                        </Badge>
                      )}
                      {isInviteTask && !task.completedToday && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Link2 className="w-2.5 h-2.5" /> Invite
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>

                    {isPendingConfirm && (
                      <div className="mt-3 bg-primary/10 border border-primary/20 rounded-xl p-3">
                        <p className="text-xs text-primary font-medium mb-2">
                          {isInviteTask
                            ? "Did you share your referral link? Confirm to claim your coins!"
                            : "Did you complete the share? Confirm to claim your coins!"}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="gap-1.5 h-7 text-xs flex-1"
                            onClick={() => handleConfirmShare(task.id)}
                            disabled={completeTask.isPending}
                            data-testid={`button-confirm-share-${task.id}`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            I shared it! Claim +{task.reward} coins
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-muted-foreground"
                            onClick={() => setPendingConfirmId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-primary">+{task.reward}</p>
                    <p className="text-xs text-muted-foreground">coins</p>
                    {!task.completedToday && !isPendingConfirm && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        onClick={() => {
                          if (isInviteTask && task.shareUrl) {
                            handleInviteShare(task.id, task.shareUrl, task.shareText);
                          } else if (isShareTask) {
                            handleShare(task.id, task.taskType, task.shareUrl, task.shareText);
                          } else {
                            handleNonShareComplete(task.id);
                          }
                        }}
                        disabled={completeTask.isPending || isInviting}
                        data-testid={`button-complete-task-${task.id}`}
                      >
                        {isInviting ? "Sharing…" : isInviteTask ? "Invite" : isShareTask ? "Share" : "Complete"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <p className="text-sm font-medium text-primary mb-1">Pro Tip</p>
        <p className="text-xs text-muted-foreground">
          Share your referral link on all 3 social platforms to earn bonus coins daily.
          A unique message with your referral link is automatically included each time you share.
        </p>
      </div>
    </div>
  );
}
