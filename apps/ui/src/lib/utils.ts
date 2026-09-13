import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know the type scale declared in `index.css`
 * (`--text-micro` … `--text-title`). Without this it reads `text-micro` as a
 * text colour and lets a later `text-muted-foreground` drop it, which silently
 * un-sizes every label that carries both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "meta", "label", "body", "title"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
