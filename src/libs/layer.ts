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

/** Given a synthetic group drop id, returns the index at which a dragged
 * layer should be inserted to land right before that group (i.e. between it
 * and the previous group/layer). Returns null if the id isn't a group drop id.
 */
export function resolveGroupDropIndex(id: string): number | null {
  if (!id.startsWith(GROUP_DROP_ID_PREFIX)) {
    return null;
  }
  const rest = id.slice(GROUP_DROP_ID_PREFIX.length);
  const sepIdx = rest.indexOf(":");
  const idxStr = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
  const parsed = parseInt(idxStr, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Builds the ordered list of sortable ids for the layers list, inserting a
 * synthetic id before every group header (groups of 2+ layers sharing a
 * common prefix) so that dropping directly on a group boundary works the
 * same way as dropping on a regular layer.
 */
export function buildLayerListSortableIds(layers: LayerSpecification[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const previousLayer = layers[i - 1];
    const isGroupStart = !previousLayer || layerPrefix(previousLayer.id) !== layerPrefix(layer.id);

    if (isGroupStart) {
      let groupLength = 1;
      for (let j = i + 1; j < layers.length; j++) {
        if (layerPrefix(layers[j].id) === layerPrefix(layer.id)) {
          groupLength += 1;
        } else {
          break;
        }
      }
      if (groupLength > 1) {
        ids.push(groupDropId(i, layer.id));
      }
    }

    ids.push(layer.id);
  }
  return ids;
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
