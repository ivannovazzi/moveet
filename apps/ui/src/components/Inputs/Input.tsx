import { TextField, Label, Input as AriaInput, type TextFieldProps } from "react-aria-components";
import styles from "./Inputs.module.css";

interface InputProps extends Omit<TextFieldProps, "onChange"> {
  label?: string;
  onChange?: (value: string) => void;
  /** Input type — defaults to "number". Pass "text" to render as textbox. */
  type?: React.HTMLInputTypeAttribute;
}

export function Input({ label, value, onChange, type = "number", ...props }: InputProps) {
  return (
    <TextField
      className={styles.label}
      value={String(value ?? "")}
      onChange={onChange}
      {...props}
    >
      {label && <Label>{label}</Label>}
      <AriaInput type={type} className={styles.input} />
    </TextField>
  );
}
