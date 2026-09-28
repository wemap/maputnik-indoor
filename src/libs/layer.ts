import {latest} from "@maplibre/maplibre-gl-style-spec";
import { type LayerSpecification } from "maplibre-gl";


export function changeType(layer: LayerSpecification, newType: string): LayerSpecification {
  const changedPaintProps: LayerSpecification["paint"] = { ...layer.paint };
  Object.keys(changedPaintProps).forEach(propertyName => {
    if(!(propertyName in latest["paint_" + newType])) {
      delete changedPaintProps[propertyName as keyof LayerSpecification["paint"]];
    }
  });

  const changedLayoutProps: LayerSpecification["layout"] = { ...layer.layout };
  Object.keys(changedLayoutProps).forEach(propertyName => {
    if(!(propertyName in latest["layout_" + newType])) {
      delete changedLayoutProps[propertyName as keyof LayerSpecification["layout"]];
    }
  });

  return {
    ...layer,
    paint: changedPaintProps,
    layout: changedLayoutProps,
    type: newType
  } as LayerSpecification;
}

/** Short, human readable label appended to the id when duplicating a layer
 * as a different type. Covers the most commonly used conversions; any other
 * type falls back to its own name.
 */
export const DUPLICATE_TYPE_LABELS: Record<string, string> = {
  "fill": "fill",
  "line": "line",
  "fill-extrusion": "extrusion",
};

/** Builds the suggested id for a layer duplicated as {@link newType}. If the
 * original id already ends with "-copy" or a known type label (e.g. it was
 * itself produced by this same duplication flow), that suffix is replaced
 * rather than stacked, so re-duplicating repeatedly doesn't pile up suffixes.
 */
export function buildDuplicateAsTypeId(originalId: string, newType: string): string {
  const label = DUPLICATE_TYPE_LABELS[newType] || newType;
  const knownSuffixes = ["copy", ...Object.values(DUPLICATE_TYPE_LABELS)];
  const escaped = knownSuffixes.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const suffixPattern = new RegExp(`-(?:${escaped.join("|")})$`);
  const base = originalId.replace(suffixPattern, "");
  return `${base}-${label}`;
}

/** Duplicates {@link layer} as a new type: keeps filter/source/source-layer/
 * zoom range untouched (so it still targets the same features) but strips
 * out paint/layout properties that don't apply to the new type, via
 * {@link changeType}.
 */
export function duplicateLayerAsType(layer: LayerSpecification, newType: string): LayerSpecification {
  const converted = changeType(layer, newType);
  return {
    ...converted,
    id: buildDuplicateAsTypeId(layer.id, newType),
  };
}


export function changeProperty(layer: LayerSpecification, group: keyof LayerSpecification | null, property: string, newValue: any) {
  // Remove the property if undefined
  if(newValue === undefined) {
    if(group) {
      const newLayer: any = {
        ...layer,
        // Change object so the diff works in ./src/components/map/MaplibreGlMap.jsx
        [group]: {
          ...layer[group] as any
        }
      };
      delete newLayer[group][property];

      // Remove the group if it is now empty
      if(Object.keys(newLayer[group]).length < 1) {
        delete newLayer[group];
      }
      return newLayer;
    } else {
      const newLayer: any = {
        ...layer
      };
      delete newLayer[property];
      return newLayer;
    }
  }
  else {
    if(group) {
      return {
        ...layer,
        [group]: {
          ...layer[group] as any,
          [property]: newValue
        }
      };
    } else {
      return {
        ...layer,
        [property]: newValue
      };
    }
  }
}

export function layerPrefix(name: string) {
  return name.replace(" ", "-").replace("_", "-").split("-")[0];
}

export function findClosestCommonPrefix(layers: LayerSpecification[], idx: number) {
  const currentLayerPrefix = layerPrefix(layers[idx].id);
  let closestIdx = idx;
  for (let i = idx; i > 0; i--) {
    const previousLayerPrefix = layerPrefix(layers[i-1].id);
    if(previousLayerPrefix === currentLayerPrefix) {
      closestIdx = i - 1;
    } else {
      return closestIdx;
    }
  }
  return closestIdx;
}

/** Prefix used to build a synthetic sortable id for a group header, so it can
 * act as a drop target in the layers list exactly like a regular layer row.
 */
export const GROUP_DROP_ID_PREFIX = "__maputnik_group_before__:";

/** Builds the synthetic sortable id for the header of the group whose first
 * layer sits at {@link firstLayerIndex} in the layers array.
 */
export function groupDropId(firstLayerIndex: number, firstLayerId: string): string {
  return `${GROUP_DROP_ID_PREFIX}${firstLayerIndex}:${firstLayerId}`;
}

/** One row of the layers list as the user actually sees it: either a group
 * header (for groups of 2+ layers sharing a prefix) or a visible layer row.
 * Layers hidden inside a collapsed group are NOT part of this list - they
 * are neither drop targets nor taken into account for the drag spacing.
 */
export type LayerListEntry =
  | { kind: "header"; id: string; key: string; start: number; end: number; collapsed: boolean }
  | { kind: "layer"; id: string; index: number };

/** Stable key identifying a group across layer moves: its prefix plus its
 * rank among the groups sharing that prefix (a prefix normally appears in a
 * single group, the rank only disambiguates the rare split case). Unlike the
 * group's first layer index, this doesn't change when some unrelated layer
 * is moved above the group.
 */
