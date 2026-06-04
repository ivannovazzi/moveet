import { Switch as UISwitch } from "@/components/ui/switch";

type SwitchProps = Omit<
  React.ComponentProps<typeof UISwitch>,
  "checked" | "onCheckedChange" | "disabled" | "children" | "onChange"
> & {
  /** react-aria-style selected state */
  isSelected?: boolean;
  /** react-aria-style change handler (receives a boolean) */
  onChange?: (isSelected: boolean) => void;
  /** react-aria-style disabled flag */
  isDisabled?: boolean;
};

export function Switch({ isSelected, onChange, isDisabled, ...props }: SwitchProps) {
  return (
    <UISwitch checked={isSelected} onCheckedChange={onChange} disabled={isDisabled} {...props} />
  );
}
