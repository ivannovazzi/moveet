import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface TypeaheadItem<T> {
  key: string;
  label: string;
  option: T;
}

interface TypeaheadProps<T> {
  label?: string;
  "aria-label"?: string;
  value?: T | null;
  options: T[];
  renderOption?: (option: T) => ReactNode;
  renderLabel?: (option: T) => string;
  onChange: (option: T) => void;
  onOptionHover?: (option: T) => void;
  onOptionLeave?: () => void;
  className?: string;
  placeholder?: string;
}

export function Typeahead<T>({
  label,
  "aria-label": ariaLabel,
  options,
  renderLabel,
  renderOption,
  onChange,
  onOptionHover,
  onOptionLeave,
  className,
  placeholder,
}: TypeaheadProps<T>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const getLabel = useCallback(
    (option: T) => (renderLabel ? renderLabel(option) : String(option)),
    [renderLabel]
  );

  const items = useMemo<TypeaheadItem<T>[]>(
    () =>
      options.map((option, i) => ({
        key: `${getLabel(option)}-${i}`,
        label: getLabel(option),
        option,
      })),
    [options, getLabel]
  );

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    // Close only when focus leaves the whole combobox (input + list).
    if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
      setOpen(false);
    }
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn("flex w-full flex-col", className)}
      onBlur={handleBlur}
      onMouseLeave={() => onOptionLeave?.()}
    >
      {label && <Label className="mb-1 text-muted-foreground">{label}</Label>}
      <Command
        className="overflow-visible bg-transparent"
        aria-label={ariaLabel ?? (!label ? "Search" : undefined)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <CommandInput
          placeholder={placeholder}
          value={search}
          onValueChange={setSearch}
          onFocus={() => setOpen(true)}
          className="h-9"
        />
        {open && (
          <div className="relative">
            <CommandList className="absolute top-1 z-50 max-h-[400px] w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
              <CommandEmpty>No results.</CommandEmpty>
              {items.map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.label}
                  onSelect={() => {
                    onChange(item.option);
                    setOpen(false);
                  }}
                  onMouseEnter={() => onOptionHover?.(item.option)}
                  onMouseLeave={() => onOptionLeave?.()}
                >
                  {renderOption ? renderOption(item.option) : item.label}
                </CommandItem>
              ))}
            </CommandList>
          </div>
        )}
      </Command>
    </div>
  );
}
