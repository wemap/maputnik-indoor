import { describe, it, expect } from "vitest";
import {
  type ImagePose,
  cornersFromPose,
  crossArmsFromPose,
  poseFromCorners,
  hitTestGizmo,
  translatePose,
  angleTo,
  scalePoseFromCorner,
  scalePoseFromCenter,
  defaultImageSize,
  pointInQuad,
} from "./image-position";

function expectPointClose(a: [number, number], b: [number, number], precision = 6) {
  expect(a[0]).toBeCloseTo(b[0], precision);
  expect(a[1]).toBeCloseTo(b[1], precision);
}

describe("cornersFromPose", () => {
  it("places the 4 corners around the center when unrotated", () => {
    const pose: ImagePose = { center: [100, 200], width: 40, height: 20, rotation: 0 };
    const [tl, tr, br, bl] = cornersFromPose(pose);
    expectPointClose(tl, [80, 190]);
    expectPointClose(tr, [120, 190]);
    expectPointClose(br, [120, 210]);
    expectPointClose(bl, [80, 210]);
  });

  it("rotates corners clockwise on screen for positive rotation", () => {
    // A wide box rotated 90°: what used to be the (wide) top edge should
    // now run vertically - i.e. width and height have effectively swapped
    // which world axis they span.
    const pose: ImagePose = { center: [0, 0], width: 40, height: 10, rotation: Math.PI / 2 };
    const [tl, tr] = cornersFromPose(pose);
    // Top edge (tl -> tr) had length `width` and ran along +x when
    // unrotated; after a 90° rotation it should run along +y instead.
    expect(Math.abs(tr[0] - tl[0])).toBeCloseTo(0, 6);
    expect(tr[1] - tl[1]).toBeCloseTo(40, 6);
  });
});

describe("crossArmsFromPose", () => {
  it("places the arms along the axes around the center when unrotated", () => {
    const pose: ImagePose = { center: [100, 200], width: 40, height: 20, rotation: 0 };
    const [xNeg, xPos, yNeg, yPos] = crossArmsFromPose(pose, 15);
    expectPointClose(xNeg, [85, 200]);
    expectPointClose(xPos, [115, 200]);
    expectPointClose(yNeg, [100, 185]);
    expectPointClose(yPos, [100, 215]);
  });

  it("rotates the arms along with the pose", () => {
    // A 90° rotation should swap which world axis each arm runs along,
    // exactly like cornersFromPose's edges do.
    const pose: ImagePose = { center: [0, 0], width: 40, height: 20, rotation: Math.PI / 2 };
    const [xNeg, xPos] = crossArmsFromPose(pose, 10);
    expect(Math.abs(xPos[0] - xNeg[0])).toBeCloseTo(0, 6);
    expect(xPos[1] - xNeg[1]).toBeCloseTo(20, 6);
  });
});

describe("poseFromCorners", () => {
  it("round-trips an unrotated pose", () => {
    const pose: ImagePose = { center: [12, -8], width: 30, height: 50, rotation: 0 };
    const roundTripped = poseFromCorners(cornersFromPose(pose));
    expectPointClose(roundTripped.center, pose.center);
    expect(roundTripped.width).toBeCloseTo(pose.width, 6);
    expect(roundTripped.height).toBeCloseTo(pose.height, 6);
    expect(roundTripped.rotation).toBeCloseTo(pose.rotation, 6);
  });

  it("round-trips a rotated, non-square pose", () => {
    const pose: ImagePose = { center: [-5, 40], width: 120, height: 35, rotation: 0.7 };
    const roundTripped = poseFromCorners(cornersFromPose(pose));
    expectPointClose(roundTripped.center, pose.center);
    expect(roundTripped.width).toBeCloseTo(pose.width, 6);
    expect(roundTripped.height).toBeCloseTo(pose.height, 6);
    expect(roundTripped.rotation).toBeCloseTo(pose.rotation, 6);
  });
});

