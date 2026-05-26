"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyScanRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/warehouse");
  }, [router]);
  return null;
}
