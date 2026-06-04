import { useState } from "react";
import type { CreateGeoFenceRequest, GeoFenceType } from "@moveet/shared-types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/Inputs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { isSelfIntersecting } from "./polygonValidation";

interface CreateZoneDialogProps {
  polygon: [number, number][] | null;
  onSubmit: (req: CreateGeoFenceRequest) => void;
  onClose: () => void;
}

const FENCE_TYPES: GeoFenceType[] = ["restricted", "delivery", "monitoring"];

export default function CreateZoneDialog({ polygon, onSubmit, onClose }: CreateZoneDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<GeoFenceType>("monitoring");
  const [color, setColor] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (polygon === null) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!name.trim()) return;

    if (polygon.length < 3) {
      setValidationError("Polygon must have at least 3 vertices.");
      return;
    }

    if (isSelfIntersecting(polygon)) {
      setValidationError("Polygon edges must not cross each other.");
      return;
    }

    const req: CreateGeoFenceRequest = {
      name: name.trim(),
      type,
      polygon,
      ...(color ? { color } : {}),
    };
    onSubmit(req);
    setName("");
    setType("monitoring");
    setColor("");
    setValidationError(null);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-label="Create geofence zone"
        aria-describedby={undefined}
        className="w-[clamp(280px,90vw,360px)] gap-0 p-0"
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>Create Zone</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="zone-name">
              Name <span className="text-status-error">*</span>
            </Label>
            <Input
              id="zone-name"
              type="text"
              value={name}
              onChange={setName}
              placeholder="Zone name"
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="zone-type">Type</Label>
            <select
              id="zone-type"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              value={type}
              onChange={(e) => setType(e.target.value as GeoFenceType)}
            >
              {FENCE_TYPES.map((t) => (
                <option key={t} value={t} className="bg-popover text-popover-foreground">
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="zone-color">
              Color <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-center gap-3">
              <input
                id="zone-color"
                type="color"
                className="h-8 w-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5 dark:bg-input/30"
                value={color || "#3b82f6"}
                onChange={(e) => setColor(e.target.value)}
              />
              {color && (
                <button
                  type="button"
                  className="cursor-pointer text-xs text-muted-foreground underline hover:text-foreground"
                  onClick={() => setColor("")}
                >
                  Use default
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Polygon: <span>{polygon.length} vertices</span>
          </div>
          {validationError && (
            <p className="m-0 text-xs leading-relaxed text-status-error" role="alert">
              {validationError}
            </p>
          )}
          <DialogFooter className="border-t border-border pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create Zone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
