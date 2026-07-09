import type React from "react";
import { cn } from "@/lib/utils";

interface BlockProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}
export function Block({ children, className, ...props }: BlockProps) {
  return (
    <div
      {...props}
      className={cn("rounded-lg border border-border surface-raised p-3 shadow-raised", className)}
    >
      {children}
    </div>
  );
}

export function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground tabular-nums">{children}</span>
    </div>
  );
}
