import { Button as UIButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ExtendedButtonProps = Omit<React.ComponentProps<typeof UIButton>, "disabled"> & {
  /** Standard HTML disabled attribute */
  disabled?: boolean;
  /** Legacy react-aria alias — mapped to native disabled (isDisabled ?? disabled) */
  isDisabled?: boolean;
};

export function Button({
  className,
  disabled,
  isDisabled,
  size = "sm",
  ...props
}: ExtendedButtonProps) {
  return (
    <UIButton
      variant="outline"
      size={size}
      className={cn(className)}
      disabled={isDisabled ?? disabled}
      {...props}
    />
  );
}
