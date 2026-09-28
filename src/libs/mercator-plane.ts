/**
 * Small, shared glue between lng/lat and the Mercator *plane* space the
 * image gizmo's pose (see image-position.ts) lives in - MapLibre's own
 * flat, distortion-free world coordinates (the whole world is x/y in
 * [0,1], see maplibre-gl's MercatorCoordinate). Deliberately just this -
 * everything genuinely map-instance-dependent (screen projection, the
 * empirical screen-pixel-to-plane-unit conversion) stays local to whatever
 * component actually has a `Map` to call into, e.g. MapMaplibreGl's own
 * planeUnitsPerScreenPixel. This file exists so that a second, map-less
 * consumer (ImagePositionEditor, which only ever sees a source's
 * coordinates - lng/lat in, lng/lat out - never a live map) doesn't have to
 * duplicate the lngLat<->plane conversion to compute/edit a pose.
 */

import { MercatorCoordinate } from "maplibre-gl";
import { type Point } from "./image-position";

export function lngLatToPlane(lngLat: [number, number]): Point {
  const merc = MercatorCoordinate.fromLngLat(lngLat);
  return [merc.x, merc.y];
}

export function planeToLngLat(point: Point): [number, number] {
  const lngLat = new MercatorCoordinate(point[0], point[1], 0).toLngLat();
  return [lngLat.lng, lngLat.lat];
}

/** How many plane units correspond to one real-world meter near `lngLat` -
 * unlike a screen-pixel conversion, this only depends on latitude (Mercator
 * distortion), never on zoom/pitch/bearing, which is exactly what makes it
 * usable for a real-world size (as opposed to a constant on-screen size
 * like the gizmo's own handles/cross). Used to convert a pose's width/height
 * to/from meters for direct numeric editing (see ImagePositionEditor). */
export function planeUnitsPerMeter(lngLat: [number, number]): number {
  return MercatorCoordinate.fromLngLat(lngLat).meterInMercatorCoordinateUnits();
}
