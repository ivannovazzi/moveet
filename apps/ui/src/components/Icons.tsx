import { forwardRef } from "react";
import {
  Flame as FlameBase,
  Navigation as NavigationBase,
  AlertTriangle as AlertTriangleBase,
  Fuel as FuelBase,
  BatteryLow as BatteryLowBase,
  ZoomIn as ZoomInBase,
  ZoomOut as ZoomOutBase,
  RotateCcw as RotateCcwBase,
  Pause as PauseBase,
  Play as PlayBase,
  MapPin as MapPinBase,
  Route as RouteBase,
  Store as StoreBase,
  Trees as TreesBase,
  Hammer as HammerBase,
  Building2 as Building2Base,
  HelpCircle as HelpCircleBase,
  Settings as SettingsBase,
  Search as SearchBase,
  Bus as BusBase,
  TriangleAlert as TriangleAlertBase,
  Circle as CircleBase,
  Square as SquareBase,
  FastForward as FastForwardBase,
  Car as CarBase,
  Layers as LayersBase,
  Bell as BellBase,
  CircleDot as CircleDotBase,
  Eye as EyeBase,
  Gauge as GaugeBase,
  ChartLine as ChartLineBase,
  Hexagon as HexagonBase,
  ClipboardList as ClipboardListBase,
  Clock as ClockBase,
  X as XBase,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * Thin aliases over `lucide-react`. The public component names are kept
 * identical to the previous hand-rolled SVG components so the dozens of
 * importers don't need to change. Every icon renders an `<svg>` and accepts
 * `size`, `color`, `className`, and standard SVG props. Icons are
 * `aria-hidden` by default; callers can override any prop.
 */
function aliasIcon(Base: LucideIcon): LucideIcon {
  const Aliased = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <Base aria-hidden ref={ref} {...props} />
  ));
  Aliased.displayName = (Base as { displayName?: string }).displayName ?? "Icon";
  return Aliased as unknown as LucideIcon;
}

export const HeatZone = aliasIcon(FlameBase);
export const Flame = aliasIcon(FlameBase);
export const Directions = aliasIcon(NavigationBase);
export const EngineIssues = aliasIcon(AlertTriangleBase);
export const LowFuel = aliasIcon(FuelBase);
export const LowBattery = aliasIcon(BatteryLowBase);
export const ZoomIn = aliasIcon(ZoomInBase);
export const ZoomOut = aliasIcon(ZoomOutBase);
export const Reset = aliasIcon(RotateCcwBase);
export const Pause = aliasIcon(PauseBase);
export const Play = aliasIcon(PlayBase);
export const POI = aliasIcon(MapPinBase);
export const Road = aliasIcon(RouteBase);
export const Shop = aliasIcon(StoreBase);
export const Leisure = aliasIcon(TreesBase);
export const Craft = aliasIcon(HammerBase);
export const Office = aliasIcon(Building2Base);
export const Unknown = aliasIcon(HelpCircleBase);
export const Gear = aliasIcon(SettingsBase);
export const Search = aliasIcon(SearchBase);
export const Bus = aliasIcon(BusBase);
export const WarningTriangle = aliasIcon(TriangleAlertBase);
export const Record = aliasIcon(CircleBase);
export const Stop = aliasIcon(SquareBase);
export const FastForward = aliasIcon(FastForwardBase);
export const CarIcon = aliasIcon(CarBase);
export const LayersIcon = aliasIcon(LayersBase);
export const AlertIcon = aliasIcon(BellBase);
export const RecordCircleIcon = aliasIcon(CircleDotBase);
export const EyeIcon = aliasIcon(EyeBase);
export const GaugeIcon = aliasIcon(GaugeBase);
export const ChartIcon = aliasIcon(ChartLineBase);
export const GeofenceIcon = aliasIcon(HexagonBase);
export const ScenarioIcon = aliasIcon(ClipboardListBase);
export const ClockIcon = aliasIcon(ClockBase);
export const CloseIcon = aliasIcon(XBase);
