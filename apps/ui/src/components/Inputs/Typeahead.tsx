import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Inputs.module.css";
import classNames from "classnames";

interface TypeaheadProps<T> extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  label?: string;
  value?: T | null;
  options: T[];
  renderOption?: (option: T) => React.ReactNode;
  renderLabel?: (option: T) => string;
  onChange: (option: T) => void;
  onOptionHover?: (option: T) => void;
  onOptionLeave?: () => void;
}

export function Typeahead<T>({
  label = "",
  options,
  renderLabel,
  renderOption,
  value,
  onChange,
  onOptionHover = () => {},
  onOptionLeave = () => {},
  ...props
}: TypeaheadProps<T>) {
  const getLabel = React.useCallback(
    (option: T) => (renderLabel ? renderLabel(option) : String(option)),
    [renderLabel]
  );
  const [inputValue, setInputValue] = React.useState(value ? getLabel(value) : "");
  const [isOpen, setIsOpen] = React.useState(false);
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({});
  const labelRef = useRef<HTMLLabelElement>(null);

  const hasValue = !!value;

  useEffect(() => {
    if (!hasValue && !isOpen) {
      setInputValue("");
    }
  }, [hasValue, isOpen]);

  useEffect(() => {
    if (value) {
      setInputValue(getLabel(value));
    }
  }, [value, getLabel]);

  useEffect(() => {
    if (isOpen && labelRef.current) {
      const rect = labelRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    }
  }, [isOpen]);

  const filtered = React.useMemo(
    () => options.filter((o) => getLabel(o).toLowerCase().includes(inputValue.toLowerCase())),
    [options, inputValue, getLabel]
  );

  const handleSelect = (option: T) => {
    setInputValue(getLabel(option));
    onChange(option);
    setIsOpen(false);
  };

  return (
    <label className={styles.label} ref={labelRef}>
      {label}
      <input
        {...props}
        value={inputValue}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setIsOpen(false);
            (e.target as HTMLElement).blur();
          }
        }}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        autoComplete="off"
        className={classNames([styles.input, props.className])}
      />
      {isOpen &&
        filtered.length > 0 &&
        createPortal(
          <ul className={styles.dropdown} style={dropdownStyle} role="listbox">
            {filtered.slice(0, 30).map((option, i) => (
              <li
                key={`${getLabel(option)}-${i}`}
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(option);
                }}
                onMouseEnter={() => onOptionHover(option)}
                onMouseLeave={() => onOptionLeave()}
                className={styles.option}
              >
                {renderOption ? renderOption(option) : String(option)}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </label>
  );
}
