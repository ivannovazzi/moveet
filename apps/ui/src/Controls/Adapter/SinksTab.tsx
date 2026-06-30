import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { HealthResponse, ConfigResponse } from "./adapterClient";
import ConfigForm from "./ConfigForm";

interface SinksTabProps {
  health: HealthResponse;
  config: ConfigResponse | null;
  loading: boolean;
  onAdd: (type: string, config?: Record<string, unknown>) => void;
  onRemove: (type: string) => void;
}

/** Render a (redacted) config value for the read-only summary line. */
function formatConfigValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function SinksTab({ health, config, loading, onAdd, onRemove }: SinksTabProps) {
  const [addingType, setAddingType] = useState("");
  const [editingType, setEditingType] = useState<string | null>(null);

  const activeSinks = health.sinks;
  const availableToAdd = health.availableSinks.filter(
    (s) => !activeSinks.some((a) => a.type === s.type)
  );
  const addPlugin = health.availableSinks.find((s) => s.type === addingType);

  return (
    <div className="flex flex-col gap-3">
      {activeSinks.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-border surface-raised p-3 shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Active sinks
            </span>
            <span className="text-sm text-muted-foreground">{activeSinks.length} connected</span>
          </div>
          <div className="flex flex-col gap-2">
            {activeSinks.map((sink) => {
              const schema =
                health.availableSinks.find((s) => s.type === sink.type)?.configSchema ?? [];
              const current = config?.sinkConfig[sink.type];
              const entries = current ? Object.entries(current) : [];
              const isEditing = editingType === sink.type;
              return (
                <div
                  key={sink.type}
                  className="flex flex-col gap-2 rounded-md border border-border bg-background/40 p-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "inline-block size-2.5 shrink-0 rounded-full",
                          sink.healthy ? "bg-status-ok" : "bg-status-error"
                        )}
                      />
                      <span className="truncate text-sm font-medium text-foreground">
                        {sink.type}
                      </span>
                    </div>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {sink.healthy ? "Healthy" : "Unhealthy"}
                    </span>
                    <div className="flex items-center gap-1">
                      {schema.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingType(isEditing ? null : sink.type)}
                          aria-label={`${isEditing ? "Cancel editing" : "Edit"} ${sink.type}`}
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onRemove(sink.type)}
                        aria-label={`Remove ${sink.type}`}
                      >
                        &times;
                      </Button>
                    </div>
                  </div>

                  {!isEditing && entries.length > 0 && (
                    <dl className="flex flex-col gap-1 text-sm">
                      {entries.map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <dt className="text-muted-foreground">{key}</dt>
                          <dd className="truncate text-foreground">{formatConfigValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {isEditing && schema.length > 0 && (
                    <ConfigForm
                      key={`edit-${sink.type}`}
                      fields={schema}
                      initial={current}
                      submitLabel="Save"
                      loading={loading}
                      onSubmit={(values) => {
                        onAdd(sink.type, values);
                        setEditingType(null);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      {activeSinks.length === 0 && (
        <section className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No active sinks
        </section>
      )}

      {availableToAdd.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-border surface-raised p-3 shadow-raised">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Add sink
            </span>
            <span className="text-xs text-muted-foreground">Attach another downstream target.</span>
          </div>
          <Select value={addingType} onValueChange={(key) => setAddingType(String(key))}>
            <SelectTrigger className="w-full" aria-label="Sink Type">
              <SelectValue placeholder="-- select type --" />
            </SelectTrigger>
            <SelectContent>
              {availableToAdd.map((s) => (
                <SelectItem key={s.type} value={s.type}>
                  {s.type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {addPlugin && addPlugin.configSchema.length > 0 && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Configuration
                </span>
                <span className="text-xs text-muted-foreground">
                  Enter the sink connection details.
                </span>
              </div>
              <ConfigForm
                key={addingType}
                fields={addPlugin.configSchema}
                initial={config?.sinkConfig[addingType]}
                submitLabel="Add"
                loading={loading}
                onSubmit={(values) => {
                  onAdd(addingType, values);
                  setAddingType("");
                }}
              />
            </>
          )}

          {addPlugin && addPlugin.configSchema.length === 0 && (
            <Button
              disabled={loading}
              onClick={() => {
                onAdd(addingType);
                setAddingType("");
              }}
            >
              {loading ? "Adding..." : "Add sink"}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
