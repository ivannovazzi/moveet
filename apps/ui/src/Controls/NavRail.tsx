import { SquaredButton } from "@/components/Inputs";
import { cn } from "@/lib/utils";
import { BOTTOM_PANEL_IDS, PANEL_GROUPS, PANELS, type PanelId } from "./panels";

interface NavRailProps {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  incidentCount?: number;
}

export default function NavRail({ activePanel, onPanelChange, incidentCount }: NavRailProps) {
  const renderButton = (id: PanelId) => {
    const { icon: Icon, label } = PANELS[id];
    return (
      <SquaredButton
        key={id}
        labeled
        className="relative w-full justify-start gap-2.5 px-3 aria-pressed:before:absolute aria-pressed:before:left-0 aria-pressed:before:top-1.5 aria-pressed:before:bottom-1.5 aria-pressed:before:w-0.5 aria-pressed:before:rounded-full aria-pressed:before:bg-accent aria-pressed:before:content-['']"
        icon={<Icon />}
        iconClassName="size-4"
        size="lg"
        variant="ghost"
        tone="active"
        title={label}
        active={activePanel === id}
        onClick={() => onPanelChange(activePanel === id ? null : id)}
        aria-pressed={activePanel === id}
      >
        <span className="flex-1 text-left text-sm">{label}</span>
        {id === "incidents" && incidentCount != null && incidentCount > 0 && (
          <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-status-error px-[3px] text-[9px] font-semibold leading-none text-white">
            {incidentCount > 9 ? "9+" : incidentCount}
          </span>
        )}
      </SquaredButton>
    );
  };

  return (
    <nav
      className={cn(
        "z-[31] flex w-60 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-border-soft surface-raised px-2 py-3",
        "shadow-[4px_0_16px_-8px_rgba(0,0,0,0.5)]",
        "pointer-events-none -translate-x-4 opacity-0 transition-[opacity,transform] duration-700 ease-emphasized",
        "[[data-ready]_&]:pointer-events-auto [[data-ready]_&]:translate-x-0 [[data-ready]_&]:opacity-100"
      )}
      aria-label="Sidebar navigation"
    >
      {PANEL_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pb-2">
          <span className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </span>
          {group.ids.map(renderButton)}
        </div>
      ))}
      <div className="flex-1" />
      {BOTTOM_PANEL_IDS.map(renderButton)}
    </nav>
  );
}
