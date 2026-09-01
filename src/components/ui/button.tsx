import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Tip, type TipSide } from "./tooltip";

type Variant = "primary" | "ghost" | "quiet" | "danger";

const styles: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50",
  ghost:
    "bg-transparent text-fg hover:bg-hover border border-border disabled:opacity-50",
  quiet: "bg-transparent text-muted hover:bg-hover hover:text-fg disabled:opacity-50",
  danger: "bg-transparent text-danger hover:bg-danger/10 disabled:opacity-50",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; tip?: string; kbd?: string; tipSide?: TipSide }
>(function Button({ className, variant = "ghost", type = "button", tip, kbd, tipSide, title, ...props }, ref) {
  const btn = (
    <button
      ref={ref}
      type={type}
      title={tip ? undefined : title}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium ui-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
  const label = tip || title;
  if (!label) return btn;
  return (
    <Tip label={label} kbd={kbd} side={tipSide ?? "bottom"}>
      {btn}
    </Tip>
  );
});