describe("angleTo", () => {
  it("matches the four cardinal directions", () => {
    expect(angleTo([0, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(angleTo([0, 0], [0, 1])).toBeCloseTo(Math.PI / 2, 6);
    expect(angleTo([0, 0], [-1, 0])).toBeCloseTo(Math.PI, 6);
    expect(angleTo([0, 0], [0, -1])).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe("hitTestGizmo", () => {
  const pose: ImagePose = { center: [100, 100], width: 40, height: 40, rotation: 0 };

  it("recognizes the body", () => {
    expect(hitTestGizmo(pose, [100, 100])).toEqual({ kind: "body" });
  });

  it("recognizes a corner", () => {
    const [tl] = cornersFromPose(pose);
    expect(hitTestGizmo(pose, tl)).toEqual({ kind: "corner", corner: 0 });
  });

  it("recognizes the rotate ring just outside a corner", () => {
    const [tl] = cornersFromPose(pose);
    const justOutside: [number, number] = [tl[0] - 15, tl[1] - 15];
    expect(hitTestGizmo(pose, justOutside)).toEqual({ kind: "rotate", corner: 0 });
  });

  it("returns none far away from the box", () => {
    expect(hitTestGizmo(pose, [1000, 1000])).toEqual({ kind: "none" });
  });

  it("still finds the right corner on a rotated pose", () => {
    const rotated: ImagePose = { ...pose, rotation: Math.PI / 4 };
    const [, tr] = cornersFromPose(rotated);
    expect(hitTestGizmo(rotated, tr)).toEqual({ kind: "corner", corner: 1 });
  });
});

describe("translatePose", () => {
  it("moves the center and nothing else", () => {
    const pose: ImagePose = { center: [10, 10], width: 5, height: 8, rotation: 0.3 };
    const moved = translatePose(pose, 4, -2);
    expectPointClose(moved.center, [14, 8]);
    expect(moved.width).toBe(pose.width);
    expect(moved.height).toBe(pose.height);
    expect(moved.rotation).toBe(pose.rotation);
  });
});

describe("scalePoseFromCorner", () => {
  it("keeps the opposite corner fixed and the aspect ratio unchanged", () => {
    const pose: ImagePose = { center: [0, 0], width: 40, height: 20, rotation: 0 };
    const [, , br] = cornersFromPose(pose); // opposite of top-left (corner 0's anchor is corner 2)
    // Drag the top-left corner further out along the anchor->corner diagonal
    // (1.5x the original distance from the anchor).
    const scaled = scalePoseFromCorner(pose, 0, [-40, -20]);
    expect(scaled.width).toBeCloseTo(60, 6);
    expect(scaled.height).toBeCloseTo(30, 6);
    expect(scaled.width / scaled.height).toBeCloseTo(pose.width / pose.height, 6);
    const [newTl, , newBr] = cornersFromPose(scaled);
    expectPointClose(newBr, br); // anchor corner unmoved
    expectPointClose(newTl, [-40, -20]); // dragged corner lands where we dropped it
  });

  it("keeps the anchor fixed in world space even when the pose is rotated", () => {
    const pose: ImagePose = { center: [50, 50], width: 40, height: 20, rotation: Math.PI / 6 };
    const [, , , anchorCorner] = cornersFromPose(pose); // corner 1's anchor is corner 3 (bottom-left)
    const [, tr] = cornersFromPose(pose);
    // Drag the top-right corner a bit further out along its own direction.
    const dragTo: [number, number] = [tr[0] + (tr[0] - pose.center[0]) * 0.5, tr[1] + (tr[1] - pose.center[1]) * 0.5];
    const scaled = scalePoseFromCorner(pose, 1, dragTo);
    const [, , , newAnchorCorner] = cornersFromPose(scaled);
    expectPointClose(newAnchorCorner, anchorCorner, 4);
    expect(scaled.rotation).toBeCloseTo(pose.rotation, 6);
  });

  it("never collapses through zero size", () => {
    const pose: ImagePose = { center: [0, 0], width: 40, height: 20, rotation: 0 };
    // Drag the top-left corner all the way past the anchor.
    const scaled = scalePoseFromCorner(pose, 0, [200, 200]);
    expect(scaled.width).toBeGreaterThan(0);
    expect(scaled.height).toBeGreaterThan(0);
  });
});

describe("scalePoseFromCenter", () => {
  it("keeps the center fixed and the aspect ratio unchanged", () => {
    const pose: ImagePose = { center: [0, 0], width: 40, height: 20, rotation: 0 };
    // Drag the top-left corner (originally at [-20,-10]) straight out to
    // twice its distance from the center.
    const scaled = scalePoseFromCenter(pose, 0, [-40, -20]);
    expect(scaled.width).toBeCloseTo(80, 6);
    expect(scaled.height).toBeCloseTo(40, 6);
    expect(scaled.width / scaled.height).toBeCloseTo(pose.width / pose.height, 6);
    expectPointClose(scaled.center, pose.center); // center unmoved
    const [newTl] = cornersFromPose(scaled);
    expectPointClose(newTl, [-40, -20]); // dragged corner lands where we dropped it
  });

  it("keeps the center fixed in world space even when the pose is rotated", () => {
    const pose: ImagePose = { center: [50, 50], width: 40, height: 20, rotation: Math.PI / 6 };
    const [, tr] = cornersFromPose(pose);
    const dragTo: [number, number] = [tr[0] + (tr[0] - pose.center[0]) * 0.5, tr[1] + (tr[1] - pose.center[1]) * 0.5];
    const scaled = scalePoseFromCenter(pose, 1, dragTo);
    expectPointClose(scaled.center, pose.center, 4);
    expect(scaled.rotation).toBeCloseTo(pose.rotation, 6);
  });

  it("never collapses through zero size", () => {
    const pose: ImagePose = { center: [0, 0], width: 40, height: 20, rotation: 0 };
    // Drag the top-left corner all the way past the center.
    const scaled = scalePoseFromCenter(pose, 0, [200, 200]);
    expect(scaled.width).toBeGreaterThan(0);
    expect(scaled.height).toBeGreaterThan(0);
  });
});

describe("defaultImageSize", () => {
  it("scales with viewport width and respects the aspect ratio", () => {
    const size = defaultImageSize(1000, 2, 0.3);
    expect(size.width).toBeCloseTo(300, 6);
    expect(size.height).toBeCloseTo(150, 6);
  });

  it("falls back to a square when the aspect ratio is unknown", () => {
    const size = defaultImageSize(1000, 0, 0.3);
    expect(size.width).toBeCloseTo(300, 6);
    expect(size.height).toBeCloseTo(300, 6);
  });
});

describe("pointInQuad", () => {
  const pose: ImagePose = { center: [100, 100], width: 40, height: 20, rotation: 0 };
  const corners = cornersFromPose(pose);

  it("recognizes a point well inside the quad", () => {
    expect(pointInQuad(corners, [100, 100])).toBe(true);
  });

  it("recognizes a point well outside the quad", () => {
    expect(pointInQuad(corners, [1000, 1000])).toBe(false);
  });

  it("stays correct for a rotated quad", () => {
    const rotated = cornersFromPose({ ...pose, rotation: Math.PI / 4 });
    // Center is inside regardless of rotation...
    expect(pointInQuad(rotated, [100, 100])).toBe(true);
    // ...but a point just outside the unrotated box, near an unrotated
    // corner, is no longer inside once the box has rotated away from it.
    expect(pointInQuad(rotated, [119, 91])).toBe(false);
  });
});
