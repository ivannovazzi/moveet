import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface RangeProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export function Range({ label, value, min = 0, max = 100, step = 1, onChange }: RangeProps) {
  return (
    <div className="flex w-full flex-col">
      <div className="mb-1 flex items-baseline justify-between">
        {label && <Label className="text-sm text-muted-foreground">{label}</Label>}
        <span className="min-w-[2.5ch] text-right text-sm font-medium tabular-nums text-foreground">
          {value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
