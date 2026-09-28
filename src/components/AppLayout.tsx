import React, { useState, useCallback, useRef, useEffect } from "react";
import ScrollContainer from "./ScrollContainer";
import { type WithTranslation, withTranslation } from "react-i18next";
import { IconContext } from "react-icons";

// 185 keeps the "Add Layer" button from being squeezed onto two lines -
// measured against the actual rendered header (title + Collapse/Expand +
// Add Layer): it still wraps at 184px and stays on one line at 185px, so
// this is that real breakpoint, not a guessed round number.
const LIST_WIDTH_MIN = 185;
const LIST_WIDTH_MAX = 500;
const LIST_WIDTH_DEFAULT = 200;

type AppLayoutInternalProps = {
  toolbar: React.ReactElement
  layerList: React.ReactElement
  layerEditor?: React.ReactElement
  codeEditor?: React.ReactElement
  map: React.ReactElement
  bottom?: React.ReactElement
  modals?: React.ReactNode
} & WithTranslation;

function AppLayoutInternal(props: AppLayoutInternalProps) {
  document.body.dir = props.i18n.dir();

  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  // Width the drag is currently pointing at - only committed to real layout
  // (and therefore only triggers a map resize/repaint) once the user
  // releases the handle, instead of on every mousemove.
  const pendingWidth = useRef(listWidth);
  const guideRef = useRef<HTMLDivElement | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = listWidth;
    pendingWidth.current = listWidth;
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }, [listWidth]);

  useEffect(() => {
    let rafId: number | null = null;
    let latestClientX = 0;

    const applyGuidePosition = () => {
      rafId = null;
      const delta = latestClientX - startX.current;
      const next = Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, startWidth.current + delta));
      pendingWidth.current = next;
      // Move the guide line directly via the DOM, bypassing React state, so
      // dragging never touches the panel or map layout until release.
      if (guideRef.current) {
        guideRef.current.style.left = `${next}px`;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      latestClientX = e.clientX;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyGuidePosition);
      }
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsResizing(false);
      // Commit the final width once - this is the only point at which the
      // panel and map actually resize.
      setListWidth(pendingWidth.current);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return <IconContext.Provider value={{size: "14px"}}>
    <div className="maputnik-layout">
      {props.toolbar}
      <div className="maputnik-layout-main">
        {props.codeEditor && <div className="maputnik-layout-code-editor">
          <ScrollContainer>
            {props.codeEditor}
          </ScrollContainer>
        </div>
        }
        {!props.codeEditor && <>
          <div className="maputnik-layout-list" style={{width: listWidth}}>
            {props.layerList}
          </div>
          <div
            className="maputnik-layout-resizer"
            onMouseDown={onMouseDown}
            title="Drag to resize"
          />
          {isResizing && <div
            ref={guideRef}
            className="maputnik-layout-resize-guide"
            style={{left: listWidth}}
          />}
          <div className="maputnik-layout-drawer">
            <ScrollContainer>
              {props.layerEditor}
            </ScrollContainer>
          </div>
        </>}
        <div className="maputnik-layout-map-container">
          {props.map}
          {props.bottom && <div className="maputnik-layout-bottom">
            {props.bottom}
          </div>}
        </div>
      </div>
      {props.modals}
    </div>
  </IconContext.Provider>;
}

const AppLayout = withTranslation()(AppLayoutInternal);
export default AppLayout;
