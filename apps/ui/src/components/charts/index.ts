/**
 * Hand-rolled SVG charts.
 *
 * Deliberately no charting library: the whole surface is four mark types
 * (line, area wash, gridline, dot) rendered into ~200px-wide facets inside a
 * dock panel. Recharts/visx would add 40–120 kB gzip to the entry bundle, bring
 * their own colour and layout defaults to fight with the oklch theme tokens,
 * and need canvas/ResizeObserver shims under jsdom — for marks that are 40
 * lines of arithmetic. The app already renders its map with raw deck.gl for the
 * same reason. If a chart ever needs stacking, brushing, or real axis
 * negotiation, revisit that call; today it would be dependency for its own sake.
 */
export { chartTheme } from "./chartTheme";
export {
  buildSeries,
  downsample,
  extent,
  formatTimeReadout,
  formatTimeTick,
  nearestIndexForFraction,
  niceTicks,
  plotBox,
  round2,
  type Datum,
  type Insets,
  type PlotBox,
  type Point,
  type SeriesGeometry,
  type SeriesRun,
} from "./geometry";
export { SeriesTable, type SeriesTableProps } from "./SeriesTable";
export { SmallMultiples, type SmallMultiplesProps } from "./SmallMultiples";
export { Sparkline, type SparkPoint, type SparklineProps } from "./Sparkline";
export { StatTile, type StatDelta, type StatTileProps, type DeltaPolarity } from "./StatTile";
export { FACET_INSETS, TimeSeriesFacet, type FacetSeries } from "./TimeSeriesFacet";
export { useElementWidth } from "./useElementWidth";
