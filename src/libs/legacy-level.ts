import { type LayerSpecification, type StyleSpecification } from "maplibre-gl";

/** Everything in this file is a single, self-contained addon: to remove it
 * entirely, delete this file and its two call sites in App.tsx (one in
 * `openStyle`, one behind the "Legacy" export button). Nothing else in the
 * app depends on it, and it never touches `this.state.mapStyle` in place -
 * it only ever produces new style objects.
 */

/** True if {@link clause} is a level-visibility "any" fragment - the same
 * shape wemap/maputnik-indoor (and, for a while, this fork) used to bake
 * directly into a layer's filter. */
function isLevelClause(clause: any): boolean {
  return Array.isArray(clause) && clause[0] === "any" && Array.isArray(clause[1])
    && clause[1][0] === "==" && Array.isArray(clause[1][1]) && clause[1][1][0] === "get" && clause[1][1][1] === "level";
}

/** Recursively strips every level clause found anywhere in a filter tree,
 * however deep or however the surrounding "all"s got flattened/nested,
 * leaving everything else (the actual tag conditions) untouched. */
function stripLevelClauses(filter: any): any {
  if (!Array.isArray(filter)) return filter;
  const [op, ...rest] = filter;
  if (op === "all" || op === "any" || op === "none") {
    const cleaned = rest
      .filter(child => !isLevelClause(child))
      .map(child => stripLevelClauses(child));
    return [op, ...cleaned];
  }
  return filter;
}

/** Strips any baked level-visibility clause from every "indoor-"-prefixed
 * layer's filter. Called once when a style is opened, so a file coming from
 * an older export (or from wemap's original tool) behaves in the editor
 * exactly like one that never had a level block - the level selector's live
 * preview works normally on it right away, and the Filter tab never runs
 * into "Nested filters are not supported" for these layers. Layers whose id
 * doesn't start with "indoor" are left completely untouched. */
export function cleanIndoorLevelBlocks<T extends StyleSpecification>(style: T): T {
  const layers = style.layers.map((layer: LayerSpecification) => {
    const filter = (layer as any).filter;
    if (!layer.id.startsWith("indoor") || !Array.isArray(filter)) {
      return layer;
    }
    return { ...layer, filter: stripLevelClauses(filter) };
  });
  return { ...style, layers };
}

/** Bakes the level-visibility clause into every "indoor-"-prefixed layer of
 * a *copy* of {@link style}, for the "Legacy" export button - never mutates
 * the style being edited, so this has zero effect on the undo/redo history
 * or the file open in the editor. `level` only needs to be a valid number to
 * build a well-formed clause with - production doesn't look at which number
 * ends up baked, only that a clause (and the "indoor-" prefix) is present. */
export function bakeIndoorLevelBlocks<T extends StyleSpecification>(style: T, level: number): T {
  const levelClause = [
    "any",
    ["==", ["get", "level"], level.toString()],
    ["all", ["has", "min_level"], ["has", "max_level"], [">=", level, ["get", "min_level"]], ["<=", level, ["get", "max_level"]]],
    ["!", ["has", "level"]]
  ];

  const layers = style.layers.map((layer: LayerSpecification) => {
    const filter = (layer as any).filter;
    if (!layer.id.startsWith("indoor") || !Array.isArray(filter) || filter.length <= 1) {
      return layer;
    }
    const cleanedTags = stripLevelClauses(filter);
    // Flatten rather than nest if the tags are themselves already an "all" -
    // avoids stacking a redundant wrapper on repeated open/bake cycles.
    const tagChildren = Array.isArray(cleanedTags) && cleanedTags[0] === "all"
      ? cleanedTags.slice(1)
      : [cleanedTags];
    return { ...layer, filter: ["all", ...tagChildren, levelClause] };
  });

  return { ...style, layers };
}
