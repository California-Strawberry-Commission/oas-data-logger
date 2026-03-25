"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

export default function PostHogIdentify({ email }: { email: string }) {
  useEffect(() => {
    posthog.identify(email);
  }, [email]);

  return null;
}
