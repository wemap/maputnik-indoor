import React from "react";
import {flushSync} from "react-dom";
import {createRoot} from "react-dom/client";
import MapLibreGl, {type ImageSource, type LayerSpecification, type LngLat, type Map, type MapOptions, type SourceSpecification, type StyleSpecification} from "maplibre-gl";
import MaplibreInspect from "@maplibre/maplibre-gl-inspect";
import colors from "@maplibre/maplibre-gl-inspect/lib/colors";
import MapMaplibreGlLayerPopup from "./MapMaplibreGlLayerPopup";
import MapMaplibreGlFeaturePropertyPopup, { type InspectFeature } from "./MapMaplibreGlFeaturePropertyPopup";
import Color from "color";
import ZoomControl from "../libs/zoomcontrol";
import LevelControl from "../libs/levelcontrol";
import FitBoundsControl from "../libs/fitboundscontrol";
import { type HighlightedLayer, colorHighlightedLayer } from "../libs/highlight";
import { type ImagePose, type Point, type Corners, type CornerIndex, type GizmoZone, type GizmoHitTestOptions, cornersFromPose, crossArmsFromPose, poseFromCorners, defaultImageSize, hitTestGizmo, translatePose, scalePoseFromCorner, scalePoseFromCenter, angleTo, pointInQuad } from "../libs/image-position";
import { lngLatToPlane, planeToLngLat } from "../libs/mercator-plane";
import { type OnStyleChangedOpts } from "../libs/definitions";
import "maplibre-gl/dist/maplibre-gl.css";
import "../maplibregl.css";
import "../libs/maplibre-rtl";
import MaplibreGeocoder, { type MaplibreGeocoderApi, type MaplibreGeocoderApiConfig } from "@maplibre/maplibre-gl-geocoder";
import "@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css";
import { withTranslation, type WithTranslation } from "react-i18next";
import i18next from "i18next";
import { Protocol } from "pmtiles";

function applyLevelFilter(style: StyleSpecification, level: number | null): StyleSpecification {
  if (level === null) return style;
  const lf: any = ["any", ["==", ["get", "level"], String(level)], ["all", ["has", "min_level"], ["has", "max_level"], [">=", level, ["get", "min_level"]], ["<=", level, ["get", "max_level"]]], ["!", ["has", "level"]]];
  const layers = style.layers.map((layer: any) => {
    if (!layer.source) return layer;
    const orig = layer.filter ?? null;
    return {...layer, filter: orig ? ["all", orig, lf] : lf};
  });
  return {...style, layers} as StyleSpecification;
}

