import React from "react";
import { type ImageSourceSpecification } from "maplibre-gl";
import { type TFunction } from "i18next";
import { MdLock, MdLockOpen } from "react-icons/md";
import Block from "./Block";
import FieldNumber from "./FieldNumber";
import InputNumber from "./InputNumber";
import { type Corners, type ImagePose, cornersFromPose, poseFromCorners } from "../libs/image-position";
import { lngLatToPlane, planeToLngLat, planeUnitsPerMeter } from "../libs/mercator-plane";

type ImagePositionEditorProps = {
  sourceId: string
  source: ImageSourceSpecification
  t: TFunction
  onChange(coordinates: ImageSourceSpecification["coordinates"]): unknown
  // The Pivot row's lock-icon toggle state, persisted in the style's
  // metadata rather than on the source itself (see App's
  // isImagePivotFixed/onImagePivotFixedChanged). When true, the gizmo's
  // corner-drag scaling keeps this image's center fixed instead of the
  // opposite corner, the gizmo's body can no longer be dragged to translate
  // the image (see MapMaplibreGl), and the Pivot fields below go read-only
  // so the point actively being used as the anchor isn't changed out from
  // under it by accident.
  fixedPivot: boolean
  onFixedPivotChange(fixed: boolean): unknown
};

function formatCorner(corner: [number, number] | undefined): string {
  if (!corner) return "-";
  const [lng, lat] = corner;
  return `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
}

// pose.rotation itself is an unbounded signed radian value (see
// image-position.ts) - fine internally, but would show confusing
// negative/multi-turn numbers here, so it's normalized to [0, 360) for
// display and editing.
function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Editable summary of an `image` source's on-map placement. Width, height
 * (in real-world meters) and rotation (degrees from north) can be typed
 * here directly, as an alternative to dragging the gizmo on the map - handy
 * for giving several images of the same source resolution an identical,
 * exactly reproducible size and orientation, which eyeballing a drag can't
 * guarantee (read the values off one image, type them into the next).
 * Width/height are edited independently but always preserve the source's
 * current aspect ratio, same rule the gizmo's own corner-drag scaling
 * follows - "Free-form mode" (still a placeholder) is where independently
 * stretching them would eventually make sense.
 *
 * The corner coordinates further down stay read-only either way (dragging
 * the gizmo, or the fields above, is how they change) - they're shown for
 * reference/verification, e.g. to confirm an edit landed where expected.
 *
 * The Pivot row (right under the image URL) is the exception: unless it's
 * fixed, its two fields are editable too, as a precise alternative to
 * dragging the image into place - typing coordinates there moves the whole
 * image (translation) so its center lands exactly there, handy for lining
 * it up with a known real-world reference point rather than eyeballing it.
 * The lock icon next to it (in the row's action slot, same mechanism as the
 * "convert to expression" icons on e.g. the opacity paint property) toggles
 * "fixed": once locked, the fields go read-only, the gizmo's corner-drag
 * scaling keeps this same center point fixed instead of the default
 * opposite corner (see scalePoseFromCenter), and - since the whole point of
 * "fixed" is that the pivot can't move - dragging the gizmo's body to
 * translate the image is disabled too (see MapMaplibreGl's mousedown
 * handler), leaving only resizing around the pivot and rotation. */
const ImagePositionEditor: React.FC<ImagePositionEditorProps> = ({ sourceId, source, t, onChange, fixedPivot, onFixedPivotChange }) => {
  const [topLeft, topRight, bottomRight, bottomLeft] = source.coordinates ?? [];

  const corners = source.coordinates?.length === 4
    ? (source.coordinates.map(lngLatToPlane) as Corners)
    : null;
  const pose = corners && corners.every(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
    ? poseFromCorners(corners)
    : null;
  const unit = pose ? planeUnitsPerMeter(planeToLngLat(pose.center)) : null;

  const widthMeters = pose && unit ? pose.width / unit : undefined;
  const heightMeters = pose && unit ? pose.height / unit : undefined;
  const rotationDegrees = pose ? normalizeDegrees(pose.rotation * 180 / Math.PI) : undefined;
  const pivotLngLat: [number, number] | undefined = pose ? planeToLngLat(pose.center) : undefined;

  const commitPose = (newPose: ImagePose) => {
    const newCoordinates = cornersFromPose(newPose).map(planeToLngLat) as ImageSourceSpecification["coordinates"];
    onChange(newCoordinates);
  };

  const changeWidth = (newWidthMeters: number | undefined) => {
    if (newWidthMeters === undefined || !pose || !unit) return;
    const aspect = pose.height > 0 ? pose.width / pose.height : 1;
    const width = newWidthMeters * unit;
    commitPose({ ...pose, width, height: width / aspect });
  };

  const changeHeight = (newHeightMeters: number | undefined) => {
    if (newHeightMeters === undefined || !pose || !unit) return;
    const aspect = pose.height > 0 ? pose.width / pose.height : 1;
    const height = newHeightMeters * unit;
    commitPose({ ...pose, height, width: height * aspect });
  };

  const changeRotation = (newDegrees: number | undefined) => {
    if (newDegrees === undefined || !pose) return;
    commitPose({ ...pose, rotation: newDegrees * Math.PI / 180 });
  };

  const changePivotLng = (newLng: number | undefined) => {
    if (newLng === undefined || !pose || !pivotLngLat) return;
    commitPose({ ...pose, center: lngLatToPlane([newLng, pivotLngLat[1]]) });
  };

  const changePivotLat = (newLat: number | undefined) => {
    if (newLat === undefined || !pose || !pivotLngLat) return;
    commitPose({ ...pose, center: lngLatToPlane([pivotLngLat[0], newLat]) });
  };

  return <div className="maputnik-image-position-editor">
    <Block label={t("Source ID")}>
      <span className="maputnik-image-position-editor__value">{sourceId}</span>
    </Block>
    <Block label={t("Image URL")}>
      <span className="maputnik-image-position-editor__value">{source.url ?? "-"}</span>
    </Block>
    <Block
      label={t("Pivot")}
      action={
        <button
          type="button"
          className="maputnik-button maputnik-pivot-lock-button"
          onClick={() => onFixedPivotChange(!fixedPivot)}
          title={fixedPivot
            ? t("Pivot is fixed - click to unfix it")
            : t("Fix the pivot - locks its position and anchors resizing on it")}
        >
          {fixedPivot ? <MdLock /> : <MdLockOpen />}
        </button>
      }
    >
      {fixedPivot ? (
        <div className="maputnik-image-position-editor__pivot-value">
          <span className="maputnik-image-position-editor__value">{formatCorner(pivotLngLat)}</span>
        </div>
      ) : (
        <div className="maputnik-image-position-editor__pivot-inputs">
          <InputNumber
            value={pivotLngLat === undefined ? undefined : Math.round(pivotLngLat[0] * 1e6) / 1e6}
            min={-180}
            max={180}
            onChange={changePivotLng}
            aria-label={t("Pivot longitude")}
          />
          <InputNumber
            value={pivotLngLat === undefined ? undefined : Math.round(pivotLngLat[1] * 1e6) / 1e6}
            min={-90}
            max={90}
            onChange={changePivotLat}
            aria-label={t("Pivot latitude")}
          />
        </div>
      )}
    </Block>
    <FieldNumber
      label={t("Width (m)")}
      value={widthMeters === undefined ? undefined : Math.round(widthMeters * 100) / 100}
      min={0.01}
      onChange={changeWidth}
    />
    <FieldNumber
      label={t("Height (m)")}
      value={heightMeters === undefined ? undefined : Math.round(heightMeters * 100) / 100}
      min={0.01}
      onChange={changeHeight}
    />
    <FieldNumber
      label={t("Rotation (°)")}
      value={rotationDegrees === undefined ? undefined : Math.round(rotationDegrees * 10) / 10}
      min={0}
      max={360}
      onChange={changeRotation}
    />
    <Block label={t("Top left")}>
      <span className="maputnik-image-position-editor__value">{formatCorner(topLeft)}</span>
    </Block>
    <Block label={t("Top right")}>
      <span className="maputnik-image-position-editor__value">{formatCorner(topRight)}</span>
    </Block>
    <Block label={t("Bottom right")}>
      <span className="maputnik-image-position-editor__value">{formatCorner(bottomRight)}</span>
    </Block>
    <Block label={t("Bottom left")}>
      <span className="maputnik-image-position-editor__value">{formatCorner(bottomLeft)}</span>
    </Block>
    <Block label={t("Free-form mode")}>
      <span style={{color: "#fab4aa"}} title={t("Not available yet")}>{t("Coming soon")}</span>
    </Block>
  </div>;
};

export default ImagePositionEditor;
