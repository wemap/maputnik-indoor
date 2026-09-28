import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Collapser from "./Collapser";

type LayerListGroupProps = {
  title: string
  dropId: string
  "data-wd-key"?: string
  isActive: boolean
  onActiveToggle(...args: unknown[]): unknown
  "aria-controls"?: string
};

// Renders the collapsible header shown above a group of layers that share a
// common prefix. It also registers itself as a sortable node (via `dropId`)
// so that dragging a layer directly onto a group boundary works exactly like
// dropping it onto a regular layer row - no drag handle is attached here, so
// the group header itself can never be picked up, only dropped onto.
const LayerListGroup: React.FC<LayerListGroupProps> = (props) => {
  const { setNodeRef, transform, transition } = useSortable({ id: props.dropId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return <li ref={setNodeRef} style={style} className="maputnik-layer-list-group">
    <div className="maputnik-layer-list-group-header"
      data-wd-key={"layer-list-group:"+props["data-wd-key"]}
      onClick={_e => props.onActiveToggle(!props.isActive)}
    >
      <button
        className="maputnik-layer-list-group-title"
        aria-controls={props["aria-controls"]}
        aria-expanded={props.isActive}
      >
        {props.title}
      </button>
      <span className="maputnik-space" />
      <Collapser
        style={{ height: 14, width: 14 }}
        isCollapsed={props.isActive}
      />
    </div>
  </li>;
};

export default LayerListGroup;
