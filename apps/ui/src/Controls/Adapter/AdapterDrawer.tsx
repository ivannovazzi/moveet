import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import SourceTab from "./SourceTab";
import SinksTab from "./SinksTab";
import RealismTab from "./RealismTab";

type Tab = "source" | "sinks" | "realism";

interface AdapterDrawerProps {
  isOpen: boolean;
  health: HealthResponse | null;
  config: ConfigResponse | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSetSource: (type: string, config?: Record<string, unknown>) => void;
  onAddSink: (type: string, config?: Record<string, unknown>) => void;
  onRemoveSink: (type: string) => void;
  onSetRealism: (config: Record<string, unknown>) => void;
}

const statusToneClass: Record<string, string> = {
  Healthy: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  "Needs attention": "border-status-warn/30 bg-status-warn/10 text-status-warn",
  neutral: "border-border bg-muted text-foreground",
};

export default function AdapterDrawer({
  isOpen,
  health,
  config,
  loading,
  error,
  onClose,
  onSetSource,
  onAddSink,
  onRemoveSink,
  onSetRealism,
}: AdapterDrawerProps) {
  const [tab, setTab] = useState<Tab>("source");
  const drawerStatus = !health
    ? "Unreachable"
    : !health.source && health.sinks.length === 0
      ? "Unconfigured"
      : health.source?.healthy !== false && health.sinks.every((sink) => sink.healthy)
        ? "Healthy"
        : "Needs attention";

  const badgeTone =
    drawerStatus === "Healthy"
      ? statusToneClass.Healthy
      : drawerStatus === "Needs attention"
        ? statusToneClass["Needs attention"]
        : statusToneClass.neutral;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" aria-busy={loading} className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Adapter control
          </div>
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="text-lg">Connections</SheetTitle>
            <span
              className={cn(
                "inline-flex h-5 items-center justify-center rounded-full border px-2 text-xs font-semibold",
                badgeTone
              )}
            >
              {drawerStatus}
            </span>
          </div>
          <SheetDescription>Configure upstream source and downstream sinks.</SheetDescription>
        </SheetHeader>

        {loading && <div className="h-0.5 w-full animate-pulse bg-accent" aria-hidden="true" />}

        {error && (
          <div className="mx-4 rounded-md border border-status-error/40 bg-status-error/10 p-2 text-sm text-status-error">
            {error}
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          className="min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4"
        >
          <TabsList className="w-full">
            <TabsTrigger value="source">Source</TabsTrigger>
            <TabsTrigger value="sinks">Sinks ({health?.sinks.length ?? 0})</TabsTrigger>
            <TabsTrigger
              value="realism"
              aria-label={`Realism${config?.realism?.status.enabled ? " (active)" : ""}`}
            >
              Realism
              {config?.realism?.status.enabled ? <span aria-hidden="true"> ●</span> : null}
            </TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !config ? (
              <div className="flex flex-col gap-2">
                <div className="h-16 animate-pulse rounded-md bg-muted" />
                <div className="h-16 animate-pulse rounded-md bg-muted" />
                <div className="h-16 animate-pulse rounded-md bg-muted" />
              </div>
            ) : !health ? (
              <section className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
                Adapter service is unreachable. Check the connection settings and try again.
              </section>
            ) : (
              <>
                <TabsContent value="source">
                  <SourceTab
                    health={health}
                    config={config}
                    loading={loading}
                    onConnect={onSetSource}
                  />
                </TabsContent>
                <TabsContent value="sinks">
                  <SinksTab
                    health={health}
                    config={config}
                    loading={loading}
                    onAdd={onAddSink}
                    onRemove={onRemoveSink}
                  />
                </TabsContent>
                <TabsContent value="realism">
                  <RealismTab config={config} loading={loading} onSetRealism={onSetRealism} />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
