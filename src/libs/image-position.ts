/**
 * Pure geometry for positioning an `image` source: converting between a
 * human-friendly "pose" (center + size + rotation) and the 4-corner
 * `coordinates` array the style spec actually stores, plus the hit-testing
 * and drag math behind the on-map gizmo (translate / scale / rotate).
 *
 * Everything here is projection-agnostic: it works in whatever flat 2D
 * space the caller hands it (map-projected pixels during interaction, or
 * any other Cartesian plane) - it knows nothing about lng/lat or MapLibre.
 * Converting to/from real map coordinates (via `map.project()` /
 * `map.unproject()`) is the job of the map-integration layer that calls
 * into this module, not this module itself. That's deliberate: it's what
 * lets the interaction/rendering side be restyled or reworked later
 * without touching this math.
 */

export type Point = [number, number];

/** A rectangular image placement. `rotation` is in radians; positive values
 * rotate clockwise on screen (`x' = x·cosθ − y·sinθ, y' = x·sinθ + y·cosθ`,
 * which is the standard rotation matrix - visually clockwise because screen
 * y points down). */
export type ImagePose = {
  center: Point;
  width: number;
  height: number;
  rotation: number;
};

/** Corner order matches the style spec's `image`/`video` source
 * `coordinates`: top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point];

export type CornerIndex = 0 | 1 | 2 | 3;

/** Local (unrotated, center-relative) sign of each corner - e.g. top-left is
 * up and to the left of center, so `[-1, -1]`. Also doubles as the sign of
 * a corner *relative to its opposite corner*, which is what
 * {@link scalePoseFromCorner} needs. */
const CORNER_SIGNS: [number, number][] = [
  [-1, -1], // top-left
  [1, -1],  // top-right
  [1, 1],   // bottom-right
  [-1, 1],  // bottom-left
];

