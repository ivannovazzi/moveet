import { GROUP_META, type PoiGroup } from "./categories";

/**
 * Fill token for a POI group, used by the HTML marker for the selected POI.
 * The deck.gl icon atlas reads the same token, so the selected marker and the
 * carpet of GPU-drawn discs can never drift apart.
 */
export function getFillForGroup(group: PoiGroup): string {
  return GROUP_META[group].token;
}
