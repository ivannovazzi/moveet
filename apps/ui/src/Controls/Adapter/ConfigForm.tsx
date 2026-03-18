import { useState } from "react";
import {
  TextField,
  Input as AriaInput,
  Select,
  SelectValue,
  Button,
  Popover,
  ListBox,
  ListBoxItem,
} from "react-aria-components";
import { Switch } from "@/components/Inputs";
import type { ConfigField } from "./adapterClient";
import styles from "./AdapterDrawer.module.css";

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
    <form className={styles.configForm} onSubmit={handleSubmit}>
      {fields.map((field) => (
        <label key={field.name} className={styles.field}>
          <span className={styles.fieldLabel}>
            {field.label}
            {field.required && <span className={styles.required}>*</span>}
          </span>
          {field.placeholder && <span className={styles.fieldHint}>{field.placeholder}</span>}
          {renderInput(field, values[field.name], set)}
        </label>
      ))}
      {jsonError && <div className={styles.inlineError}>{jsonError}</div>}
      <button type="submit" className={styles.submitBtn} disabled={loading}>
        {loading ? `${submitLabel}…` : submitLabel}
      </button>
    </form>
  );
}

function renderInput(
  field: ConfigField,
  value: unknown,
  set: (name: string, value: unknown) => void
) {
  const cls = styles.input;
  switch (field.type) {
    case "boolean":
      return (
        <span className={styles.switchField}>
          <span className={styles.switchLabel}>{value === true ? "Enabled" : "Disabled"}</span>
          <Switch isSelected={Boolean(value)} onChange={(selected) => set(field.name, selected)} />
        </span>
      );
    case "number":
      return (
        <TextField
          value={String(value as number)}
          onChange={(val) => set(field.name, Number(val))}
          aria-label={field.label}
        >
          <AriaInput
            type="number"
            className={cls}
            placeholder={field.placeholder}
            required={field.required}
          />
        </TextField>
      );
    case "password":
      return (
        <TextField
          value={value as string}
          onChange={(val) => set(field.name, val)}
          aria-label={field.label}
        >
          <AriaInput
            type="password"
            className={cls}
            placeholder={field.placeholder}
            required={field.required}
          />
        </TextField>
      );
    case "select":
      return (
        <Select
          selectedKey={value as string}
          onSelectionChange={(key) => set(field.name, String(key))}
          className={styles.selectRoot}
          aria-label={field.label}
        >
          <Button className={styles.selectTrigger}>
            <SelectValue className={styles.selectValue}>
              {({ selectedText }) => selectedText || "--"}
            </SelectValue>
            <span aria-hidden className={styles.selectChevron}>▾</span>
          </Button>
          <Popover className={styles.selectPopover}>
            <ListBox className={styles.selectListBox}>
              <ListBoxItem id="" textValue="--" className={styles.selectItem}>
                --
              </ListBoxItem>
              {field.options?.map((o) => (
                <ListBoxItem
                  key={o.value}
                  id={o.value}
                  textValue={o.label}
                  className={styles.selectItem}
                >
                  {o.label}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
      );
    case "json":
      return (
        <textarea
          className={`${cls} ${styles.textarea}`}
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
        <TextField
          value={value as string}
          onChange={(val) => set(field.name, val)}
          aria-label={field.label}
        >
          <AriaInput
            type="text"
            className={cls}
            placeholder={field.placeholder}
            required={field.required}
          />
        </TextField>
      );
  }
}
