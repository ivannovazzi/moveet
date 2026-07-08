import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eyebrow } from "@/Dock/DockPanelKit";
import { LList, LRow, Tag } from "@/Dock/SinksPanel";
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

  const sourceTone = !health.source ? "idle" : health.source.healthy ? "ok" : "error";
  const sourceTag = !health.source ? "None" : health.source.healthy ? "Live" : "Down";

  return (
    <div>
      <LList>
        <LRow
          tone={sourceTone}
          primary={health.source?.type ?? "No source connected"}
          secondary={`${health.availableSources.length} available · upstream feed`}
          meta={<Tag tone={sourceTone}>{sourceTag}</Tag>}
        />
      </LList>

      <div className="flex flex-col gap-2.5 px-[15px] pb-4 pt-1">
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Source type</Eyebrow>
          <Select value={selectedType} onValueChange={(key) => setSelectedType(String(key))}>
            <SelectTrigger className="h-8 w-full" aria-label="Source Type">
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

        {plugin && plugin.configSchema.length > 0 && (
          <ConfigForm
            key={selectedType}
            fields={plugin.configSchema}
            initial={currentConfig}
            submitLabel="Connect"
            loading={loading}
            onSubmit={(values) => onConnect(selectedType, values)}
          />
        )}

        {plugin && plugin.configSchema.length === 0 && (
          <Button
            size="sm"
            disabled={loading || !selectedType}
            onClick={() => onConnect(selectedType)}
          >
            {loading ? "Connecting…" : "Connect source"}
          </Button>
        )}

        {!plugin && (
          <p className="text-[11px] text-muted-foreground/60">
            Choose a source type to view its configuration.
          </p>
        )}
      </div>
    </div>
  );
}
