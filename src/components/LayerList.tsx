import React, {type JSX, useEffect, useLayoutEffect, useRef, useState} from "react";
import { createPortal } from "react-dom";
import classnames from "classnames";
import lodash from "lodash";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import LayerListGroup from "./LayerListGroup";
import LayerListItem from "./LayerListItem";
import IconLayer from "./IconLayer";
import ModalAdd from "./modals/ModalAdd";

import type {LayerSpecification, SourceSpecification} from "maplibre-gl";
import generateUniqueId from "../libs/document-uid";
import {
  findClosestCommonPrefix,
  layerPrefix,
  groupDropId,
  resolveGroupDropIndex,
  buildLayerListSortableIds,
  DUPLICATE_TYPE_LABELS,
} from "../libs/layer";
import { type WithTranslation, withTranslation } from "react-i18next";
import { type MappedError, type OnMoveLayerCallback } from "../libs/definitions";

type LayerListContainerProps = {
  layers: LayerSpecification[]
  selectedLayerIndex: number
  onLayersChange(layers: LayerSpecification[]): unknown
  onLayerSelect(index: number): void;
  onLayerDestroy?(...args: unknown[]): unknown
  onLayerCopy(...args: unknown[]): unknown
  onLayerDuplicateAsType(index: number, newType: string): unknown
  onLayerDuplicateImage(index: number): unknown
  onLayerVisibilityToggle(...args: unknown[]): unknown
  onLayerTagColor(index: number, color: string | null): unknown
  sources: Record<string, SourceSpecification & {layers: string[]}>;
  errors: MappedError[]
};
type LayerListContainerInternalProps = LayerListContainerProps & WithTranslation;

type LayerListContainerState = {
  collapsedGroups: {[ket: string]: boolean}
  areAllGroupsExpanded: boolean
  keys: {[key: string]: number}
  isOpen: {[key: string]: boolean}
  picker: PickerState
};

const TAG_COLORS = [
  "#ff6b6b", "#ffa94d", "#ffe066", "#38d9a9",
  "#4dabf7", "#9775fa", "#f783ac", "#ffffff", "#909090"
];

type PickerState = { x: number; y: number; layerIndex: number; tagColor?: string; layerType?: string; hasFilter?: boolean; isImageLayer?: boolean } | null;

const DUPLICATE_TYPE_OPTIONS = Object.keys(DUPLICATE_TYPE_LABELS);
// Only layers of these types (plus image layers, handled separately) get
// the "Duplicate as" row at all - converting some other type (symbol,
// circle, background, heatmap...) into fill/line/extrusion would just
// silently drop most of its paint/layout properties, so it's not offered.
const DUPLICATE_ELIGIBLE_TYPES = new Set(DUPLICATE_TYPE_OPTIONS);

