import { Fragment, useState } from "react";
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

/** One-line monospace digest of a sink's config for the row's secondary line. */
function summarize(current: Record<string, unknown> | undefined): string {
  if (!current) return "no config";
  const entries = Object.entries(current);
  if (entries.length === 0) return "no config";
  return entries.map(([k, v]) => `${k}=${formatConfigValue(v)}`).join(" · ");
}

export default function SinksTab({ health, config, loading, onAdd, onRemove }: SinksTabProps) {
  const [addingType, setAddingType] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingType, setEditingType] = useState<string | null>(null);

  const activeSinks = health.sinks;
  const availableToAdd = health.availableSinks.filter(
    (s) => !activeSinks.some((a) => a.type === s.type)
  );
  const addPlugin = health.availableSinks.find((s) => s.type === addingType);

  return (
    <div>
      <LList>
        {activeSinks.length === 0 && (
          <LRow
            tone="idle"
            primary="No active sinks"
            secondary="attach a downstream target below"
          />
        )}

        {activeSinks.map((sink) => {
          const schema =
            health.availableSinks.find((s) => s.type === sink.type)?.configSchema ?? [];
          const current = config?.sinkConfig[sink.type];
          const isEditing = editingType === sink.type;
          const tone = sink.healthy ? "ok" : "error";
          return (
            <Fragment key={sink.type}>
              <LRow
                tone={tone}
                primary={sink.type}
                secondary={summarize(current)}
                meta={
                  <>
                    <Tag tone={tone}>{sink.healthy ? "OK" : "Down"}</Tag>
                    {schema.length > 0 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setEditingType(isEditing ? null : sink.type)}
                        aria-label={`${isEditing ? "Cancel editing" : "Edit"} ${sink.type}`}
                      >
                        {isEditing ? "Cancel" : "Edit"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onRemove(sink.type)}
                      aria-label={`Remove ${sink.type}`}
                    >
                      &times;
                    </Button>
                  </>
                }
              />
              {isEditing && schema.length > 0 && (
                <div className="px-2 pb-2.5 pl-[calc(3px+0.625rem)]">
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
                </div>
              )}
            </Fragment>
          );
        })}

        {availableToAdd.length > 0 &&
          (showAdd ? null : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="grid grid-cols-[3px_1fr] items-center gap-2.5 border-t border-border-soft px-2 py-[9px] text-left opacity-70 transition-opacity hover:opacity-100"
            >
              <span className="h-[26px] w-[3px] rounded-[2px] bg-border" />
              <span className="text-[12px] font-medium text-muted-foreground">+ Add sink…</span>
            </button>
          ))}
      </LList>

      {availableToAdd.length > 0 && showAdd && (
        <div className="flex flex-col gap-2.5 px-[15px] pb-4 pt-1">
          <div className="flex items-center justify-between">
            <Eyebrow>Add sink</Eyebrow>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setShowAdd(false);
                setAddingType("");
              }}
            >
              Cancel
            </Button>
          </div>
          <Select value={addingType} onValueChange={(key) => setAddingType(String(key))}>
            <SelectTrigger className="h-8 w-full" aria-label="Sink Type">
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
            <ConfigForm
              key={addingType}
              fields={addPlugin.configSchema}
              initial={config?.sinkConfig[addingType]}
              submitLabel="Add"
              loading={loading}
              onSubmit={(values) => {
                onAdd(addingType, values);
                setAddingType("");
                setShowAdd(false);
              }}
            />
          )}

          {addPlugin && addPlugin.configSchema.length === 0 && (
            <Button
              size="sm"
              disabled={loading}
              onClick={() => {
                onAdd(addingType);
                setAddingType("");
                setShowAdd(false);
              }}
            >
              {loading ? "Adding…" : "Add sink"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