export function layerGroupKeys(groups: {id: string}[][]): string[] {
  const seen = new Map<string, number>();
  return groups.map(group => {
    const prefix = layerPrefix(group[0].id);
    const rank = seen.get(prefix) ?? 0;
    seen.set(prefix, rank + 1);
    return `${prefix}#${rank}`;
  });
}

/** Builds the visible entries of the layers list (see {@link LayerListEntry}).
 * `isCollapsed` receives a group key from {@link layerGroupKeys}.
 */
export function buildLayerListEntries(
  layers: LayerSpecification[],
  isCollapsed: (groupKey: string) => boolean,
  selectedLayerIndex: number,
): LayerListEntry[] {
  const groups: LayerSpecification[][] = [];
  for (let i = 0; i < layers.length; i++) {
    const previousLayer = layers[i - 1];
    if (previousLayer && layerPrefix(previousLayer.id) === layerPrefix(layers[i].id)) {
      groups[groups.length - 1].push(layers[i]);
    } else {
      groups.push([layers[i]]);
    }
  }
  const keys = layerGroupKeys(groups);

  const entries: LayerListEntry[] = [];
  let idx = 0;
  groups.forEach((group, g) => {
    const start = idx;
    const end = idx + group.length - 1;
    const isGroup = group.length > 1;
    const collapsed = isGroup && isCollapsed(keys[g]);
    if (isGroup) {
      entries.push({ kind: "header", id: groupDropId(start, group[0].id), key: keys[g], start, end, collapsed });
    }
    group.forEach(layer => {
      if (!collapsed || idx === selectedLayerIndex) {
        entries.push({ kind: "layer", id: layer.id, index: idx });
      }
      idx += 1;
    });
  });
  return entries;
}

/** Resolves a drag & drop in the layers list into an `{oldIndex, newIndex}`
 * move in the layers array, based on the order the user saw when dropping
 * (the dragged row moved from its entry to the `over` entry). What the user
 * sees above the dropped row decides where it lands:
 * - nothing above: top of the list;
 * - a layer row: right after that layer;
 * - an expanded group header: right before the group's first layer;
 * - a collapsed group header: right after the whole group (its hidden layers
 *   are visually "inside" the header), unless the row below is one of that
 *   group's layers still shown (selected) or the dragged layer itself belongs
 *   to that group - then right before the group's first layer.
 * Returns null when the drop doesn't change anything.
 */
export function resolveLayerListDrop(
  entries: LayerListEntry[],
  activeId: string,
  overId: string,
): {oldIndex: number; newIndex: number} | null {
  const from = entries.findIndex(e => e.id === activeId);
  const to = entries.findIndex(e => e.id === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const active = entries[from];
  if (active.kind !== "layer") return null;

  const order = entries.slice();
  order.splice(to, 0, order.splice(from, 1)[0]);
  const pos = order.indexOf(active);
  const prev = order[pos - 1];
  const next = order[pos + 1];

  // Insert the dragged layer right before layer index `target` (in the
  // original array, target === layers.length meaning "at the end").
  let target: number;
  if (!prev) {
    target = 0;
  } else if (prev.kind === "layer") {
    target = prev.index + 1;
  } else {
    const nextInGroup = next?.kind === "layer" && next.index >= prev.start && next.index <= prev.end;
    const activeInGroup = active.index >= prev.start && active.index <= prev.end;
    target = (!prev.collapsed || nextInGroup || activeInGroup) ? prev.start : prev.end + 1;
  }

  const oldIndex = active.index;
  const newIndex = target > oldIndex ? target - 1 : target;
  return newIndex === oldIndex ? null : {oldIndex, newIndex};
}

/** Where the selected layer ends up after moving `oldIndex` to `newIndex`,
 * so the selection stays on the same layer even when another one moved
 * across it.
 */
export function selectedIndexAfterMove(selected: number, oldIndex: number, newIndex: number): number {
  if (selected === oldIndex) return newIndex;
  if (oldIndex < selected && selected <= newIndex) return selected - 1;
  if (newIndex <= selected && selected < oldIndex) return selected + 1;
  return selected;
}

/** Builds the companion `raster` layer an `image` source needs in order to
 * actually render - an `image` source with no layer referencing it is
 * invisible. The id is derived from {@link sourceId} (`"<sourceId>-image"`),
 * de-duplicated against {@link existingLayers}' ids in case that id is
 * somehow already taken. Used right after a new image source is placed on
 * the map, so the source and its layer are created together in one step. */
export function createImageRasterLayer(existingLayers: LayerSpecification[], sourceId: string): LayerSpecification {
  const existingIds = new Set(existingLayers.map(l => l.id));
  let id = `${sourceId}-image`;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${sourceId}-image-${suffix++}`;
  }
  return { id, type: "raster", source: sourceId } as LayerSpecification;
}

/** Builds an id for a copy of {@link originalId} (a source or a layer, the
 * logic is the same either way), following the same "-copy"-suffix-replaces-
 * itself convention as {@link buildDuplicateAsTypeId} (so re-duplicating a
 * duplicate doesn't pile up suffixes), de-duplicated against
 * {@link existingIds}. Appends "-copy" at the very end rather than inserting
 * it before an existing suffix, so duplicating an image layer whose id is
 * `"<sourceId>-image"` yields `"<sourceId>-image-copy"`, not
 * `"<sourceId>-copy-image"`. */
export function buildDuplicateId(originalId: string, existingIds: Set<string>): string {
  const base = originalId.replace(/-copy(?:-\d+)?$/, "");
  let id = `${base}-copy`;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${base}-copy-${suffix++}`;
  }
  return id;
}