// Custom cursors for hovering the image gizmo (move/resize/rotate) - round
// badge icons (a filled circle behind a white glyph, supplied by the user
// as direct replacements for the previous hand-drawn ones), so they stay
// legible over any underlying map content without needing a separate halo
// stroke. Built once at module load from the raw SVG markup; cheap and
// static, so there's no reason to rebuild them per-render.
function buildGizmoCursor(svg: string, hotspot: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot} ${hotspot}, ${fallback}`;
}

const GIZMO_MOVE_CURSOR_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 64 64\">"
  + "<circle cx=\"32\" cy=\"32\" r=\"30\" fill=\"#565656\"/>"
  + "<g transform=\"translate(15.2,15.2) scale(1.4)\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">"
  + "<polygon points=\"5 9 2 12 5 15\" fill=\"#ffffff\"/><polygon points=\"9 5 12 2 15 5\" fill=\"#ffffff\"/><polygon points=\"15 19 12 22 9 19\" fill=\"#ffffff\"/><polygon points=\"19 9 22 12 19 15\" fill=\"#ffffff\"/>"
  + "<line x1=\"2\" y1=\"12\" x2=\"22\" y2=\"12\"/><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"22\"/>"
  + "</g></svg>";

const GIZMO_RESIZE_CURSOR_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 64 64\">"
  + "<circle cx=\"32\" cy=\"32\" r=\"30\" fill=\"#565656\"/>"
  + "<g transform=\"translate(15.2,15.2) scale(1.4)\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">"
  + "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"1.5\"/><rect x=\"4\" y=\"12\" width=\"8\" height=\"8\" rx=\"1\" fill=\"#ffffff\"/>"
  + "</g></svg>";

const GIZMO_ROTATE_CURSOR_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 64 64\">"
  + "<circle cx=\"32\" cy=\"32\" r=\"30\" fill=\"#565656\"/>"
  + "<g transform=\"translate(15.2,15.2) scale(1.4)\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">"
  + "<path d=\"M20.49 15a9 9 0 1 1-2.12-9.36L23 10\"/><polygon points=\"23 4 23 10 17 10\" fill=\"#ffffff\"/>"
  + "</g></svg>";

const GIZMO_MOVE_CURSOR = buildGizmoCursor(GIZMO_MOVE_CURSOR_SVG, 12, "move");
const GIZMO_RESIZE_CURSOR = buildGizmoCursor(GIZMO_RESIZE_CURSOR_SVG, 12, "nwse-resize");
const GIZMO_ROTATE_CURSOR = buildGizmoCursor(GIZMO_ROTATE_CURSOR_SVG, 12, "grab");

// The gizmo's pose (center/width/height/rotation) is deliberately kept in
// Mercator *plane* space - MapLibre's own flat, distortion-free world
// coordinates (see MercatorCoordinate: the whole world is x/y in [0,1]) -
// rather than screen pixels. Screen pixels look tempting since map.project()
// hands them out directly, but under any pitch they're perspective-warped:
// a real rectangle on the ground projects to a general trapezoid on screen
// (nearer edges larger, farther edges compressed), which the pose model
// (a plain rotated rectangle) can't represent. The plane is exactly the flat
// "ground" MapLibre itself renders onto before applying the camera/pitch
// transform, so a rectangle there stays a rectangle regardless of pitch -
// only the *rendering* of the gizmo (renderImageGizmo) needs to project each
// corner through the current camera to draw the correct on-screen trapezoid.
// lngLatToPlane/planeToLngLat themselves live in libs/mercator-plane.ts, not
// here - ImagePositionEditor needs the exact same conversion to edit a pose
// as width/height/rotation, but never has a live map to call into.

// How many plane units correspond to one screen pixel near `lngLat`, at the
// map's current zoom/pitch/bearing - measured empirically (project one pixel
// over, unproject, convert both ends to plane space) rather than computed
// from a tile-size constant, so it stays correct under pitch-induced local
// foreshortening too. Used to convert the hit-test radii and the minimum
// drag size (both naturally "a few screen pixels") into the plane units the
// pose itself is expressed in.
function planeUnitsPerScreenPixel(map: Map, lngLat: [number, number]): number {
  const screen = map.project(lngLat);
  const shifted = map.unproject([screen.x + 1, screen.y]);
  const p0 = lngLatToPlane(lngLat);
  const p1 = lngLatToPlane([shifted.lng, shifted.lat]);
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
}

function gizmoHitTestOptions(map: Map, pose: ImagePose): GizmoHitTestOptions {
  const unit = planeUnitsPerScreenPixel(map, planeToLngLat(pose.center));
  return { cornerRadius: 10 * unit, rotateRingWidth: 24 * unit };
}

function gizmoCursorForZone(kind: GizmoZone["kind"], fixedPivot: boolean): string {
  switch (kind) {
    // When the pivot is fixed, the body zone can't be dragged (see the
    // mousedown handler below) - "not-allowed" signals that instead of the
    // usual move cursor.
    case "body": return fixedPivot ? "not-allowed" : GIZMO_MOVE_CURSOR;
    case "corner": return GIZMO_RESIZE_CURSOR;
    case "rotate": return GIZMO_ROTATE_CURSOR;
    default: return "crosshair";
  }
}

// Many tile servers fall back to a "whole world" bounds value in their
// TileJSON when no real bounds were computed for that particular dataset
// (e.g. [-180, -85.05, 180, 85.05]). That's technically a valid 4-number
// array, but useless for "zoom to style bounds" - it just zooms out to the
// entire globe, so we treat it the same as "no bounds found".
function isWorldBounds(b: [number,number,number,number]): boolean {
  const [w, s, e, n] = b;
  return w <= -179 && e >= 179 && s <= -84 && n >= 84;
}

function getBoundsFromStyle(mapStyle: StyleSpecification): [number,number,number,number] | null {
  const root = (mapStyle as any).bounds;
  if (Array.isArray(root) && root.length === 4 && !isWorldBounds(root as [number, number, number, number])) return root as [number, number, number, number];
  for (const src of Object.values(mapStyle.sources || {})) {
    const b = (src as any).bounds;
    if (Array.isArray(b) && b.length === 4 && !isWorldBounds(b as [number, number, number, number])) return b as [number, number, number, number];
  }
  return null;
}

// Some styles (e.g. those pointing at api.getwemap.com) don't embed a
// `bounds` array in the style JSON itself - it only exists in the remote
// TileJSON their vector source's `url` points to. This keeps the existing,
// synchronous, inline-bounds behavior as the priority (so custom/manually
// authored styles keep working exactly as before), and only reaches out to
// the network as a fallback when nothing is found locally.
async function resolveStyleBounds(mapStyle: StyleSpecification, map: Map): Promise<[number,number,number,number] | null> {
  const inline = getBoundsFromStyle(mapStyle);
  if (inline) return inline;

  for (const [sourceId, src] of Object.entries(mapStyle.sources || {})) {
    const source = src as any;
    if (source.type !== "vector" || !source.url) continue;

    // MapLibre may already have resolved and cached the TileJSON on the
    // live source object - no need to fetch it again in that case.
    const liveSource = map.getSource(sourceId) as any;
    if (liveSource && Array.isArray(liveSource.bounds) && liveSource.bounds.length === 4 && !isWorldBounds(liveSource.bounds)) {
      return liveSource.bounds;
    }

    try {
      const response = await fetch(source.url);
      const tilejson = await response.json();
      if (Array.isArray(tilejson.bounds) && tilejson.bounds.length === 4 && !isWorldBounds(tilejson.bounds)) {
        return tilejson.bounds;
      }
    } catch (err) {
      console.warn(`Could not fetch bounds from ${source.url}`, err);
    }
  }

  // Last resort: no vector source gave us usable bounds (their TileJSON may
  // just report the "whole world" default). Fall back to computing a real
  // bounding box from an actual GeoJSON source's coordinates, if there is one.
  for (const src of Object.values(mapStyle.sources || {})) {
    const source = src as any;
    if (source.type !== "geojson" || typeof source.data !== "string") continue;

    try {
      const response = await fetch(source.data);
      const geojson = await response.json();
      const bounds = computeGeoJsonBounds(geojson);
      if (bounds) return bounds;
    } catch (err) {
      console.warn(`Could not fetch/parse GeoJSON from ${source.data}`, err);
    }
  }

  return null;
}

// Walks every coordinate in a GeoJSON Feature/FeatureCollection/geometry to
// compute its bounding box.
function computeGeoJsonBounds(geojson: any): [number,number,number,number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function walkCoords(coords: any) {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach(walkCoords);
    }
  }

  const features = geojson?.type === "FeatureCollection" ? geojson.features
    : geojson?.type === "Feature" ? [geojson]
    : geojson?.type ? [{geometry: geojson}]
    : [];

  features.forEach((feature: any) => {
    if (feature?.geometry?.coordinates) walkCoords(feature.geometry.coordinates);
  });

  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

function buildInspectStyle(originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[], highlightedLayer?: HighlightedLayer, activeLevel: number | null = null) {
  if (!originalMapStyle?.sources) return {version: 8, sources: {}, layers: []} as any;
  const backgroundLayer = {
    "id": "background",
    "type": "background",
    "paint": {
      "background-color": "#1a1a1a",
    }
  } as LayerSpecification;

  const sources: {[key:string]: SourceSpecification} = {};
  Object.keys(originalMapStyle.sources).forEach(sourceId => {
    const source = originalMapStyle.sources[sourceId];
    if(source.type !== "raster" && source.type !== "raster-dem") sources[sourceId] = source;
  });

  const coloredLayerIds = new Set(coloredLayers.map((l: any) => l.id));
  const missingLayers = (originalMapStyle.layers || [])
    .filter((l: any) => {
      if (!l.source) return false;
      const src = (originalMapStyle.sources || {})[l.source];
      if (!src || src.type === "raster" || src.type === "raster-dem") return false;
      return !coloredLayerIds.has(l.id) && !coloredLayerIds.has(l.id + "_inspect");
    })
    .map((l: any) => {
      const color = Color(colors.brightColor(l.id, 0.4)).desaturate(0.5).string();
      const paintProps: any = {};
      if (l.type === "fill") { paintProps["fill-color"] = color; paintProps["fill-outline-color"] = color; paintProps["fill-opacity"] = 0.3; }
      else if (l.type === "fill-extrusion") { paintProps["fill-extrusion-color"] = color; paintProps["fill-extrusion-opacity"] = 0.5; }
      else if (l.type === "line") { paintProps["line-color"] = color; paintProps["line-width"] = 1; }
      else if (l.type === "circle") { paintProps["circle-color"] = color; paintProps["circle-opacity"] = 0.5; }
      else if (l.type === "symbol") { paintProps["text-color"] = color; paintProps["icon-color"] = color; }
      const origFilter = l.filter ?? null;
      let layerFilter = origFilter;
      if (activeLevel !== null) {
        const lf: any = ["any", ["==", ["get", "level"], String(activeLevel)], ["all", ["has", "min_level"], ["has", "max_level"], [">=", activeLevel, ["get", "min_level"]], ["<=", activeLevel, ["get", "max_level"]]], ["!", ["has", "level"]]];
        layerFilter = origFilter ? ["all", origFilter, lf] : lf;
      }
      return { id: l.id + "_inspect", source: l.source, type: l.type, ...(l["source-layer"] ? {"source-layer": l["source-layer"]} : {}), ...(layerFilter ? {filter: layerFilter} : {}), paint: paintProps, layout: l.type === "symbol" ? {visibility: "visible"} : {} };
    });

  const allColoredLayers = [...coloredLayers, ...missingLayers];
  const highlightLayer = colorHighlightedLayer(highlightedLayer);
  if (highlightLayer) {
    if (activeLevel !== null) {
      const lf: any = ["any", ["==", ["get", "level"], String(activeLevel)], ["all", ["has", "min_level"], ["has", "max_level"], [">=", activeLevel, ["get", "min_level"]], ["<=", activeLevel, ["get", "max_level"]]], ["!", ["has", "level"]]];
      const orig = (highlightLayer as any).filter ?? null;
      (highlightLayer as any).filter = orig ? ["all", orig, lf] : lf;
    }
    allColoredLayers.push(highlightLayer as any);
  }

  return { ...originalMapStyle, sources, layers: [backgroundLayer].concat(allColoredLayers as LayerSpecification[]) };
}

type MapMaplibreGlInternalProps = {
  onDataChange?(event: {map: Map | null}): unknown
  onLayerSelect(index: number): void
  mapStyle: StyleSpecification
  mapView: {
    zoom: number,
    center: {
      lng: number,
      lat: number,
    },
    _from: "map" | "app"
  };
  inspectModeEnabled: boolean
  highlightedLayer?: HighlightedLayer
  // Set while a freshly-added image source is waiting for its placement
  // click on the map; onImagePlaced fires once that click lands, with the
  // source's coordinates already computed.
  pendingImagePlacement?: { sourceId: string; source: SourceSpecification } | null
  onImagePlaced?(sourceId: string, source: SourceSpecification): unknown
  // Set whenever the currently selected layer (via the Layers list) points
  // at an `image` source - this, not clicking the image on the map, is what
  // shows the gizmo (kept out of the map-click path deliberately, to avoid
  // accidental drags). null/undefined when no image layer is selected.
  selectedImageSource?: { sourceId: string; source: SourceSpecification } | null
  // Whether selectedImageSource's "Fix pivot" checkbox is checked (see
  // ImagePositionEditor) - when true, dragging a gizmo corner scales the
  // image around its own center (scalePoseFromCenter) instead of the
  // default opposite-corner anchor (scalePoseFromCorner).
  selectedImageFixedPivot?: boolean
  // Fired while dragging the gizmo (translate/scale/rotate), with the
  // source's coordinates already recomputed from the new pose. Drag-in-
  // progress updates pass {addRevision: false, save: false} so a drag
  // doesn't flood the undo history; the final update on mouseup uses the
  // default opts (a real, undoable revision) to commit the gesture as one
  // step.
  onImageSourceChanged?(sourceId: string, source: SourceSpecification, opts?: OnStyleChangedOpts): unknown
  options?: Partial<MapOptions> & {
    showTileBoundaries?: boolean
    showCollisionBoxes?: boolean
    showOverdrawInspector?: boolean
  }
  replaceAccessTokens(mapStyle: StyleSpecification): StyleSpecification
  onChange(value: {center: LngLat, zoom: number, _from: "map" | "app"}): unknown
} & WithTranslation;

type MapMaplibreGlState = {
  map: Map | null;
  inspect: MaplibreInspect | null;
  geocoder: MaplibreGeocoder | null;
  zoomControl: ZoomControl | null;
  levelControl: LevelControl | null;
  fitBoundsControl: FitBoundsControl | null;
  zoom?: number;
  // The selected image source's current pose, in screen pixels - recomputed
  // from its coordinates (via map.project()) whenever the selection or the
  // camera changes, and updated directly (for immediate visual feedback)
  // while dragging the gizmo. null when no image layer is selected.
  selectedImagePose: ImagePose | null;
  // Whether the selected image source's URL has finished loading - while
  // false, the gizmo shows a checkerboard placeholder fill (see
  // renderImageGizmo); once true, the fill drops out so the real rendered
  // image (drawn by maplibre itself, underneath the gizmo) isn't hidden by
  // it - only the selection border and center cross remain.
  selectedImageLoaded: boolean;
};

class MapMaplibreGlInternal extends React.Component<MapMaplibreGlInternalProps, MapMaplibreGlState> {
  static defaultProps = {
    onMapLoaded: () => {},
    onDataChange: () => {},
    onLayerSelect: () => {},
    onChange: () => {},
    options: {} as MapOptions,
  };
  container: HTMLDivElement | null = null;
  _levelControl: LevelControl | null = null;
  // Aspect ratio (width/height) used for the default size of a pending image
  // placement, updated asynchronously once the image itself has loaded.
  // Falls back to 1 (square) until then, or if it never loads in time - see
  // defaultImageSize in libs/image-position.ts.
  _pendingImageAspectRatio = 1;
  _pendingImagePlacementUrl: string | null = null;
  // Tracks which URL selectedImageLoaded currently reflects, so a load that
  // resolves after the selection/url has already moved on is ignored.
  _selectedImageLoadUrl: string | null = null;
  // The gizmo drag currently in progress (translate/scale/rotate), if any -
  // captured at mousedown and consumed by every mousemove until mouseup.
  // Always recomputed from this fixed drag-start snapshot, not
  // incrementally from the previous frame's pose, so there's no drift over
  // a long drag.
  _activeGizmoDrag: {
    kind: "body" | "corner" | "rotate";
    corner: CornerIndex | null;
    startPose: ImagePose;
    startPoint: Point;
    startAngle: number;
  } | null = null;
  // A gizmo pose computed by applyGizmoDrag, waiting to be committed to
  // state by the map's own "render" event (see componentDidMount) rather
  // than immediately from the mousemove handler that computed it - see the
  // note there for why.
  _pendingGizmoPose: ImagePose | null = null;

  constructor(props: MapMaplibreGlInternalProps) {
    super(props);
    this.state = {
      map: null,
      inspect: null,
      geocoder: null,
      zoomControl: null,
      levelControl: null,
      fitBoundsControl: null,
      selectedImagePose: null,
      selectedImageLoaded: false,
    };
    i18next.on("languageChanged", () => {
      this.forceUpdate();
    });
  }


  shouldComponentUpdate(nextProps: MapMaplibreGlInternalProps, nextState: MapMaplibreGlState) {
    let should = false;
    try {
      should = JSON.stringify(this.props) !== JSON.stringify(nextProps)
        || this.state.zoom !== nextState.zoom
        || this.state.selectedImagePose !== nextState.selectedImagePose
        || this.state.selectedImageLoaded !== nextState.selectedImageLoaded;
    } catch(_e) {
      // no biggie, carry on
    }
    return should;
  }

  // Recomputes the selected image source's pose (in Mercator plane space -
  // see the note above lngLatToPlane) from its coordinates. Called whenever
  // the selection changes and whenever the camera moves - the pose itself
  // doesn't depend on the camera, but selectedImageSource can arrive before
  // the map has finished loading, so this re-derives it once the map is
  // ready too. Clears it (rather than leaving a stale pose) whenever
  // there's no map yet, no image layer selected, the source turns out not
  // to be an `image` source after all, or inspect mode is active - the
  // gizmo isn't meant to be used there (dragging it fights maplibre-gl-
  // inspect's own style handling and made the whole viewer flicker), and a
  // null pose here is what turns off the gizmo everywhere else (rendering,
  // cursors, hit-testing in mousedown) without having to gate each of them
  // individually.
  updateSelectedImagePose = () => {
    const map = this.state.map;
    const selected = this.props.selectedImageSource;
    if (!map || !selected || selected.source.type !== "image" || this.props.inspectModeEnabled) {
      if (this.state.selectedImagePose !== null) {
        this.setState({ selectedImagePose: null });
      }
      return;
    }

    const corners = selected.source.coordinates.map(lngLat => lngLatToPlane(lngLat)) as Corners;
    const pose = poseFromCorners(corners);

    // Same synchronization concern as the drag path (see the map.on(
    // "render", ...) listener in componentDidMount): committing this
    // directly would let React's commit land a frame ahead of or behind the
    // map's own WebGL redraw - barely noticeable for a one-off recompute,
    // but "move" fires repeatedly while the camera is actively panning/
    // rotating, which is exactly when that drift became visible (gizmo box
    // and cross trailing the image). Route it through the same pending-pose
    // + "render" handshake the drag path uses instead, and explicitly ask
    // for a repaint - unlike a drag's setCoordinates() call, just
    // recomputing the pose here doesn't itself schedule one.
    this._pendingGizmoPose = pose;
    map.triggerRepaint();
  };

  // Converts a pose (Mercator plane space) to a source's `coordinates`
  // (lng/lat), corner by corner - individually, not as one uniform
  // scale/offset, so Mercator distortion (already handled by
  // MercatorCoordinate) is accounted for correctly.
  poseToCoordinates(pose: ImagePose): [[number, number], [number, number], [number, number], [number, number]] {
    return cornersFromPose(pose).map(planeToLngLat) as [[number, number], [number, number], [number, number], [number, number]];
  }

  // Scans the style's layers from topmost (last in the array - what actually
  // renders on top, so it's what a click should "see" first) down to the
  // bottom, looking for one whose source is an `image` source whose on-map
  // quad (in plane space, same as the gizmo's own hit-testing) contains
  // `planePoint`. Returns that layer's index, or null if the click missed
  // every image layer. This is what lets a click select an *unselected*
  // image - otherwise the only way to reach one is finding it by hand in a
  // (possibly long) Layers list, which doesn't even show which entries are
  // images.
  findTopmostImageLayerAt(planePoint: Point): number | null {
    const style = this.props.mapStyle;
    const layers = style.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i] as {source?: string};
      const sourceId = layer.source;
      if (!sourceId) continue;
      const source = style.sources?.[sourceId];
      if (!source || source.type !== "image") continue;
      const corners = source.coordinates.map(lngLat => lngLatToPlane(lngLat)) as Corners;
      if (pointInQuad(corners, planePoint)) return i;
    }
    return null;
  }

  // Applies one tick of an in-progress gizmo drag: recomputes the pose from
  // the fixed drag-start snapshot and the current pointer position - both in
  // plane space, like the pose itself - (never incrementally from the
  // previous tick, so there's no drift over a long drag), updates the gizmo
  // immediately for instant visual feedback, and reports the resulting
  // coordinates upstream as a non-undoable, unsaved intermediate update (see
  // onImageSourceChanged's docstring).
  applyGizmoDrag = (planePoint: Point) => {
    const drag = this._activeGizmoDrag;
    const selected = this.props.selectedImageSource;
    const map = this.state.map;
    if (!drag || !selected || !map) return;

    let newPose: ImagePose;
    switch (drag.kind) {
      case "body":
        newPose = translatePose(drag.startPose, planePoint[0] - drag.startPoint[0], planePoint[1] - drag.startPoint[1]);
        break;
      case "corner": {
        // A "don't shrink past this" floor of ~4 screen pixels wide/tall -
        // scalePoseFromCorner/scalePoseFromCenter's own default epsilon is
        // calibrated for screen-pixel-scale poses, not the much smaller
        // plane-space numbers a real-world image footprint has here.
        const minSize = 4 * planeUnitsPerScreenPixel(map, planeToLngLat(drag.startPose.center));
        const scaleFn = this.props.selectedImageFixedPivot ? scalePoseFromCenter : scalePoseFromCorner;
        newPose = scaleFn(drag.startPose, drag.corner!, planePoint, { minSize });
        break;
      }
      case "rotate": {
        const angleNow = angleTo(drag.startPose.center, planePoint);
        newPose = { ...drag.startPose, rotation: drag.startPose.rotation + (angleNow - drag.startAngle) };
        break;
      }
    }

    const coordinates = this.poseToCoordinates(newPose);

    // Update the actual on-map image immediately, independent of the normal
    // React round-trip (setState here -> App's onImageSourceChanged ->
    // mapStyle prop -> componentDidUpdate -> map.setStyle(..., {diff:
    // true})) - that path re-diffs the *entire* style on every tick, which
    // is too slow to keep up with a fast drag (see componentDidUpdate's own
    // note), so the image visibly lagged behind the gizmo until the mouse
    // slowed down. ImageSource.setCoordinates is the cheap, purpose-built
    // path for exactly this: a GPU-only quad update, no style reparse.
    // componentDidUpdate skips its own map.setStyle call while a gizmo drag
    // is active (see the `_activeGizmoDrag` check there), so this is the
    // only thing moving the image during the drag itself - the normal
    // setStyle flow (still triggered by the onImageSourceChanged call
    // below, for mapStyle/undo/the Image Position panel) catches up once
    // the drag ends. This schedules the actual WebGL redraw on the map's
    // own next animation frame (via triggerRepaint internally) - it is NOT
    // synchronous, which is why the gizmo's own update (below) is deferred
    // to that same frame too, rather than committed here.
    const liveSource = map.getSource(selected.sourceId) as ImageSource | undefined;
    liveSource?.setCoordinates(coordinates);

    // Deliberately NOT a direct/flushSync'd setState here (tried first, see
    // the map.on("render", ...) listener in componentDidMount for why it
    // still lagged): committing the gizmo's new pose straight from this
    // mousemove handler races the image's own update above, since that one
    // only actually redraws on the map's next animation frame. The two were
    // landing in different frames, however synchronously we committed the
    // gizmo's DOM here. Stashing the pose and letting the "render" event -
    // which fires once per frame, right as that same animation frame
    // finishes drawing the image - pick it up guarantees both are drawn
    // from the exact same frame, every time.
    this._pendingGizmoPose = newPose;

    this.props.onImageSourceChanged?.(selected.sourceId, {
      ...selected.source,
      coordinates,
    } as SourceSpecification, { addRevision: false, save: false });
  };

  // Ends the current gizmo drag (if any): restores normal map panning, and
  // commits the final pose as one real, undoable revision - the drag's many
  // intermediate updates (above) never touched the undo history, so this is
  // the single step "undo" will step back through.
  endGizmoDrag = () => {
    if (!this._activeGizmoDrag) return;
    this._activeGizmoDrag = null;
    const map = this.state.map;
    map?.dragPan.enable();

    const selected = this.props.selectedImageSource;
    // Prefer a pose still waiting for the map's "render" event (see
    // applyGizmoDrag/the "render" listener) over state.selectedImagePose,
    // which that event hasn't necessarily had a chance to commit yet if the
    // mouse was released right after the last mousemove tick - using the
    // stale one here would make coordinates below lag one tick behind what
    // the live map source already has (see setCoordinates just below), and
    // that mismatch is exactly what forces the destructive remove+add
    // flicker this whole thing is trying to avoid.
    const finalPose = this._pendingGizmoPose ?? this.state.selectedImagePose;
    this._pendingGizmoPose = null;

    if (selected && finalPose) {
      const coordinates = this.poseToCoordinates(finalPose);

      // Make the live map source match *exactly* what's about to be sent
      // to onStyleChanged below, before that happens - since Style.setState
      // diffs the new style against the live source's own serialize() (see
      // ImageSource.serialize/setCoordinates), not some separately-cached
      // "last known" JSON, any mismatch here - however small - makes
      // MapLibre think this source actually changed. Image sources have no
      // in-place update path in diffStyles (unlike geojson's
      // setGeoJSONSourceData), so that "change" is handled by removing and
      // re-adding the source and its raster layer - a real, visible reload
      // - right as the now-unguarded componentDidUpdate lets the full
      // map.setStyle(..., {diff:true}) call through again (see the
      // `_activeGizmoDrag` check there). Keeping the two in exact sync
      // here is what lets the diff see no change for this source and skip
      // that path entirely.
      const liveSource = map?.getSource(selected.sourceId) as ImageSource | undefined;
      liveSource?.setCoordinates(coordinates);

      if (this.state.selectedImagePose !== finalPose) {
        this.setState({ selectedImagePose: finalPose });
      }

      this.props.onImageSourceChanged?.(selected.sourceId, {
        ...selected.source,
        coordinates,
      } as SourceSpecification);
    }
  };

  onWindowMouseUp = () => {
    if (this._activeGizmoDrag) {
      this.endGizmoDrag();
    }
    this.restoreInspectPopup();
  };

  // Any click that lands on an image - whether it grabs the currently
  // selected image's gizmo, or hits a different, not-yet-selected image to
  // select it - would otherwise also trigger maplibre-gl-inspect's own
  // "which layers are here" popup, which visually overlaps/crops the image
  // and gizmo. inspect.options.showMapPopup is re-read live on every
  // click/mousemove by that library, so flipping it off here for the
  // duration of this gesture suppresses it without touching its internals.
  suppressInspectPopupUntilGestureEnd = () => {
    const inspect = this.state.inspect;
    if (inspect) inspect.options.showMapPopup = false;
  };

  // Restores the inspect popup once this gesture is fully done. Scheduled
  // for the *next* tick (not run synchronously) because MapLibre's own
  // "click" event fires synchronously as part of the same mousedown/mouseup
  // processing chain - restoring immediately here would already be too late
  // to suppress it. Called from mouseup/onWindowMouseUp (the end of the
  // gesture), never from mousedown, since a drag can span arbitrary real
  // time between the two. Harmless to call when nothing was suppressed.
  restoreInspectPopup = () => {
    const inspect = this.state.inspect;
    if (!inspect) return;
    setTimeout(() => {
      inspect.options.showMapPopup = true;
    }, 0);
  };

  componentDidUpdate(prevProps: MapMaplibreGlInternalProps) {
    if (
      this.props.selectedImageSource !== prevProps.selectedImageSource
      || this.props.inspectModeEnabled !== prevProps.inspectModeEnabled
    ) {
      this.updateSelectedImagePose();

      const url = (this.props.selectedImageSource?.source as {url?: string} | undefined)?.url ?? null;
      if (url !== this._selectedImageLoadUrl) {
        this._selectedImageLoadUrl = url;
        this.setState({ selectedImageLoaded: false });
        if (url) {
          const img = new Image();
          img.onload = () => {
            if (this._selectedImageLoadUrl === url) this.setState({ selectedImageLoaded: true });
          };
          img.onerror = () => {
            if (this._selectedImageLoadUrl === url) this.setState({ selectedImageLoaded: false });
          };
          img.src = url;
        }
      }
    }

    if (this.props.pendingImagePlacement && this.props.pendingImagePlacement !== prevProps.pendingImagePlacement) {
      const url = (this.props.pendingImagePlacement.source as {url?: string}).url;
      this._pendingImageAspectRatio = 1;
      this._pendingImagePlacementUrl = url ?? null;
      if (url) {
        const img = new Image();
        img.onload = () => {
          // Ignore a load that resolves after the user has already moved on
          // to placing a different image (or cancelled).
          if (this._pendingImagePlacementUrl === url && img.naturalWidth > 0 && img.naturalHeight > 0) {
            this._pendingImageAspectRatio = img.naturalWidth / img.naturalHeight;
          }
        };
        img.src = url;
      }
    }

    const map = this.state.map;
    const styleWithTokens = this.props.replaceAccessTokens(this.props.mapStyle);
    const styleChanged = this.props.mapStyle !== prevProps.mapStyle;
    const inspectJustActivated = this.props.inspectModeEnabled && !prevProps.inspectModeEnabled;
    const highlightChanged = this.props.highlightedLayer !== prevProps.highlightedLayer;

    if (map) {
      // Skipped while a gizmo drag is in progress: applyGizmoDrag already
      // moves the actual image live via ImageSource.setCoordinates (a cheap
      // GPU-only update), and re-diffing/re-applying the *entire* style on
      // every single mousemove tick here on top of that would defeat the
      // point - it's a comparatively expensive call, so doing it every tick
      // is what caused the image to lag behind the gizmo until the mouse
      // slowed down. endGizmoDrag clears _activeGizmoDrag before its own
      // onImageSourceChanged call, so the normal setStyle flow still runs
      // (and catches the final position) right after the drag ends.
      if (!this.props.inspectModeEnabled && !this._activeGizmoDrag) {
        const activeLevel = this._levelControl?._activeLevel ?? null;
        const filtered = applyLevelFilter(styleWithTokens, activeLevel);
        map.setStyle(filtered, {diff: true});
      }
      map.showTileBoundaries = this.props.options?.showTileBoundaries!;
      map.showCollisionBoxes = this.props.options?.showCollisionBoxes!;
      map.showOverdrawInspector = this.props.options?.showOverdrawInspector!;
      if (this.props.mapView._from === "app") map.jumpTo(this.props.mapView);
    }

    if (this.state.inspect && this.props.inspectModeEnabled !== this.state.inspect._showInspectMap) {
      this.state.inspect.setOriginalStyle(styleWithTokens);
      this.state.inspect.toggleInspector();
      // Au retour en mode normal, réappliquer le filtre level immédiatement
      if (!this.props.inspectModeEnabled && map && this._levelControl && this._levelControl._activeLevel !== null) {
        const activeLevel = this._levelControl._activeLevel;
        map.once("styledata", () => {
          this._levelControl?.onLevelChange?.(activeLevel);
        });
      }
    }

    if (map && this.props.inspectModeEnabled && (styleChanged || highlightChanged || inspectJustActivated)) {
      if (!styleWithTokens.sources) return;
      const sourcesChanged = this.props.mapStyle.sources !== prevProps.mapStyle.sources;
      const layerCountChanged = this.props.mapStyle.layers.length !== prevProps.mapStyle.layers.length;
      const activeLevel = this._levelControl?._activeLevel ?? null;
      const inspectStyle = buildInspectStyle(styleWithTokens, [], this.props.highlightedLayer, activeLevel);
      map.setStyle(inspectStyle, {diff: !inspectJustActivated && !sourcesChanged && !layerCountChanged});
    }

  }

  componentDidMount() {
    const mapOpts = {
      ...this.props.options,
      container: this.container!,
      style: this.props.mapStyle,
      hash: true,
      maxZoom: 24,
      transformRequest: (url) => {
        if (url.startsWith("/")) {
          url = `${window.location.origin}${url}`;
        }
        return { url };
      },
      // setting to always load glyphs of CJK fonts from server
      // https://maplibre.org/maplibre-gl-js/docs/examples/local-ideographs/
      localIdeographFontFamily: false
    } satisfies MapOptions;

    const protocol = new Protocol({metadata: true});
    MapLibreGl.addProtocol("pmtiles",protocol.tile);
    const map = new MapLibreGl.Map(mapOpts);

    const mapViewChange = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      this.props.onChange({center, zoom, _from: "map"});
    };
    mapViewChange();

    map.showTileBoundaries = mapOpts.showTileBoundaries!;
    map.showCollisionBoxes = mapOpts.showCollisionBoxes!;
    map.showOverdrawInspector = mapOpts.showOverdrawInspector!;

    const geocoder = this.initGeocoder(map);

    const zoomControl = new ZoomControl();
    map.addControl(zoomControl, "top-right");

    const nav = new MapLibreGl.NavigationControl({visualizePitch:true});
    map.addControl(nav, "top-right");

    const levelControl = new LevelControl();
    map.addControl(levelControl, "top-right");

    const fitBoundsControl = new FitBoundsControl();
    map.addControl(fitBoundsControl, "top-right");

    const tmpNode = document.createElement("div");
    const root = createRoot(tmpNode);

    const inspectPopup = new MapLibreGl.Popup({
      closeOnClick: false
    });

    const inspect = new MaplibreInspect({
      popup: inspectPopup,
      showMapPopup: true,
      showMapPopupOnHover: false,
      showInspectMapPopupOnHover: true,
      showInspectButton: false,
      blockHoverPopupOnClick: true,
      assignLayerColor: (layerId: string, alpha: number) => {
        return Color(colors.brightColor(layerId, alpha)).desaturate(0.5).string();
      },
      buildInspectStyle: (originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[]) => buildInspectStyle(originalMapStyle, coloredLayers, this.props.highlightedLayer, this._levelControl?._activeLevel ?? null),
      renderPopup: (features: InspectFeature[]) => {
        if(this.props.inspectModeEnabled) {
          inspectPopup.once("open", () => {
            root.render(<MapMaplibreGlFeaturePropertyPopup features={features} />);
          });
          return tmpNode;
        } else {
          inspectPopup.once("open", () => {
            root.render(<MapMaplibreGlLayerPopup
              features={features}
              onLayerSelect={this.onLayerSelectById}
              zoom={this.state.zoom}
            />,);
          });
          return tmpNode;
        }
      }
    });
    map.addControl(inspect);

    map.on("style.load", () => {
      this.setState({ map, inspect, geocoder, zoomControl, levelControl, fitBoundsControl, zoom: map.getZoom() }, () => {
        this.updateSelectedImagePose();
      });

      fitBoundsControl.onFitBounds = () => {
        resolveStyleBounds(this.props.mapStyle, map).then(bounds => {
          if (bounds) map.fitBounds(bounds, {padding: 40});
        });
      };

      this._levelControl = levelControl;
      levelControl.onLevelChange = (level: number | null) => {
        const styleWithTokens = this.props.replaceAccessTokens(this.props.mapStyle);
        if (this.props.inspectModeEnabled) {
          const inspectStyle = buildInspectStyle(styleWithTokens, [], this.props.highlightedLayer, level);
          map.setStyle(inspectStyle, {diff: true});
        } else {
          const filtered = applyLevelFilter(styleWithTokens, level);
          map.setStyle(filtered, {diff: true});
        }
      };
    });

    map.on("data", e => {
      if(e.dataType !== "tile") return;
      this.props.onDataChange!({
        map: this.state.map
      });
    });

    map.on("error", e => {
      console.log("ERROR", e);
    });

    map.on("zoom", _e => {
      this.setState({
        zoom: map.getZoom()
      });
    });

    // Keeps the selected image's gizmo pose in sync with panning/zooming -
    // its screen position/size are re-projected from the source's lng/lat
    // corners on every camera move.
    map.on("move", () => this.updateSelectedImagePose());

    // A screen point (as mouse events hand out) converted to the same plane
    // space the pose lives in - see the note above lngLatToPlane.
    const toPlanePoint = (screenPoint: Point): Point => {
      const lngLat = map.unproject(screenPoint);
      return lngLatToPlane([lngLat.lng, lngLat.lat]);
    };

    // Hover-only feedback for the selected image's gizmo (no permanent
    // handles are drawn - see renderImageGizmo): move/resize/rotate cursors
    // depending on which zone the pointer is over, computed straight from
    // the pose via hitTestGizmo. Falls back to the map's own
    // panning/crosshair cursors when nothing is selected.
    const applyCursorAt = (screenPoint: Point) => {
      const pose = this.state.selectedImagePose;
      map.getCanvas().style.cursor = pose
        ? gizmoCursorForZone(hitTestGizmo(pose, toPlanePoint(screenPoint), gizmoHitTestOptions(map, pose)).kind, !!this.props.selectedImageFixedPivot)
        : "crosshair";
    };

    map.on("mousedown", e => {
      // The gizmo isn't offered in inspect mode (see updateSelectedImagePose
      // for why) - selectedImagePose is already forced null there, which
      // rules out the "grab the gizmo" branch below on its own, but the
      // "click an unselected image to select it" branch further down isn't
      // gated by pose, and would otherwise still suppress maplibre-gl-
      // inspect's own "which layers are here" popup on every such click.
      // Bail out up front instead, so a click in inspect mode is left
      // entirely to inspect's own handling.
      if (this.props.inspectModeEnabled) return;

      const pose = this.state.selectedImagePose;
      const screenPoint: Point = [e.point.x, e.point.y];
      const planePoint = toPlanePoint(screenPoint);

      if (pose) {
        const zone = hitTestGizmo(pose, planePoint, gizmoHitTestOptions(map, pose));
        // When the pivot is fixed (see ImagePositionEditor's "Fix pivot"),
        // the whole point is that the pivot can't move - so unlike corner
        // (resize, already anchored on the pivot via scalePoseFromCenter)
        // and rotate (already pivots on center), the body zone is treated
        // as ungrabbable here, same as missing the gizmo entirely: the
        // click falls through below and the map pans underneath it as
        // usual, instead of translating the image.
        const bodyLocked = zone.kind === "body" && this.props.selectedImageFixedPivot;
        if (zone.kind !== "none" && !bodyLocked) {
          // Grabbing the gizmo itself - take over the drag instead of
          // letting the map pan underneath it, and hide the inspect popup
          // for this click (see suppressInspectPopupUntilGestureEnd).
          this.suppressInspectPopupUntilGestureEnd();
          map.dragPan.disable();
          this._activeGizmoDrag = {
            kind: zone.kind,
            corner: zone.kind === "corner" || zone.kind === "rotate" ? zone.corner : null,
            startPose: pose,
            startPoint: planePoint,
            startAngle: zone.kind === "rotate" ? angleTo(pose.center, planePoint) : 0,
          };
          return;
        }
      }

      // Nothing selected, or the click missed the selected image's gizmo:
      // look for another image layer under the pointer (topmost wins if
      // several overlap) and select it outright. A first click on an
      // unselected image has no gizmo yet to grab, so it can only ever
      // select, never start a drag - dragging only becomes possible once
      // it's selected and this handler is re-entered on a later click.
      // Suppress the inspect popup here too: any click landing on an image,
      // selected or not, would otherwise pop it open over the gizmo.
      const hitLayerIndex = this.findTopmostImageLayerAt(planePoint);
      if (hitLayerIndex !== null) {
        this.suppressInspectPopupUntilGestureEnd();
        this.props.onLayerSelect(hitLayerIndex);
        return;
      }

      map.getCanvas().style.cursor = "move";
    });

    map.on("mouseup", e => {
      if (this._activeGizmoDrag) {
        this.endGizmoDrag();
      }
      this.restoreInspectPopup();
      applyCursorAt([e.point.x, e.point.y]);
    });

    // Commits a gizmo pose queued by either applyGizmoDrag or
    // updateSelectedImagePose (see their own notes) right as this same
    // animation frame finishes actually drawing the map - "render" fires
    // once per frame, synchronously at the end of that frame's draw, so
    // flushSync-ing the gizmo's state update from inside it lands in the
    // very same frame as the map update that triggered this render in the
    // first place. Cheap to leave registered permanently: most frames (no
    // drag or camera move in progress, or nothing new since the last one)
    // it's just a null check.
    map.on("render", () => {
      const pose = this._pendingGizmoPose;
      if (!pose) return;
      this._pendingGizmoPose = null;
      flushSync(() => {
        this.setState({ selectedImagePose: pose });
      });
    });

    map.on("mousemove", e => {
      const screenPoint: Point = [e.point.x, e.point.y];
      if (this._activeGizmoDrag) {
        this.applyGizmoDrag(toPlanePoint(screenPoint));
        return;
      }
      // While the mouse button is held with nothing selected/grabbed, this
      // is a map pan in progress - leave the "move" cursor alone until
      // mouseup.
      if (map.getCanvas().style.cursor === "move") return;
      applyCursorAt(screenPoint);
    });

    // Safety net: if the button is released outside the map canvas (or the
    // window loses the mouseup event some other way), still end the drag
    // and re-enable panning rather than leaving it stuck.
    window.addEventListener("mouseup", this.onWindowMouseUp);

    map.on("dragend", mapViewChange);
    map.on("zoomend", mapViewChange);

    map.on("click", e => {
      const pending = this.props.pendingImagePlacement;
      if (!pending) return;

      // Built directly in plane space (like every other pose in this file),
      // not in screen pixels then unprojected corner-by-corner - the latter
      // is what caused the placement to come out slightly non-rectangular
      // under any pitch (a screen-space rectangle isn't a real rectangle on
      // the ground once tilted). Rotation is set to the map's current
      // bearing (a single, pitch-independent camera property) so the box
      // still looks screen-upright at the moment it's placed, exactly like
      // the old screen-space version did "for free" - without that, moving
      // the math to plane space would leave the box aligned to true north
      // instead, looking rotated whenever the map isn't facing north.
      const screenPoint: Point = [e.point.x, e.point.y];
      const lngLat = map.unproject(screenPoint);
      const centerLngLat: [number, number] = [lngLat.lng, lngLat.lat];
      const unit = planeUnitsPerScreenPixel(map, centerLngLat);
      const viewportWidth = map.getContainer().clientWidth;
      const {width, height} = defaultImageSize(viewportWidth, this._pendingImageAspectRatio);
      const pose: ImagePose = {
        center: lngLatToPlane(centerLngLat),
        width: width * unit,
        height: height * unit,
        rotation: map.getBearing() * Math.PI / 180,
      };

      this.props.onImagePlaced?.(pending.sourceId, {
        ...pending.source,
        coordinates: this.poseToCoordinates(pose),
      } as SourceSpecification);
    });
  }

  componentWillUnmount() {
    window.removeEventListener("mouseup", this.onWindowMouseUp);
  }

  onLayerSelectById = (id: string) => {
    const index = this.props.mapStyle.layers.findIndex(layer => layer.id === id);
    this.props.onLayerSelect(index);
  };

  initGeocoder(map: Map) {
    const geocoderConfig = {
      forwardGeocode: async (config: MaplibreGeocoderApiConfig) => {
        const features = [];
        try {
          const request = `https://nominatim.openstreetmap.org/search?q=${config.query}&format=geojson&polygon_geojson=1&addressdetails=1`;
          const response = await fetch(request);
          const geojson = await response.json();
          for (const feature of geojson.features) {
            const center = [
              feature.bbox[0] +
                  (feature.bbox[2] - feature.bbox[0]) / 2,
              feature.bbox[1] +
                  (feature.bbox[3] - feature.bbox[1]) / 2
            ];
            const point = {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: center
              },
              place_name: feature.properties.display_name,
              properties: feature.properties,
              text: feature.properties.display_name,
              place_type: ["place"],
              center
            };
            features.push(point);
          }
        } catch (e) {
          console.error(`Failed to forwardGeocode with error: ${e}`);
        }
        return {
          features
        };
      },
    } as unknown as MaplibreGeocoderApi;
    const geocoder = new MaplibreGeocoder(geocoderConfig, {
      placeholder: this.props.t("Search"),
      maplibregl: MapLibreGl,
    });
    map.addControl(geocoder, "top-left");
    return geocoder;
  }

  // The gizmo is purely decorative (pointer-events: none) - all hover/drag
  // interaction happens via the map's own canvas events + hitTestGizmo
  // (above), never through this overlay itself. That's deliberate: it's
  // what keeps "no permanent visible handles, hover-only cursor feedback"
  // true without needing a second, DOM-based hit-testing path to keep in
  // sync with the geometry-based one.
  //
  // Drawn as an SVG polygon over the 4 corners' actual screen positions
  // (pose corners -> lng/lat -> map.project()), not a CSS-rotated rectangle:
  // the pose lives in flat plane space (see lngLatToPlane), so under any
  // pitch its on-screen shape is a general trapezoid, not a rectangle - a
  // CSS transform can't draw that, but an SVG polygon can. The center cross,
  // by contrast, is drawn straight in screen space (see the note inside
  // renderImageGizmo) - its angle still comes from the box's projected
  // corners, so it still rotates to match, but its length is a fixed 20
  // screen pixels rather than being computed through plane space too.
  renderImageGizmo() {
    const pose = this.state.selectedImagePose;
    const map = this.state.map;
    if (!pose || !map) return null;

    const projectedCorners = cornersFromPose(pose).map(corner => map.project(planeToLngLat(corner)));
    const screenCorners = projectedCorners.map(p => `${p.x},${p.y}`).join(" ");

    // The center cross's 4 arm endpoints are computed in plane space (like
    // the box's own corners just above), each rotated by the pose's actual
    // rotation via crossArmsFromPose, then projected to screen individually
    // - NOT derived after the fact from the box's already-projected screen
    // corners. Tried two screen-space shortcuts before this: a single
    // shared angle (+90° for the second arm) drifted off the box's true
    // axes under pitch, since projection shears the two edges unevenly:
    // fixed by switching to each edge's own projected direction - but that
    // version scaled each arm's length off the box's own on-screen
    // width/height directly, which put a real quad's sometimes-extreme
    // perspective foreshortening straight into the cross, making it warp
    // far more than a small locator glyph should. Projecting 4
    // individually-computed plane-space points sidesteps that: each point
    // still goes through the exact same map.project the box uses (so it
    // still tilts/rotates correctly with the view), but the cross's own
    // shape in plane space is always a perfect right-angle - the box's
    // dimensions only ever feed into the single scalar target length
    // below, never into the cross's shape/rotation itself, so they can't
    // distort it.
    //
    // Target length: a ratio of the box's own on-screen size (the smaller
    // of its projected width/height), not a fixed screen-pixel count - so
    // the cross scales with the gizmo, and as a side effect no longer
    // relies on treating planeUnitsPerScreenPixel's center-only
    // approximation as an exact constant (which is what made a nominally
    // "fixed 20px" cross subtly change size as the box moved around the
    // screen or the view tilted). Floored so it doesn't vanish on a
    // tiny/zoomed-out box.
    const [cornerTL, cornerTR, , cornerBL] = projectedCorners;
    const screenWidth = Math.hypot(cornerTR.x - cornerTL.x, cornerTR.y - cornerTL.y);
    const screenHeight = Math.hypot(cornerBL.x - cornerTL.x, cornerBL.y - cornerTL.y);
    const crossArmLengthPx = Math.max(4, 0.15 * Math.min(screenWidth, screenHeight));
    const unitAtCenter = planeUnitsPerScreenPixel(map, planeToLngLat(pose.center));
    const armLength = crossArmLengthPx * unitAtCenter;
    const [xNeg, xPos, yNeg, yPos] = crossArmsFromPose(pose, armLength)
      .map(p => map.project(planeToLngLat(p)));

    return <svg className="maputnik-image-gizmo" width="100%" height="100%">
      <defs>
        <pattern id="maputnik-image-gizmo-checkerboard" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#2f2f2f" />
          <rect width="10" height="10" fill="#232323" />
          <rect x="10" y="10" width="10" height="10" fill="#232323" />
        </pattern>
      </defs>
      <polygon
        points={screenCorners}
        fill={this.state.selectedImageLoaded ? "none" : "url(#maputnik-image-gizmo-checkerboard)"}
        stroke="rgba(86, 86, 86, 0.85)"
        strokeWidth={1.5}
      />
      <g stroke="#565656" strokeWidth={1.8} strokeLinecap="round">
        <line x1={xNeg.x} y1={xNeg.y} x2={xPos.x} y2={xPos.y} />
        <line x1={yNeg.x} y1={yNeg.y} x2={yPos.x} y2={yPos.y} />
      </g>
    </svg>;
  }

  render() {
    const t = this.props.t;
    this.state.geocoder?.setPlaceholder(t("Search"));
    this.state.zoomControl?.setLabel(t("Zoom:"));
    return <div className="maputnik-map__wrapper">
      <div
        className="maputnik-map__map"
        role="region"
        aria-label={t("Map view")}
        ref={x => {this.container = x;}}
        data-wd-key="maplibre:map"
      ></div>
      {this.renderImageGizmo()}
    </div>;
  }
}

const MapMaplibreGl = withTranslation()(MapMaplibreGlInternal);
export default MapMaplibreGl;