function LayerContextMenu({ picker, onPickColor, onDuplicateAsType, onDuplicateImage, onClose }: {
  picker: PickerState;
  onPickColor(index: number, color: string | null): void;
  onDuplicateAsType(index: number, newType: string): void;
  onDuplicateImage(index: number): void;
  onClose(): void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!picker) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-tag-picker]")) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picker]);

  // Reset to the click point whenever a new picker opens, then correct it
  // below once we know the popup's real rendered size.
  useEffect(() => {
    if (picker) setPos({ left: picker.x, top: picker.y + 6 });
  }, [picker?.layerIndex, picker?.x, picker?.y]);

  useLayoutEffect(() => {
    if (!picker || !pos || !menuRef.current) return;
    const margin = 8;
    const rect = menuRef.current.getBoundingClientRect();
    let { left, top } = pos;

    // Flip above the click point if it would overflow the bottom of the
    // viewport - this is the fix for layers near the bottom of the list.
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, picker.y - rect.height - 6);
    }
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }

    if (left !== pos.left || top !== pos.top) {
      setPos({ left, top });
    }
  }, [pos, picker]);

  if (!picker) return null;

  const typeOptions = DUPLICATE_TYPE_OPTIONS.filter(type => type !== picker.layerType);

  return createPortal(
    <div
      ref={menuRef}
      data-tag-picker="true"
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos?.left ?? picker.x,
        top: pos?.top ?? picker.y + 6,
        visibility: pos ? "visible" : "hidden",
        zIndex: 9999,
        backgroundColor: "#1a1a1a",
        border: "1px solid #555",
        borderRadius: "6px",
        padding: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "160px",
        boxSizing: "border-box",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        fontFamily: "Roboto, sans-serif",
      }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {TAG_COLORS.map(c => (
          <div
            key={c}
            onMouseDown={() => onPickColor(picker.layerIndex, c)}
            style={{
              width: "22px", height: "22px", borderRadius: "50%",
              background: c, cursor: "pointer",
              outline: picker.tagColor === c ? "2px solid #fff" : "none",
              outlineOffset: "2px",
            }}
          />
        ))}
        <div
          onMouseDown={() => onPickColor(picker.layerIndex, null)}
          style={{
            width: "22px", height: "22px", borderRadius: "50%",
            background: "transparent",
            border: "1px solid #888",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "12px", color: "#aaa",
          }}
        >✕</div>
      </div>

      {(() => {
        // Image layers get a single "duplicate image" icon in place of the
        // fill/line/extrusion type-conversion icons (converting an image to
        // another type makes no sense) - same row, same icon-button style,
        // just a different (always enabled) action, so the popup stays
        // visually consistent with every other layer's context menu.
        //
        // The whole section is left out - same as for a layer type that
        // isn't in DUPLICATE_ELIGIBLE_TYPES - when there's no filter to
        // adapt: "as type" duplication has nothing to carry over, and the
        // plain duplicate action (the row's own duplicate icon, same as
        // vanilla Maputnik) already covers that case. No explanatory text
        // either, for the same reason an ineligible type gets none: this is
        // just not offered here, nothing to call out.
        const eligible = picker.isImageLayer || (picker.layerType && DUPLICATE_ELIGIBLE_TYPES.has(picker.layerType));
        const isActionable = picker.isImageLayer || picker.hasFilter;
        if (!eligible || !isActionable) return null;

        const iconTypes = picker.isImageLayer ? ["raster"] : typeOptions;

        return (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            <span style={{
              fontSize: "13px",
              color: "#ccc",
              whiteSpace: "nowrap",
            }}>
              Duplicate as
            </span>
            {iconTypes.map(type => (
              <button
                key={type}
                className="maputnik-icon-button"
                title={picker.isImageLayer ? "Duplicate image" : `Duplicate as ${DUPLICATE_TYPE_LABELS[type]}`}
                onMouseDown={() => {
                  if (picker.isImageLayer) onDuplicateImage(picker.layerIndex);
                  else onDuplicateAsType(picker.layerIndex, type);
                }}
                style={{
                  width: "20px", height: "20px", borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  color: "#ccc",
                  flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "13px", padding: 0,
                }}
              >
                <IconLayer type={type} style={{ width: "1em", height: "1em" }} />
              </button>
            ))}
          </div>
        );
      })()}
    </div>,
    document.body
  );
}

// List of collapsible layer editors
class LayerListContainerInternal extends React.Component<LayerListContainerInternalProps, LayerListContainerState> {
  static defaultProps = {
    onLayerSelect: () => {},
  };
  selectedItemRef: React.RefObject<any>;
  scrollContainerRef: React.RefObject<HTMLElement | null>;

  constructor(props: LayerListContainerInternalProps) {
    super(props);
    this.selectedItemRef = React.createRef();
    this.scrollContainerRef = React.createRef();
    this.state = {
      collapsedGroups: {},
      areAllGroupsExpanded: false,
      keys: {
        add: +generateUniqueId(),
      },
      isOpen: {
        add: false,
      },
      picker: null,
    };
  }

  toggleModal(modalName: string) {
    this.setState({
      keys: {
        ...this.state.keys,
        [modalName]: +generateUniqueId(),
      },
      isOpen: {
        ...this.state.isOpen,
        [modalName]: !this.state.isOpen[modalName]
      }
    });
  }

  onContextMenuLayer = (layerIndex: number, e: React.MouseEvent) => {
    const layer = this.props.layers[layerIndex] as any;
    const tagColor = layer?.metadata?.["maputnik:tag-color"];
    const hasFilter = Array.isArray(layer?.filter) && layer.filter.length > 1;
    const isImageLayer = layer?.type === "raster" && this.props.sources[layer?.source]?.type === "image";
    this.setState({ picker: { x: e.clientX, y: e.clientY, layerIndex, tagColor, layerType: layer?.type, hasFilter, isImageLayer } });
  };

  onPickerPick = (layerIndex: number, color: string | null) => {
    this.props.onLayerTagColor(layerIndex, color);
    this.setState({ picker: null });
  };

  onPickerDuplicateAsType = (layerIndex: number, newType: string) => {
    this.props.onLayerDuplicateAsType(layerIndex, newType);
    this.setState({ picker: null });
  };

  onPickerDuplicateImage = (layerIndex: number) => {
    this.props.onLayerDuplicateImage(layerIndex);
    this.setState({ picker: null });
  };

