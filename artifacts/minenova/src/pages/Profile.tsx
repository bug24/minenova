import { useGetReferrals, useGetWallet, useGetMiningStatus } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link } from "wouter";
import { Camera, Sun, Moon, Wallet, Users, TrendingUp, LogOut, ExternalLink, Pickaxe, MessageCircle } from "lucide-react";
import { useLogout } from "@workspace/api-client-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import SupportChat from "@/components/SupportChat";

export default function Profile() {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { data: wallet } = useGetWallet();
  const { data: referrals } = useGetReferrals();
  const { data: miningStatus } = useGetMiningStatus();
  const logoutMutation = useLogout();
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleLogout = () => {
    logoutMutation.mutate();
    logout();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast({ variant: "destructive", title: "Unsupported file type", description: "Only JPEG and PNG images are allowed." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "File size must not exceed 5 MB." });
      return;
    }

    const token = localStorage.getItem("minenova_token");
    if (!token) return;

    setUploading(true);

    try {
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });

      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error || "Failed to get upload URL");
      }

      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!putRes.ok) throw new Error("Failed to upload image");

      const patchRes = await fetch("/api/users/me/avatar", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ objectPath }),
      });

      if (!patchRes.ok) throw new Error("Failed to save avatar");

      const avatarUrl = `/api/storage${objectPath}`;
      updateUser({ avatarUrl });
      toast({ title: "Avatar updated!", description: "Your profile picture has been saved." });
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setUploading(false);
      const inp = document.getElementById("avatar-input") as HTMLInputElement | null;
      if (inp) inp.value = "";
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Profile</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Your account and settings</p>
      </div>

      {/* User Card */}
      <div className="bg-card border border-card-border rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center overflow-hidden">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-black text-primary">{user?.username?.[0]?.toUpperCase()}</span>
              )}
              {uploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {!uploading && (
              <label
                htmlFor="avatar-input"
                aria-label="Change avatar"
                className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-primary shadow-md flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors"
              >
                <Camera className="w-3.5 h-3.5 text-primary-foreground" />
              </label>
            )}
            <input
              id="avatar-input"
              type="file"
              accept=".jpg,.jpeg,.png"
              className="sr-only"
              disabled={uploading}
              onChange={handleAvatarChange}
            />
          </div>
          <div>
            <h2 className="text-xl font-bold">{user?.username}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Pickaxe className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">
                {miningStatus?.upgradeName
                  ? `${miningStatus.upgradeName} · Tier ${miningStatus.upgradeTier}`
                  : `Mining Level ${user?.miningLevel}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { icon: TrendingUp, label: "Total Earned", value: `${(user?.totalEarned ?? 0).toFixed(2)} coins`, color: "text-primary" },
          { icon: Users, label: "Referrals", value: String(referrals?.totalReferrals ?? 0), color: "text-purple-500" },
          { icon: Wallet, label: "Withdrawn", value: `$${(wallet?.totalWithdrawn ?? 0).toFixed(2)}`, color: "text-emerald-500" },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 text-center">
            <Icon className={`w-5 h-5 ${color} mx-auto mb-2`} />
            <p className={`font-bold text-sm ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Referral Code */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold mb-1">Your Referral Code</h3>
        <p className="text-xs text-muted-foreground mb-3">Share this code to earn referral bonuses</p>
        <code className="bg-muted px-4 py-2 rounded-lg text-lg font-bold font-mono text-primary block text-center tracking-widest">
          {user?.referralCode}
        </code>
        <Link href="/referrals">
          <Button variant="outline" size="sm" className="w-full mt-3 gap-2">
            <ExternalLink className="w-3.5 h-3.5" />
            View Referral Details
          </Button>
        </Link>
      </div>

      {/* Settings */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-semibold">Settings</h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {theme === "dark" ? <Moon className="w-4 h-4 text-muted-foreground" /> : <Sun className="w-4 h-4 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted-foreground">{theme === "dark" ? "Dark mode" : "Light mode"}</p>
            </div>
          </div>
          <Switch
            checked={theme === "dark"}
            onCheckedChange={toggleTheme}
            data-testid="switch-theme"
          />
        </div>
      </div>

      {/* Links */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-2">
        <h3 className="font-semibold mb-3">Quick Links</h3>
        <Link href="/wallet">
          <Button variant="ghost" className="w-full justify-start gap-3 h-10">
            <Wallet className="w-4 h-4 text-primary" />
            Transaction History
          </Button>
        </Link>
        <Link href="/referrals">
          <Button variant="ghost" className="w-full justify-start gap-3 h-10">
            <Users className="w-4 h-4 text-purple-500" />
            My Referrals
          </Button>
        </Link>
        <Link href="/upgrades">
          <Button variant="ghost" className="w-full justify-start gap-3 h-10">
            <TrendingUp className="w-4 h-4 text-accent" />
            Upgrade Mining Rig
          </Button>
        </Link>
      </div>

      {/* Support */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold mb-1">Need Help?</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Contact admin directly — attach screenshots or proof of payment if needed.
        </p>
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>("[data-testid='button-support-chat-open']");
            btn?.click();
          }}
          className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary rounded-xl py-2.5 text-sm font-medium transition-colors"
          data-testid="button-contact-support"
        >
          <MessageCircle className="w-4 h-4" />
          Chat with Support
        </button>
      </div>

      {/* Account Info */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h3 className="font-semibold">Account Info</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "..."}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">User ID</span>
            <span className="font-medium font-mono">#{user?.id}</span>
          </div>
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
        onClick={handleLogout}
        data-testid="button-profile-logout"
      >
        <LogOut className="w-4 h-4" />
        Logout
      </Button>

      <SupportChat />
    </div>
  );
}