function rotatePoint([x, y]: Point, rotation: number): Point {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Rotates {@link point} by {@link -rotation} around {@link pose}'s center,
 * i.e. expresses it in the box's own unrotated, center-relative frame. */
function toLocalFrame(pose: ImagePose, point: Point): Point {
  const rel: Point = [point[0] - pose.center[0], point[1] - pose.center[1]];
  return rotatePoint(rel, -pose.rotation);
}

/** The 4 corners of {@link pose}, in top-left/top-right/bottom-right/
 * bottom-left order - directly usable as an `image`/`video` source's
 * `coordinates`, once each point has been converted to lng/lat. */
export function cornersFromPose(pose: ImagePose): Corners {
  const hw = pose.width / 2;
  const hh = pose.height / 2;
  const local: Point[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(p => {
    const r = rotatePoint(p, pose.rotation);
    return [pose.center[0] + r[0], pose.center[1] + r[1]] as Point;
  }) as Corners;
}

/** The endpoints of the two arms of the gizmo's center "locator" cross, in
 * the same plane space as {@link pose} itself - one pair {@link armLength}
 * out along the box's own local x axis, one pair along its local y axis,
 * both rotated by `pose.rotation` exactly like {@link cornersFromPose}'s
 * corners are. That's the point: like the corners, each of these 4 points
 * is meant to be projected to the screen individually (not drawn with a
 * single screen-space SVG transform), so the cross lies flat on the image
 * and follows the map's tilt/rotation instead of staying a fixed,
 * screen-upright glyph. Returns `[xNegative, xPositive, yNegative,
 * yPositive]` - the two arms are the (0,1) and (2,3) pairs. */
export function crossArmsFromPose(pose: ImagePose, armLength: number): [Point, Point, Point, Point] {
  const local: Point[] = [
    [-armLength, 0],
    [armLength, 0],
    [0, -armLength],
    [0, armLength],
  ];
  return local.map(p => {
    const r = rotatePoint(p, pose.rotation);
    return [pose.center[0] + r[0], pose.center[1] + r[1]] as Point;
  }) as [Point, Point, Point, Point];
}

/** The inverse of {@link cornersFromPose}: reconstructs a pose from 4
 * corners (as read from an existing source's `coordinates`). Assumes the
 * corners form a plain rotated rectangle - not a free quadrilateral (that's
 * "free mode", handled separately, later). `width`/`height` are read off
 * the top and left edges; `center` is the average of all 4 corners, which
 * is more forgiving of tiny floating-point asymmetry than picking one
 * diagonal. */
export function poseFromCorners(corners: Corners): ImagePose {
  const [tl, tr, , bl] = corners;
  const center: Point = [
    (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4,
    (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4,
  ];
  const topEdge: Point = [tr[0] - tl[0], tr[1] - tl[1]];
  const leftEdge: Point = [bl[0] - tl[0], bl[1] - tl[1]];
  const width = Math.hypot(topEdge[0], topEdge[1]);
  const height = Math.hypot(leftEdge[0], leftEdge[1]);
  const rotation = Math.atan2(topEdge[1], topEdge[0]);
  return { center, width, height, rotation };
}

/** Which part of the gizmo a point hits, given the current pose:
 * - `body` - inside the box - drag to translate.
 * - `corner` - within `cornerRadius` of a corner - drag to scale (that
 *   corner's opposite corner stays fixed).
 * - `rotate` - within `cornerRadius + rotateRingWidth` of a corner, but
 *   outside the box - drag to rotate around the center.
 * - `none` - nothing interactive there. */
export type GizmoZone =
  | { kind: "body" }
  | { kind: "corner"; corner: CornerIndex }
  | { kind: "rotate"; corner: CornerIndex }
  | { kind: "none" };

export type GizmoHitTestOptions = {
  /** Radius (in the same units as the pose) around each corner that counts
   * as grabbing it for scaling. Default 10. */
  cornerRadius?: number;
  /** Extra radius beyond `cornerRadius`, still counted as "just outside
   * that corner", that counts as grabbing the rotate zone. Default 24. */
  rotateRingWidth?: number;
};

export function hitTestGizmo(pose: ImagePose, point: Point, opts: GizmoHitTestOptions = {}): GizmoZone {
  const cornerRadius = opts.cornerRadius ?? 10;
  const rotateRingWidth = opts.rotateRingWidth ?? 24;

  const corners = cornersFromPose(pose);

  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    if (Math.hypot(point[0] - c[0], point[1] - c[1]) <= cornerRadius) {
      return { kind: "corner", corner: i as CornerIndex };
    }
  }

  const local = toLocalFrame(pose, point);
  const insideBody = Math.abs(local[0]) <= pose.width / 2 && Math.abs(local[1]) <= pose.height / 2;
  if (insideBody) {
    return { kind: "body" };
  }

  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    if (Math.hypot(point[0] - c[0], point[1] - c[1]) <= cornerRadius + rotateRingWidth) {
      return { kind: "rotate", corner: i as CornerIndex };
    }
  }

  return { kind: "none" };
}

/** Moves the pose by a plain offset - the translate drag. */
export function translatePose(pose: ImagePose, dx: number, dy: number): ImagePose {
  return { ...pose, center: [pose.center[0] + dx, pose.center[1] + dy] };
}

/** The angle from {@link from} to {@link to}, using the same convention as
 * {@link ImagePose}'s `rotation` (radians, clockwise-positive on screen).
 * The rotate drag combines this with the pose's rotation at drag-start:
 * `newRotation = startRotation + (angleTo(center, currentPoint) -
 * angleTo(center, startPoint))` - so the box rotates by exactly how far the
 * pointer has swept, with no jump at the start of the drag, whichever
 * corner's rotate zone was grabbed. */
export function angleTo(from: Point, to: Point): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

export type ScalePoseOptions = {
  /** Smallest width/height the result is allowed to shrink to. Default a
   * tiny epsilon - just enough to keep the box from collapsing/inverting
   * through zero, not a real UI-facing minimum size. */
  minSize?: number;
};

/** Scales the pose by dragging {@link corner} toward {@link point}: the
 * opposite corner stays exactly fixed in place, and the aspect ratio
 * (`pose.width / pose.height`) is preserved - {@link point} only ever
 * influences how big the box gets, never its proportions or its rotation.
 * The new size is the projection of the drag onto the fixed-aspect-ratio
 * diagonal, which is the size that best matches where the pointer actually
 * is while still satisfying both constraints. */
export function scalePoseFromCorner(pose: ImagePose, corner: CornerIndex, point: Point, opts: ScalePoseOptions = {}): ImagePose {
  const minSize = opts.minSize ?? 1e-6;
  const anchorIndex = ((corner + 2) % 4) as CornerIndex;
  const anchorWorld = cornersFromPose(pose)[anchorIndex];
  const [sx, sy] = CORNER_SIGNS[corner];
  const { width: w0, height: h0, rotation } = pose;

  const relToAnchor: Point = [point[0] - anchorWorld[0], point[1] - anchorWorld[1]];
  const local = rotatePoint(relToAnchor, -rotation);

  const denom = w0 * w0 + h0 * h0;
  let t = denom > 0 ? (sx * local[0] * w0 + sy * local[1] * h0) / denom : 1;
  const smallerDim = Math.max(Math.min(w0, h0), 1e-9);
  t = Math.max(t, minSize / smallerDim);

  const width = w0 * t;
  const height = h0 * t;

  const centerOffset = rotatePoint([sx * width / 2, sy * height / 2], rotation);
  const center: Point = [anchorWorld[0] + centerOffset[0], anchorWorld[1] + centerOffset[1]];

  return { center, width, height, rotation };
}

/** Scales the pose by dragging {@link corner} toward {@link point}, same as
 * {@link scalePoseFromCorner}, except {@link pose}'s own center stays fixed
 * instead of the opposite corner - used instead of that function when the
 * image's "pivot" has been explicitly fixed (see ImagePositionEditor),
 * letting an image be resized symmetrically around a chosen point (e.g. a
 * known real-world reference) rather than always around whichever corner
 * happens to be opposite the one being dragged. Same projection-onto-the-
 * diagonal approach as scalePoseFromCorner, just measured from the center
 * (half-extents) instead of from the anchor corner (full extents). */
export function scalePoseFromCenter(pose: ImagePose, corner: CornerIndex, point: Point, opts: ScalePoseOptions = {}): ImagePose {
  const minSize = opts.minSize ?? 1e-6;
  const [sx, sy] = CORNER_SIGNS[corner];
  const { width: w0, height: h0, rotation, center } = pose;

  const relToCenter: Point = [point[0] - center[0], point[1] - center[1]];
  const local = rotatePoint(relToCenter, -rotation);

  const hw0 = w0 / 2;
  const hh0 = h0 / 2;
  const denom = hw0 * hw0 + hh0 * hh0;
  let t = denom > 0 ? (sx * local[0] * hw0 + sy * local[1] * hh0) / denom : 1;
  const smallerDim = Math.max(Math.min(w0, h0), 1e-9);
  t = Math.max(t, minSize / smallerDim);

  const width = w0 * t;
  const height = h0 * t;

  return { center, width, height, rotation };
}

/** A default size for a freshly placed image: a fraction of the current
 * viewport's width, so it's always a sensible, visible size regardless of
 * zoom level, with the image's real aspect ratio respected once it's known
 * (pass 1 for a square placeholder if it isn't loaded yet). Deliberately
 * kept as a small, swappable function - nothing else in this module
 * depends on how the initial size is chosen, so this is easy to replace
 * later (e.g. remembering the last size used) without touching anything
 * else. */
export function defaultImageSize(viewportWidth: number, aspectRatio: number, fractionOfViewportWidth = 0.3): { width: number; height: number } {
  const width = viewportWidth * fractionOfViewportWidth;
  const height = aspectRatio > 0 ? width / aspectRatio : width;
  return { width, height };
}

/** Whether {@link point} falls inside the quadrilateral described by
 * {@link corners} (standard ray-casting test) - works for any simple
 * quadrilateral, not just an axis-respecting rotated rectangle, so it stays
 * correct for a future free-transformed ("mode libre") shape too. Used to
 * hit-test *unselected* image layers on click (selecting one - never
 * dragging it, since it has no gizmo yet to grab), as opposed to
 * {@link hitTestGizmo}, which is specifically about the already-selected
 * image's interactive zones. */
export function pointInQuad(corners: Corners, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, yi] = corners[i];
    const [xj, yj] = corners[j];
    const crosses = (yi > point[1]) !== (yj > point[1])
      && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
