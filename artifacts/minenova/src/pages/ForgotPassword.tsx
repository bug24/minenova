import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Mail, CheckCircle } from "lucide-react";

export default function ForgotPassword() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      await fetch(`${base}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      toast({ variant: "destructive", title: "Something went wrong", description: "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <div className="inline-flex items-center gap-3 cursor-pointer">
              <img src="/logo.png" alt="MineNova" className="w-12 h-12 object-contain rounded-2xl" />
              <span className="text-2xl font-black font-serif">MineNova</span>
            </div>
          </Link>
          <h2 className="mt-6 text-2xl font-bold">Forgot password?</h2>
          <p className="text-muted-foreground mt-1">We'll send a reset link to your email</p>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-8 shadow-xl">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                </div>
              </div>
              <div>
                <h3 className="font-bold text-lg">Check your email</h3>
                <p className="text-muted-foreground text-sm mt-2">
                  If an account exists for <strong className="text-foreground">{email}</strong>, we've sent a password reset link. It expires in 1 hour.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Didn't get it? Check your spam folder or{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={() => setSent(false)}
                >
                  try again
                </button>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="email">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 font-semibold" disabled={loading || !email.trim()}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link href="/login">
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Back to login
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
