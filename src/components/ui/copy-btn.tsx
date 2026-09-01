import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export function CopyBtn({
  getText,
  className,
  tip,
}: {
  getText: () => string;
  className?: string;
  tip?: string;
}) {
  const [ok, setOk] = useState(false);
  const t = useT();
  return (
    <Button
      variant="quiet"
      className={cn("h-7 w-7 p-0", className)}
      tip={ok ? t("copied") : tip || t("copy")}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 900);
        });
      }}
    >
      {ok ? <Check className="ui-tick size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

export function CopyMini({ text, children }: { text: string; children?: ReactNode }) {
  const [ok, setOk] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className="h-6 rounded-sm px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 900);
        });
      }}
    >
      {ok ? <span className="ui-tick">{t("copied")}</span> : children ?? t("copy")}
    </button>
  );
}
