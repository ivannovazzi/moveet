export const eValue =
  <T extends string | boolean>(fn: (value: T) => void) =>
  (e: React.ChangeEvent<HTMLInputElement>) =>
    fn((e.target.type === "checkbox" ? e.target.checked : e.target.value) as T);
