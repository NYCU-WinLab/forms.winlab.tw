"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyLinkButton({ formId }: { formId: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const url = `${window.location.origin}/form/${formId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <Button onClick={onCopy} variant="outline" size="sm">
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}