  toggleLayers = () => {
    let idx = 0;

    const newGroups: {[key:string]: boolean} = {};

    this.groupedLayers().forEach(layers => {
      const groupPrefix = layerPrefix(layers[0].id);
      const lookupKey = [groupPrefix, idx].join("-");


      if (layers.length > 1) {
        newGroups[lookupKey] = this.state.areAllGroupsExpanded;
      }

      layers.forEach((_layer) => {
        idx += 1;
      });
    });

    this.setState({
      collapsedGroups: newGroups,
      areAllGroupsExpanded: !this.state.areAllGroupsExpanded
    });
  };

  groupedLayers(): (LayerSpecification & {key: string})[][] {
    const groups = [];
    const layerIdCount = new Map();

    for (let i = 0; i < this.props.layers.length; i++) {
      const origLayer = this.props.layers[i];
      const previousLayer = this.props.layers[i-1];
      layerIdCount.set(origLayer.id,
        layerIdCount.has(origLayer.id) ? layerIdCount.get(origLayer.id) + 1 : 0
      );
      const layer = {
        ...origLayer,
        key: `layers-list-${origLayer.id}-${layerIdCount.get(origLayer.id)}`,
      };
      if(previousLayer && layerPrefix(previousLayer.id) == layerPrefix(layer.id)) {
        const lastGroup = groups[groups.length - 1];
        lastGroup.push(layer);
      } else {
        groups.push([layer]);
      }
    }
    return groups;
  }

  toggleLayerGroup(groupPrefix: string, idx: number) {
    const lookupKey = [groupPrefix, idx].join("-");
    const newGroups = { ...this.state.collapsedGroups };
    if(lookupKey in this.state.collapsedGroups) {
      newGroups[lookupKey] = !this.state.collapsedGroups[lookupKey];
    } else {
      newGroups[lookupKey] = false;
    }
    this.setState({
      collapsedGroups: newGroups
    });
  }

  isCollapsed(groupPrefix: string, idx: number) {
    const collapsed = this.state.collapsedGroups[[groupPrefix, idx].join("-")];
    return collapsed === undefined ? true : collapsed;
  }

  shouldComponentUpdate (nextProps: LayerListContainerProps, nextState: LayerListContainerState) {
    // Always update on state change
    if (this.state !== nextState) {
      return true;
    }

    // This component tree only requires id and visibility from the layers
    // objects
    function getRequiredProps(layer: LayerSpecification) {
      const out: {id: string, layout?: { visibility: any}, tagColor?: string} = {
        id: layer.id,
      };

      if (layer.layout) {
        out.layout = {
          visibility: layer.layout.visibility
        };
      }
      const meta = (layer as any).metadata;
      if (meta?.["maputnik:tag-color"]) {
        out.tagColor = meta["maputnik:tag-color"];
      }
      return out;
    }
    const layersEqual = lodash.isEqual(
      nextProps.layers.map(getRequiredProps),
      this.props.layers.map(getRequiredProps),
    );

    function withoutLayers(props: LayerListContainerProps) {
      const out = {
        ...props
      } as LayerListContainerProps & { layers?: any };
      delete out["layers"];
      return out;
    }

    // Compare the props without layers because we've already compared them
    // efficiently above.
    const propsEqual = lodash.isEqual(
      withoutLayers(this.props),
      withoutLayers(nextProps)
    );

    const propsChanged = !(layersEqual && propsEqual);
    return propsChanged;
  }

  componentDidUpdate (prevProps: LayerListContainerProps) {
    if (prevProps.selectedLayerIndex !== this.props.selectedLayerIndex) {
      const selectedItemNode = this.selectedItemRef.current;
      if (selectedItemNode && selectedItemNode.node) {
        const target = selectedItemNode.node;
        const options = {
          root: this.scrollContainerRef.current,
          threshold: 1.0
        };
        const observer = new IntersectionObserver(entries => {
          observer.unobserve(target);
          if (entries.length > 0 && entries[0].intersectionRatio < 1) {
            target.scrollIntoView();
          }
        }, options);

        observer.observe(target);
      }
    }
  }

