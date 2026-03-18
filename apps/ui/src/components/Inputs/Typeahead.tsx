import { useCallback, useMemo } from "react";
import {
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import styles from "./Inputs.module.css";
import classNames from "classnames";

interface TypeaheadItem<T> {
  key: string;
  option: T;
}

interface TypeaheadProps<T> {
  label?: string;
  value?: T | null;
  options: T[];
  renderOption?: (option: T) => React.ReactNode;
  renderLabel?: (option: T) => string;
  onChange: (option: T) => void;
  onOptionHover?: (option: T) => void;
  onOptionLeave?: () => void;
  className?: string;
  placeholder?: string;
}

export function Typeahead<T>({
  label,
  options,
  renderLabel,
  renderOption,
  value,
  onChange,
  onOptionHover,
  onOptionLeave,
  className,
  placeholder,
}: TypeaheadProps<T>) {
  const getLabel = useCallback(
    (option: T) => (renderLabel ? renderLabel(option) : String(option)),
    [renderLabel]
  );

  const items = useMemo<TypeaheadItem<T>[]>(
    () => options.map((option, i) => ({ key: `${getLabel(option)}-${i}`, option })),
    [options, getLabel]
  );

  const selectedKey =
    value != null
      ? `${getLabel(value)}-${options.indexOf(value)}`
      : null;

  return (
    <ComboBox<TypeaheadItem<T>>
      className={styles.comboBoxRoot}
      defaultItems={items}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        const found = items.find((item) => item.key === key);
        if (found) onChange(found.option);
      }}
      menuTrigger="focus"
    >
      {label && <Label className={styles.comboLabel}>{label}</Label>}
      <Input
        className={classNames(styles.input, className)}
        placeholder={placeholder}
      />
      <Popover className={styles.dropdown}>
        <ListBox<TypeaheadItem<T>> className={styles.listBox}>
          {(item) => (
            <ListBoxItem
              id={item.key}
              textValue={getLabel(item.option)}
              className={styles.option}
              onHoverStart={() => onOptionHover?.(item.option)}
              onHoverEnd={() => onOptionLeave?.()}
            >
              {renderOption ? renderOption(item.option) : getLabel(item.option)}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
