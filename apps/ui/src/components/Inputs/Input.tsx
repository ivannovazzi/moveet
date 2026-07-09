import { Input as UIInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InputProps
  extends Omit<React.ComponentProps<typeof UIInput>, "onChange" | "value" | "type"> {
  label?: string;
  value?: string | number;
  onChange?: (value: string) => void;
  /** Input type — defaults to "number". Pass "text" to render as textbox. */
  type?: React.HTMLInputTypeAttribute;
}

export function Input({ label, value, onChange, type = "number", ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      {label && <Label>{label}</Label>}
      <UIInput
        type={type}
        value={String(value ?? "")}
        onChange={(e) => onChange?.(e.target.value)}
        {...props}
      />
    </div>
  );
}
