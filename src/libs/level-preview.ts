import { convertFilter, expression, type FilterSpecification, type LayerSpecification, type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";

/** Live level preview for the map view only: what the level selector adds to
 * the style sent to MapLibre. Never touches the edited style or the saved file.
 *
 * Same scope rule as production: only layers whose id starts with "indoor-"
 * (and never the base-map "composite" source). Every other layer is passed
 * through untouched, so a legacy filter on a base-map layer can no longer make
 * MapLibre reject the whole style. */
export function isIndoorPreviewLayer(id: string, source: string | undefined): boolean {
  return id.startsWith("indoor-") && source !== "composite";
}

/** Level visibility clause. `level` is compared as text: the data stores it as a string. */
function levelClause(level: number): FilterSpecification {
  return [
    "any",
    ["==", ["get", "level"], String(level)],
    ["all", ["has", "min_level"], ["has", "max_level"], [">=", level, ["get", "min_level"]], ["<=", level, ["get", "max_level"]]],
    ["!", ["has", "level"]]
  ] as any;
}

/** Returns `filter` combined with the level clause. A legacy-syntax filter is
 * converted to an expression first (the two syntaxes can't be mixed). If the
 * filter can't be converted (already invalid), it is returned unchanged rather
 * than producing a style MapLibre would reject as a whole. */
export function withLevelClause(filter: FilterSpecification | undefined | null, level: number): FilterSpecification | undefined | null {
  const clause = levelClause(level);
  if (!filter) return clause;
  try {
    const expr = expression.isExpressionFilter(filter) ? filter : convertFilter(filter);
    return ["all", expr, clause] as any;
  } catch {
    return filter;
  }
}

/** Applies the level clause to one layer if it is in scope (see isIndoorPreviewLayer).
 * `scopeId` lets derived layers (e.g. "<id>_highlight") be scoped by their original id. */
export function applyLevelToLayer<T extends LayerSpecification>(layer: T, level: number | null, scopeId: string = layer.id): T {
  if (level === null) return layer;
  const source = (layer as any).source as string | undefined;
  if (!source || !isIndoorPreviewLayer(scopeId, source)) return layer;
  return { ...layer, filter: withLevelClause((layer as any).filter, level) } as T;
}

export function applyLevelPreview(style: StyleSpecification, level: number | null): StyleSpecification {
  if (level === null) return style;
  return { ...style, layers: style.layers.map(layer => applyLevelToLayer(layer, level)) };
}
