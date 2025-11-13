"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // Refresh page to re-render as logged-out
    window.location.reload();
  }

  return (
    <Button variant="outline" onClick={logout} disabled={loading}>
      {loading ? "Logging out..." : "Logout"}
    </Button>
  );
}
