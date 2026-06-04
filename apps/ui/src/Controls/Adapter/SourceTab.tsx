import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import ConfigForm from "./ConfigForm";

interface SourceTabProps {
  health: HealthResponse;
  config: ConfigResponse | null;
  loading: boolean;
  onConnect: (type: string, config?: Record<string, unknown>) => void;
}

export default function SourceTab({ health, config, loading, onConnect }: SourceTabProps) {
  const [selectedType, setSelectedType] = useState<string>(health.source?.type ?? "");

  const plugin = health.availableSources.find((s) => s.type === selectedType);
  const currentConfig =
    config && selectedType === config.activeSource ? config.sourceConfig[selectedType] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Active source
          </span>
          <span className="text-sm text-muted-foreground">
            {health.source?.healthy ? "Healthy" : health.source ? "Unhealthy" : "Not configured"}
          </span>
        </div>
        <div className="text-sm text-foreground">
          {health.source?.type ?? "No source connected"}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Source Type</span>
          <span className="text-xs text-muted-foreground">Select the upstream vehicle feed.</span>
          <Select value={selectedType} onValueChange={(key) => setSelectedType(String(key))}>
            <SelectTrigger className="w-full" aria-label="Source Type">
              <SelectValue placeholder="-- select --" />
            </SelectTrigger>
            <SelectContent>
              {health.availableSources.map((s) => (
                <SelectItem key={s.type} value={s.type}>
                  {s.type}
                  {health.source?.type === s.type ? " (active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </section>

      {plugin && plugin.configSchema.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Configuration
            </span>
            <span className="text-xs text-muted-foreground">
              Review and save the source settings.
            </span>
          </div>
          <ConfigForm
            key={selectedType}
            fields={plugin.configSchema}
            initial={currentConfig}
            submitLabel="Connect"
            loading={loading}
            onSubmit={(values) => onConnect(selectedType, values)}
          />
        </section>
      )}

      {plugin && plugin.configSchema.length === 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <Button disabled={loading || !selectedType} onClick={() => onConnect(selectedType)}>
            {loading ? "Connecting..." : "Connect source"}
          </Button>
        </section>
      )}

      {!plugin && (
        <section className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          Choose a source type to view and edit its configuration.
        </section>
      )}
    </div>
  );
}
