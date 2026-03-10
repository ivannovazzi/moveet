import type { OverlayContextValue } from "./types";

export let htmlTransformRef: OverlayContextValue = {
  mapHTMLElement: null,
  htmlTransform: (position) => position,
};

export function setHTMLTransformer(ref: typeof htmlTransformRef) {
  htmlTransformRef = ref;
}