  render() {

    const listItems: JSX.Element[] = [];
    let idx = 0;
    const layersByGroup = this.groupedLayers();
    layersByGroup.forEach(layers => {
      const groupPrefix = layerPrefix(layers[0].id);
      if(layers.length > 1) {
        const grp = <LayerListGroup
          dropId={groupDropId(idx, layers[0].id)}
          data-wd-key={[groupPrefix, idx].join("-")}
          aria-controls={layers.map(l => l.key).join(" ")}
          key={`group-${groupPrefix}-${idx}`}
          title={groupPrefix}
          isActive={!this.isCollapsed(groupPrefix, idx) || idx === this.props.selectedLayerIndex}
          onActiveToggle={this.toggleLayerGroup.bind(this, groupPrefix, idx)}
        />;
        listItems.push(grp);
      }

      layers.forEach((layer, idxInGroup) => {
        const groupIdx = findClosestCommonPrefix(this.props.layers, idx);

        const layerError = this.props.errors.find(error => {
          return (
            error.parsed &&
            error.parsed.type === "layer" &&
            error.parsed.data.index == idx
          );
        });

        const additionalProps: {ref?: React.RefObject<any>} = {};
        if (idx === this.props.selectedLayerIndex) {
          additionalProps.ref = this.selectedItemRef;
        }

        const tagColor = (layer as any).metadata?.["maputnik:tag-color"] || undefined;
        const listItem = <LayerListItem
          className={classnames({
            "maputnik-layer-list-item-collapsed": layers.length > 1 && this.isCollapsed(groupPrefix, groupIdx) && idx !== this.props.selectedLayerIndex,
            "maputnik-layer-list-item-group-last": idxInGroup == layers.length - 1 && layers.length > 1,
            "maputnik-layer-list-item--error": !!layerError
          })}
          key={layer.key}
          id={layer.key}
          layerId={layer.id}
          layerIndex={idx}
          layerType={layer.type}
          visibility={(layer.layout || {}).visibility}
          isSelected={idx === this.props.selectedLayerIndex}
          tagColor={tagColor}
          onLayerSelect={this.props.onLayerSelect}
          onLayerDestroy={this.props.onLayerDestroy?.bind(this)}
          onLayerCopy={this.props.onLayerCopy.bind(this)}
          onLayerVisibilityToggle={this.props.onLayerVisibilityToggle.bind(this)}
          onContextMenuLayer={this.onContextMenuLayer}
          {...additionalProps}
        />;
        listItems.push(listItem);
        idx += 1;
      });
    });

    const t = this.props.t;

    return <>
      <LayerContextMenu
        picker={this.state.picker}
        onPickColor={this.onPickerPick}
        onDuplicateAsType={this.onPickerDuplicateAsType}
        onDuplicateImage={this.onPickerDuplicateImage}
        onClose={() => this.setState({ picker: null })}
      />
      <section
      className="maputnik-layer-list"
      data-wd-key="layer-list"
      role="complementary"
      aria-label={t("Layers list")}
      ref={this.scrollContainerRef}
    >
      <ModalAdd
        key={this.state.keys.add}
        layers={this.props.layers}
        sources={this.props.sources}
        isOpen={this.state.isOpen.add}
        onOpenToggle={this.toggleModal.bind(this, "add")}
        onLayersChange={this.props.onLayersChange}
      />
      <header className="maputnik-layer-list-header" data-wd-key="layer-list.header">
        <span className="maputnik-layer-list-header-title">{t("Layers")}</span>
        <span className="maputnik-space" />
        <div className="maputnik-default-property">
          <div className="maputnik-multibutton">
            <button
              id="skip-target-layer-list"
              data-wd-key="skip-target-layer-list"
              onClick={this.toggleLayers}
              className="maputnik-button">
              {this.state.areAllGroupsExpanded === true ?
                t("Collapse")
                :
                t("Expand")
              }
            </button>
          </div>
        </div>
        <div className="maputnik-default-property">
          <div className="maputnik-multibutton">
            <button
              onClick={this.toggleModal.bind(this, "add")}
              data-wd-key="layer-list:add-layer"
              className="maputnik-button maputnik-button-selected">
              {t("Add Layer")}
            </button>
          </div>
        </div>
      </header>
      <div
        role="navigation"
        aria-label={t("Layers list")}
      >
        <ul className="maputnik-layer-list-container">
          {listItems}
        </ul>
      </div>
    </section></>
  }
}

const LayerListContainer = withTranslation()(LayerListContainerInternal);

type LayerListProps = LayerListContainerProps & {
  onMoveLayer: OnMoveLayerCallback
};

export type { LayerListContainerProps };

const LayerList: React.FC<LayerListProps> = (props) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const {active, over} = event;
    if (!over) return;

    const oldIndex = props.layers.findIndex(layer => layer.id === active.id);
    if (oldIndex === -1) return;

    // Dropping directly on a group header means "place it right before this
    // group", i.e. at the same position as dropping onto that group's first
    // layer - this is what makes it possible to insert a layer exactly
    // between two (possibly collapsed) groups.
    const overId = String(over.id);
    const groupIndex = resolveGroupDropIndex(overId);
    const newIndex = groupIndex !== null
      ? groupIndex
      : props.layers.findIndex(layer => layer.id === overId);

    if (newIndex !== -1 && oldIndex !== newIndex) {
      props.onMoveLayer({oldIndex, newIndex});
    }
  };

  const sortableIds = buildLayerListSortableIds(props.layers);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <LayerListContainer {...props} />
      </SortableContext>
    </DndContext>
  );
};

export default LayerList;
