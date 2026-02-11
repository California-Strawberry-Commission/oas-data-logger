"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function AdminButton() {
  const router = useRouter();

  return (
    <Button variant="outline" onClick={() => router.push("/admin")}>
      Admin
    </Button>
  );
}
