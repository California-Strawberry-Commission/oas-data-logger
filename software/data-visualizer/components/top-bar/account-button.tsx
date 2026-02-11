"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { LogOut, User } from "lucide-react";
import { useState } from "react";

export default function AccountButton({ email }: { email: string }) {
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // Refresh page to re-render as logged-out
    window.location.reload();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <User className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="text-sm font-medium truncate">{email}</div>
            </div>
          </div>

          <Separator />

          <Button
            variant="destructive"
            onClick={logout}
            disabled={loading}
            className="w-full justify-start gap-2"
          >
            <LogOut className="h-4 w-4" />
            {loading ? "Logging out..." : "Logout"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
