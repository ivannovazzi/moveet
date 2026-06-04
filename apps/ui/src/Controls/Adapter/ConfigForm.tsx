import { useState } from "react";
import { Switch } from "@/components/Inputs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ConfigField } from "./adapterClient";

interface ConfigFormProps {
  fields: ConfigField[];
  initial?: Record<string, unknown>;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}

function getInitialValue(field: ConfigField, initial?: Record<string, unknown>): unknown {
  if (initial && field.name in initial) return initial[field.name];
  if (field.default !== undefined) return field.default;
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  return "";
}

export default function ConfigForm({
  fields,
  initial,
  submitLabel,
  loading,
  onSubmit,
}: ConfigFormProps) {
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) v[f.name] = getInitialValue(f, initial);
    return v;
  });

  const set = (name: string, value: unknown) => setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "json" && typeof values[f.name] === "string") {
        const str = values[f.name] as string;
        if (str.trim()) {
          try {
            parsed[f.name] = JSON.parse(str);
          } catch {
            setJsonError(`"${f.label}" contains invalid JSON`);
            return;
          }
        }
      } else {
        parsed[f.name] = values[f.name];
      }
    }
    setJsonError(null);
    onSubmit(parsed);
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">
            {field.label}
            {field.required && <span className="ml-0.5 text-status-error">*</span>}
          </span>
          {field.placeholder && (
            <span className="text-xs text-muted-foreground">{field.placeholder}</span>
          )}
          {renderInput(field, values[field.name], set)}
        </label>
      ))}
      {jsonError && <div className="text-sm text-status-error">{jsonError}</div>}
      <Button type="submit" disabled={loading}>
        {loading ? `${submitLabel}…` : submitLabel}
      </Button>
    </form>
  );
}

const inputCls = "h-9";

function renderInput(
  field: ConfigField,
  value: unknown,
  set: (name: string, value: unknown) => void
) {
  switch (field.type) {
    case "boolean":
      return (
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {value === true ? "Enabled" : "Disabled"}
          </span>
          <Switch isSelected={Boolean(value)} onChange={(selected) => set(field.name, selected)} />
        </span>
      );
    case "number":
      return (
        <Input
          type="number"
          className={inputCls}
          value={String(value as number)}
          placeholder={field.placeholder}
          required={field.required}
          aria-label={field.label}
          onChange={(e) => set(field.name, Number(e.target.value))}
        />
      );
    case "password":
      return (
        <Input
          type="password"
          className={inputCls}
          value={value as string}
          placeholder={field.placeholder}
          required={field.required}
          aria-label={field.label}
          onChange={(e) => set(field.name, e.target.value)}
        />
      );
    case "select":
      return (
        <Select
          value={(value as string) || ""}
          onValueChange={(key) => set(field.name, String(key))}
        >
          <SelectTrigger className="w-full" aria-label={field.label}>
            <SelectValue placeholder="--" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "json":
      return (
        <textarea
          className={cn(
            "min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
            "font-mono"
          )}
          value={
            typeof value === "string" ? value : value != null ? JSON.stringify(value, null, 2) : ""
          }
          placeholder={field.placeholder ?? "{}"}
          rows={3}
          onChange={(e) => set(field.name, e.target.value)}
        />
      );
    default:
      return (
        <Input
          type="text"
          className={inputCls}
          value={value as string}
          placeholder={field.placeholder}
          required={field.required}
          aria-label={field.label}
          onChange={(e) => set(field.name, e.target.value)}
        />
      );
  }
}
