import React from "react";
import cloneDeep from "lodash.clonedeep";
import clamp from "lodash.clamp";
import buffer from "buffer";
import get from "lodash.get";
import {unset} from "lodash";
import {arrayMoveMutable} from "array-move";
import hash from "string-hash";
import { PMTiles } from "pmtiles";
import {type Map, type LayerSpecification, type StyleSpecification, type ValidationError, type SourceSpecification} from "maplibre-gl";
import {validateStyleMin} from "@maplibre/maplibre-gl-style-spec";
import latest from "@maplibre/maplibre-gl-style-spec/dist/latest.json";

import MapMaplibreGl from "./MapMaplibreGl";
import MapOpenLayers from "./MapOpenLayers";
import CodeEditor from "./CodeEditor";
import LayerList from "./LayerList";
import LayerEditor from "./LayerEditor";
import AppToolbar, { type MapState } from "./AppToolbar";
import AppLayout from "./AppLayout";
import MessagePanel from "./AppMessagePanel";

import ModalSettings from "./modals/ModalSettings";
import ModalExport from "./modals/ModalExport";
import ModalSources from "./modals/ModalSources";
import ModalOpen from "./modals/ModalOpen";
import ModalShortcuts from "./modals/ModalShortcuts";
import ModalDebug from "./modals/ModalDebug";
import ModalGlobalState from "./modals/ModalGlobalState";

import {downloadGlyphsMetadata, downloadSpriteMetadata} from "../libs/metadata";
import style from "../libs/style";
import { duplicateLayerAsType, createImageRasterLayer, buildDuplicateId } from "../libs/layer";
import { cleanIndoorLevelBlocks } from "../libs/legacy-level";
import { addSource, changeSource } from "../libs/source";
import { undoMessages, redoMessages } from "../libs/diffmessage";
import { createStyleStore, type IStyleStore } from "../libs/store/style-store-factory";
import { RevisionStore } from "../libs/revisions";
import LayerWatcher from "../libs/layerwatcher";
import tokens from "../config/tokens.json";
import isEqual from "lodash.isequal";
import { type MapOptions } from "maplibre-gl";
import { type MappedError, type OnStyleChangedOpts, type StyleSpecificationWithId } from "../libs/definitions";

// Buffer must be defined globally for @maplibre/maplibre-gl-style-spec validate() function to succeed.
window.Buffer = buffer.Buffer;

function setFetchAccessToken(url: string, mapStyle: StyleSpecification) {
  const matchesTilehosting = url.match(/\.tilehosting\.com/);
  const matchesMaptiler = url.match(/\.maptiler\.com/);
  const matchesThunderforest = url.match(/\.thunderforest\.com/);
  const matchesLocationIQ = url.match(/\.locationiq\.com/);
  if (matchesTilehosting || matchesMaptiler) {
    const accessToken = style.getAccessToken("openmaptiles", mapStyle, {allowFallback: true});
    if (accessToken) {
      return url.replace("{key}", accessToken);
    }
  }
  else if (matchesThunderforest) {
    const accessToken = style.getAccessToken("thunderforest", mapStyle, {allowFallback: true});
    if (accessToken) {
      return url.replace("{key}", accessToken);
    }
  }
  else if (matchesLocationIQ) {
    const accessToken = style.getAccessToken("locationiq", mapStyle, {allowFallback: true});
    if (accessToken) {
      return url.replace("{key}", accessToken);
    }
  }
  else {
    return url;
  }
}

function updateRootSpec(spec: any, fieldName: string, newValues: any) {
  return {
    ...spec,
    $root: {
      ...spec.$root,
      [fieldName]: {
        ...spec.$root[fieldName],
        values: newValues
      }
    }
  };
}

type AppState = {
  errors: MappedError[],
  infos: string[],
  mapStyle: StyleSpecificationWithId,
  dirtyMapStyle?: StyleSpecification,
  selectedLayerIndex: number,
  selectedLayerOriginalId?: string,
  sources: {[key: string]: SourceSpecification & {layers: string[]} },
  // An image source that's been submitted from "Add Source" but not written
  // into the style yet - it's waiting for its placement click on the map
  // (see onImageSourcePlacementStart/onImagePlaced).
  pendingImagePlacement: { sourceId: string; source: SourceSpecification } | null,
  vectorLayers: {},
  spec: any,
  mapView: {
    zoom: number,
    center: {
      lng: number,
      lat: number,
    },
    _from: "map" | "app"
  },
  maplibreGlDebugOptions: Partial<MapOptions> & {
    showTileBoundaries: boolean,
    showCollisionBoxes: boolean,
    showOverdrawInspector: boolean,
  },
  openlayersDebugOptions: {
    debugToolbox: boolean,
  },
  mapState: MapState
  isOpen: {
    settings: boolean
    sources: boolean
    open: boolean
    shortcuts: boolean
    export: boolean
    debug: boolean
    globalState: boolean
    codeEditor: boolean
  }
  fileHandle: FileSystemFileHandle | null
};

export default class App extends React.Component<any, AppState> {
  revisionStore: RevisionStore;
  styleStore: IStyleStore | null = null;
  layerWatcher: LayerWatcher;

  constructor(props: any) {
    super(props);

    this.revisionStore = new RevisionStore();
    this.configureKeyboardShortcuts();

    this.state = {
      errors: [],
      infos: [],
      mapStyle: style.emptyStyle,
      selectedLayerIndex: 0,
      sources: {},
      pendingImagePlacement: null,
      vectorLayers: {},
      mapState: "map",
      spec: latest,
      mapView: {
        zoom: 0,
        center: {
          lng: 0,
          lat: 0,
        },
        _from: "app"
      },
      isOpen: {
        settings: false,
        sources: false,
        open: false,
        shortcuts: false,
        export: false,
        debug: false,
        globalState: false,
        codeEditor: false
      },
      maplibreGlDebugOptions: {
        showTileBoundaries: false,
        showCollisionBoxes: false,
        showOverdrawInspector: false,
      },
      openlayersDebugOptions: {
        debugToolbox: false,
      },
      fileHandle: null,
    };

    this.layerWatcher = new LayerWatcher({
      onVectorLayersChange: v => this.setState({ vectorLayers: v })
    });
  }

  configureKeyboardShortcuts = () => {
    const shortcuts = [
      {
        key: "?",
        handler: () => {
          this.toggleModal("shortcuts");
        }
      },
      {
        key: "o",
        handler: () => {
          this.toggleModal("open");
        }
      },
      {
        key: "e",
        handler: () => {
          this.toggleModal("export");
        }
      },
      {
        key: "d",
        handler: () => {
          this.toggleModal("sources");
        }
      },
      {
        key: "s",
        handler: () => {
          this.toggleModal("settings");
        }
      },
      {
        key: "g",
        handler: () => {
          this.toggleModal("globalState");
        }
      },
      {
        key: "i",
        handler: () => {
          this.setMapState(
            this.state.mapState === "map" ? "inspect" : "map"
          );
        }
      },
      {
        key: "m",
        handler: () => {
          (document.querySelector(".maplibregl-canvas") as HTMLCanvasElement).focus();
        }
      },
      {
        key: "!",
        handler: () => {
          this.toggleModal("debug");
        }
      },
    ];

    document.body.addEventListener("keyup", (e) => {
      if(e.key === "Escape") {
        if (this.state.pendingImagePlacement) {
          this.onImagePlacementCancel();
        }
        (e.target as HTMLElement).blur();
        document.body.focus();
      }
      else if(this.state.isOpen.shortcuts || document.activeElement === document.body) {
        const shortcut = shortcuts.find((shortcut) => {
          return (shortcut.key === e.key);
        });

        if(shortcut) {
          this.setModal("shortcuts", false);
          shortcut.handler();
        }
      }
    });
  };

  handleKeyPress = (e: KeyboardEvent) => {
    if(navigator.platform.toUpperCase().indexOf("MAC") >= 0) {
      if(e.metaKey && e.shiftKey && e.keyCode === 90) {
        e.preventDefault();
        this.onRedo();
      }
      else if(e.metaKey && e.keyCode === 90) {
        e.preventDefault();
        this.onUndo();
      }
    }
    else {
      if(e.ctrlKey && e.keyCode === 90) {
        e.preventDefault();
        this.onUndo();
      }
      else if(e.ctrlKey && e.keyCode === 89) {
        e.preventDefault();
        this.onRedo();
      }
    }
  };

  async componentDidMount() {
    this.styleStore = await createStyleStore((mapStyle, opts) => this.onStyleChanged(mapStyle, opts));
    window.addEventListener("keydown", this.handleKeyPress);
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyPress);
  }

  saveStyle(snapshotStyle: StyleSpecificationWithId) {
    this.styleStore?.save(snapshotStyle);
  }

  updateFonts(urlTemplate: string) {
    const metadata: {[key: string]: string} = this.state.mapStyle.metadata || {} as any;
    const accessToken = metadata["maputnik:openmaptiles_access_token"] || tokens.openmaptiles;

    const glyphUrl = (typeof urlTemplate === "string")? urlTemplate.replace("{key}", accessToken): urlTemplate;
    downloadGlyphsMetadata(glyphUrl).then(fonts => {
      this.setState({ spec: updateRootSpec(this.state.spec, "glyphs", fonts)});
    });
  }

  updateIcons(baseUrl: string) {
    downloadSpriteMetadata(baseUrl).then(icons => {
      this.setState({ spec: updateRootSpec(this.state.spec, "sprite", icons)});
    });
  }

  onChangeMetadataProperty = (property: string, value: any) => {
    // If we're changing renderer reset the map state.
    if (
      property === "maputnik:renderer" &&
      value !== get(this.state.mapStyle, ["metadata", "maputnik:renderer"], "mlgljs")
    ) {
      this.setState({
        mapState: "map"
      });
    }

    const changedStyle = {
      ...this.state.mapStyle,
      metadata: {
        ...(this.state.mapStyle as any).metadata,
        [property]: value
      }
    };

    this.onStyleChanged(changedStyle);
  };

  onStyleChanged = (newStyle: StyleSpecificationWithId, opts: OnStyleChangedOpts={}): void => {
    opts = {
      save: true,
      addRevision: true,
      initialLoad: false,
      ...opts,
    };


    // Detect empty style
    const oldStyle = this.state.mapStyle;
    const isEmptySources = !oldStyle.sources || Object.keys(oldStyle.sources).length === 0;
    const isEmptyLayers = !oldStyle.layers || oldStyle.layers.length === 0;
    const isEmptyStyle = isEmptySources && isEmptyLayers;

    // For the style object, find the urls that has "{key}" and insert the correct API keys
    // Without this, going from e.g. MapTiler to OpenLayers and back will lose the maptlier key.

    if (newStyle.glyphs && typeof newStyle.glyphs === "string") {
      newStyle.glyphs = setFetchAccessToken(newStyle.glyphs, newStyle);
    }

    if (newStyle.sprite && typeof newStyle.sprite === "string") {
      newStyle.sprite = setFetchAccessToken(newStyle.sprite, newStyle);
    }

    for (const [_sourceId, source] of Object.entries(newStyle.sources)) {
      if (source && "url" in source && typeof source.url === "string") {
        source.url = setFetchAccessToken(source.url, newStyle);
      }
    }


    if (opts.initialLoad) {
      this.getInitialStateFromUrl(newStyle);
    }

    const errors: ValidationError[] = validateStyleMin(newStyle) || [];
    // The validate function doesn't give us errors for duplicate error with
    // empty string for layer.id, manually deal with that here.
    const layerErrors: (Error | ValidationError)[] = [];
    if (newStyle && newStyle.layers) {
      const foundLayers = new global.Map();
      newStyle.layers.forEach((layer, index) => {
        if (layer.id === "" && foundLayers.has(layer.id)) {
          const error = new Error(
            `layers[${index}]: duplicate layer id [empty_string], previously used`
          );
          layerErrors.push(error);
        }
        foundLayers.set(layer.id, true);
      });
    }

    const mappedErrors: MappedError[] = layerErrors.concat(errors).map(error => {
      // Special case: Duplicate layer id
      const dupMatch = error.message.match(/layers\[(\d+)\]: (duplicate layer id "?(.*)"?, previously used)/);
      if (dupMatch) {
        const [, index, message] = dupMatch;
        return {
          message: error.message,
          parsed: {
            type: "layer",
            data: {
              index: parseInt(index, 10),
              key: "id",
              message,
            }
          }
        };
      }

      // Special case: Invalid source
      const invalidSourceMatch = error.message.match(/layers\[(\d+)\]: (source "(?:.*)" not found)/);
      if (invalidSourceMatch) {
        const [, index, message] = invalidSourceMatch;
        return {
          message: error.message,
          parsed: {
            type: "layer",
            data: {
              index: parseInt(index, 10),
              key: "source",
              message,
            }
          }
        };
      }

      const layerMatch = error.message.match(/layers\[(\d+)\]\.(?:(\S+)\.)?(\S+): (.*)/);
      if (layerMatch) {
        const [, index, group, property, message] = layerMatch;
        const key = (group && property) ? [group, property].join(".") : property;
        return {
          message: error.message,
          parsed: {
            type: "layer",
            data: {
              index: parseInt(index, 10),
              key,
              message
            }
          }
        };
      }
      else {
        return {
          message: error.message,
        };
      }
    });

    let dirtyMapStyle: StyleSpecification | undefined = undefined;
    if (errors.length > 0) {
      dirtyMapStyle = cloneDeep(newStyle);

      for (const error of errors) {
        const {message} = error;
        if (message) {
          try {
            const objPath = message.split(":")[0];
            // Errors can be deeply nested for example 'layers[0].filter[1][1][0]' we only care upto the property 'layers[0].filter'
            const unsetPath = objPath.match(/^\S+?\[\d+\]\.[^[]+/)![0];
            unset(dirtyMapStyle, unsetPath);
          }
          catch (err) {
            console.warn(message + " " + err);
          }
        }
      }
    }

    if(newStyle.glyphs !== this.state.mapStyle.glyphs) {
      this.updateFonts(newStyle.glyphs as string);
    }
    if(newStyle.sprite !== this.state.mapStyle.sprite) {
      this.updateIcons(newStyle.sprite as string);
    }

    if (opts.addRevision) {
      this.revisionStore.addRevision(newStyle);
    }
    if (opts.save) {
      this.saveStyle(newStyle);
    }

    const zoom = newStyle?.zoom;
    const center = newStyle?.center;

    this.setState({
      mapStyle: newStyle,
      dirtyMapStyle: dirtyMapStyle,
      mapView: isEmptyStyle && zoom && center ? {
        zoom: zoom,
        center: {
          lng: center[0],
          lat: center[1],
        },
        _from: "app"
      } : this.state.mapView,
      errors: mappedErrors,
    }, () => {
      this.fetchSources();
      this.setStateInUrl();
    });
  };

  onUndo = () => {
    const activeStyle = this.revisionStore.undo();

    const messages = undoMessages(this.state.mapStyle, activeStyle);
    this.onStyleChanged(activeStyle, {addRevision: false});
    this.setState({
      infos: messages,
    });
  };

  onRedo = () => {
    const activeStyle = this.revisionStore.redo();
    const messages = redoMessages(this.state.mapStyle, activeStyle);
    this.onStyleChanged(activeStyle, {addRevision: false});
    this.setState({
      infos: messages,
    });
  };

  onMoveLayer = (move: {oldIndex: number; newIndex: number}) => {
    let { oldIndex, newIndex } = move;
    let layers = this.state.mapStyle.layers;
    oldIndex = clamp(oldIndex, 0, layers.length-1);
    newIndex = clamp(newIndex, 0, layers.length-1);
    if(oldIndex === newIndex) return;

    if (oldIndex === this.state.selectedLayerIndex) {
      this.setState({
        selectedLayerIndex: newIndex
      });
    }

    layers = layers.slice(0);
    arrayMoveMutable(layers, oldIndex, newIndex);
    this.onLayersChange(layers);
  };

  onLayersChange = (changedLayers: LayerSpecification[]) => {
    const changedStyle = {
      ...this.state.mapStyle,
      layers: changedLayers
    };
    this.onStyleChanged(changedStyle);
  };

  onLayerDestroy = (index: number) => {
    const layers = this.state.mapStyle.layers;
    const remainingLayers = layers.slice(0);
    remainingLayers.splice(index, 1);
    this.onLayersChange(remainingLayers);
  };

  onLayerCopy = (index: number) => {
    const layers = this.state.mapStyle.layers;
    const changedLayers = layers.slice(0);

    const clonedLayer = cloneDeep(changedLayers[index]);
    clonedLayer.id = clonedLayer.id + "-copy";
    changedLayers.splice(index + 1, 0, clonedLayer);
    this.onLayersChange(changedLayers);
  };

  // Duplicates a layer as a different type: filter/source/source-layer/zoom
  // range are kept as-is (so it keeps targeting the same features), while
  // paint/layout properties invalid for the new type are dropped.
  onLayerDuplicateAsType = (index: number, newType: string) => {
    const layers = this.state.mapStyle.layers;
    const changedLayers = layers.slice(0);

    const clonedLayer = cloneDeep(changedLayers[index]);
    const duplicated = duplicateLayerAsType(clonedLayer, newType);
    changedLayers.splice(index + 1, 0, duplicated);
    this.onLayersChange(changedLayers);
  };

  // Duplicates an `image`-backed raster layer together with its source, as
  // two brand new, fully independent entries: its own source id (a copy of
  // the original's coordinates/url, so it starts stacked exactly on top of
  // the original) and its own companion raster layer - so moving/resizing
  // the duplicate via the gizmo later never touches the original's source.
  onLayerDuplicateImage = (index: number) => {
    const layer = this.state.mapStyle.layers[index] as LayerSpecification & {source?: string};
    const sourceId = layer.source;
    if (!sourceId) return;
    const source = this.state.mapStyle.sources[sourceId];
    if (!source) return;

    const existingSourceIds = new Set(Object.keys(this.state.mapStyle.sources));
    const newSourceId = buildDuplicateId(sourceId, existingSourceIds);
    const styleWithSource = addSource(this.state.mapStyle, newSourceId, cloneDeep(source));

    // Built from the original LAYER's id (not the new source id) so an id
    // already ending in "-image" gets "-copy" appended after it, not before.
    const existingLayerIds = new Set(styleWithSource.layers.map(l => l.id));
    const newLayerId = buildDuplicateId(layer.id, existingLayerIds);
    const newLayer = {...cloneDeep(layer), id: newLayerId, source: newSourceId} as LayerSpecification;

    const changedLayers = styleWithSource.layers.slice(0);
    changedLayers.splice(index + 1, 0, newLayer);
    this.onStyleChanged({...styleWithSource, layers: changedLayers});
  };

  onLayerVisibilityToggle = (index: number) => {
    const layers = this.state.mapStyle.layers;
    const changedLayers = layers.slice(0);

    const layer = { ...changedLayers[index] };
    const changedLayout = "layout" in layer ? {...layer.layout} : {};
    changedLayout.visibility = changedLayout.visibility === "none" ? "visible" : "none";

    layer.layout = changedLayout;
    changedLayers[index] = layer;
    this.onLayersChange(changedLayers);
  };


  onLayerTagColor = (index: number, color: string | null) => {
    const layers = this.state.mapStyle.layers.slice(0);
    const layer = { ...layers[index] } as any;
    const metadata = { ...(layer.metadata || {}) };
    if (color) {
      metadata["maputnik:tag-color"] = color;
    } else {
      delete metadata["maputnik:tag-color"];
    }
    layer.metadata = Object.keys(metadata).length > 0 ? metadata : undefined;
    layers[index] = layer;
    this.onLayersChange(layers);
  };

  onLayerIdChange = (index: number, _oldId: string, newId: string) => {
    const changedLayers = this.state.mapStyle.layers.slice(0);
    changedLayers[index] = {
      ...changedLayers[index],
      id: newId
    };

    this.onLayersChange(changedLayers);
  };

  onLayerChanged = (index: number, layer: LayerSpecification) => {
    const changedLayers = this.state.mapStyle.layers.slice(0);
    changedLayers[index] = layer;

    this.onLayersChange(changedLayers);
  };

  setMapState = (newState: MapState) => {
    this.setState({
      mapState: newState
    }, this.setStateInUrl);
  };

  setDefaultValues = (styleObj: StyleSpecificationWithId) => {
    const metadata: {[key: string]: string} = styleObj.metadata || {} as any;
    if(metadata["maputnik:renderer"] === undefined) {
      const changedStyle = {
        ...styleObj,
        metadata: {
          ...styleObj.metadata as any,
          "maputnik:renderer": "mlgljs"
        }
      };
      return changedStyle;
    } else {
      return styleObj;
    }
  };

  openStyle = (styleObj: StyleSpecificationWithId, fileHandle: FileSystemFileHandle | null) => {
    this.setState({fileHandle: fileHandle});
    styleObj = this.setDefaultValues(styleObj);
    styleObj = cleanIndoorLevelBlocks(styleObj);
    this.onStyleChanged(styleObj);
  };

  async fetchSources() {
    const sourceList: {[key: string]: SourceSpecification & {layers: string[]}} = {};
    for(const key of Object.keys(this.state.mapStyle.sources)) {
      const source = this.state.mapStyle.sources[key];
      if(source.type !== "vector" || !("url" in source)) {
        sourceList[key] = this.state.sources[key] || {...this.state.mapStyle.sources[key]};
        if (sourceList[key].layers === undefined) {
          sourceList[key].layers = [];
        }
      } else {
        sourceList[key] = {
          type: source.type,
          layers: []
        };

        let url = source.url;

        try {
          url = setFetchAccessToken(url!, this.state.mapStyle);
        } catch(err) {
          console.warn("Failed to setFetchAccessToken: ", err);
        }

        const setVectorLayers = (json:any) => {
          if(!Object.prototype.hasOwnProperty.call(json, "vector_layers")) {
            return;
          }

          for(const layer of json.vector_layers) {
            sourceList[key].layers.push(layer.id);
          }
        };

        try {
          if (url!.startsWith("pmtiles://")) {
            const json = await (new PMTiles(url!.substring(10))).getTileJson("");
            setVectorLayers(json);
          } else {
            const response = await fetch(url!, { mode: "cors" });
            const json = await response.json();
            setVectorLayers(json);
          }
        } catch(err) {
          console.error(`Failed to process source for url: '${url}', ${err}`);
        }
      }
    }

    if(!isEqual(this.state.sources, sourceList)) {
      console.debug("Setting sources", sourceList);
      this.setState({
        sources: sourceList
      });
    }
  }

  _getRenderer () {
    const metadata: {[key:string]: string} = this.state.mapStyle.metadata || {} as any;
    return metadata["maputnik:renderer"] || "mlgljs";
  }

  onMapChange = (mapView: {
    zoom: number,
    center: {
      lng: number,
      lat: number,
    },
    _from: "map" | "app"
  }) => {
    this.setState({
      mapView,
    });
  };

  mapRenderer() {
    const {mapStyle, dirtyMapStyle} = this.state;

    const mapProps = {
      mapStyle: (dirtyMapStyle || mapStyle),
      mapView: this.state.mapView,
      replaceAccessTokens: (mapStyle: StyleSpecification) => {
        return style.replaceAccessTokens(mapStyle, {
          allowFallback: true
        });
      },
      onDataChange: (e: {map: Map}) => {
        this.layerWatcher.analyzeMap(e.map);
        this.fetchSources();
      },
    };

    const renderer = this._getRenderer();
    const selectedImageSourceForMap = this.selectedImageSource();

    let mapElement;

    // Check if OL code has been loaded?
    if(renderer === "ol") {
      mapElement = <MapOpenLayers
        {...mapProps}
        onChange={this.onMapChange}
        debugToolbox={this.state.openlayersDebugOptions.debugToolbox}
        onLayerSelect={(layerId) => this.onLayerSelect(+layerId)}
      />;
    } else {

      mapElement = <MapMaplibreGl {...mapProps}
        onChange={this.onMapChange}
        options={this.state.maplibreGlDebugOptions}
        inspectModeEnabled={this.state.mapState === "inspect"}
        highlightedLayer={this.state.mapStyle.layers[this.state.selectedLayerIndex]}
        onLayerSelect={this.onLayerSelect}
        pendingImagePlacement={this.state.pendingImagePlacement}
        onImagePlaced={this.onImagePlaced}
        selectedImageSource={selectedImageSourceForMap}
        selectedImageFixedPivot={selectedImageSourceForMap ? this.isImagePivotFixed(selectedImageSourceForMap.sourceId) : false}
        onImageSourceChanged={this.onImageSourceChanged} />;
    }

    let filterName;
    if(this.state.mapState.match(/^filter-/)) {
      filterName = this.state.mapState.replace(/^filter-/, "");
    }
    const elementStyle: {filter?: string} = {};
    if (filterName) {
      elementStyle.filter = `url('#${filterName}')`;
    }

    return <div style={elementStyle} className="maputnik-map__container" data-wd-key="maplibre:container">
      {mapElement}
    </div>;
  }

  setStateInUrl = () => {
    const {mapState, mapStyle, isOpen} = this.state;
    const {selectedLayerIndex} = this.state;
    const url = new URL(location.href);
    const hashVal = hash(JSON.stringify(mapStyle));
    url.searchParams.set("layer", `${hashVal}~${selectedLayerIndex}`);

    const openModals = Object.entries(isOpen)
      .map(([key, val]) => (val === true ? key : null))
      .filter(val => val !== null);

    if (openModals.length > 0) {
      url.searchParams.set("modal", openModals.join(","));
    }
    else {
      url.searchParams.delete("modal");
    }

    if (mapState === "map") {
      url.searchParams.delete("view");
    }
    else if (mapState === "inspect") {
      url.searchParams.set("view", "inspect");
    }

    history.replaceState({selectedLayerIndex}, "Maputnik", url.href);
  };

  getInitialStateFromUrl = (mapStyle: StyleSpecification) => {
    const url = new URL(location.href);
    const modalParam = url.searchParams.get("modal");

    if (modalParam && modalParam !== "") {
      const modals = modalParam.split(",");
      const modalObj: {[key: string]: boolean} = {};
      modals.forEach(modalName => {
        modalObj[modalName] = true;
      });

      this.setState({
        isOpen: {
          ...this.state.isOpen,
          ...modalObj,
        }
      });
    }

    const view = url.searchParams.get("view");
    if (view && view !== "") {
      this.setMapState(view as MapState);
    }

    const path = url.searchParams.get("layer");
    if (path) {
      try {
        const parts = path.split("~");
        const [hashVal, selectedLayerIndex] = [
          parts[0],
          parseInt(parts[1], 10),
        ];

        let valid = true;
        if (hashVal !== "-") {
          const currentHashVal = hash(JSON.stringify(mapStyle));
          if (currentHashVal !== parseInt(hashVal, 10)) {
            valid = false;
          }
        }
        if (valid) {
          this.setState({
            selectedLayerIndex,
            selectedLayerOriginalId: mapStyle.layers[selectedLayerIndex].id,
          });
        }
      }
      catch (err) {
        console.warn(err);
      }
    }
  };

  onLayerSelect = (index: number) => {
    this.setState({
      selectedLayerIndex: index,
      selectedLayerOriginalId: this.state.mapStyle.layers[index].id,
    }, this.setStateInUrl);
  };

  // The gizmo (and later the "Image Position" panel section) only show up
  // when the selected layer's source is an `image` source - and only when
  // that layer was picked from the Layers list (the only way
  // selectedLayerIndex changes), deliberately not by clicking the image
  // itself on the map, to avoid accidental drags.
  selectedImageSource = (): { sourceId: string; source: SourceSpecification } | null => {
    const layer = this.state.mapStyle.layers[this.state.selectedLayerIndex] as any;
    const sourceId = layer?.source;
    if (!sourceId) return null;

    const source = this.state.mapStyle.sources[sourceId];
    if (!source || source.type !== "image") return null;

    return { sourceId, source };
  };

  // Whether `sourceId`'s gizmo scales around a fixed "pivot" (its own
  // center) instead of the default opposite-corner anchor, and can no
  // longer be translated by dragging its body - see ImagePositionEditor's
  // Pivot row lock icon. `ImageSourceSpecification` has no `metadata` field
  // of its own (adding one fails style validation - "unknown property"), so
  // this is tracked per-source in the *style's*
  // metadata instead, the same place ModalExport keeps its own
  // "maputnik:..." settings, keyed by source id since it's a per-image
  // setting rather than a style-wide one.
  isImagePivotFixed = (sourceId: string): boolean => {
    const metadata = this.state.mapStyle.metadata as {["maputnik:image_fixed_pivot"]?: Record<string, boolean>} | undefined;
    return !!metadata?.["maputnik:image_fixed_pivot"]?.[sourceId];
  };

  onImagePivotFixedChanged = (sourceId: string, fixed: boolean) => {
    const metadata = {...(this.state.mapStyle.metadata as Record<string, unknown> | undefined || {})};
    const flags = {...(metadata["maputnik:image_fixed_pivot"] as Record<string, boolean> | undefined || {})};
    if (fixed) {
      flags[sourceId] = true;
    } else {
      delete flags[sourceId];
    }
    metadata["maputnik:image_fixed_pivot"] = flags;
    this.onStyleChanged({...this.state.mapStyle, metadata});
  };

  // "Add Source" (image mode) hands off here instead of writing straight to
  // the style: nothing is created yet, we just start waiting for the
  // placement click on the map (see MapMaplibreGl's pendingImagePlacement).
  onImageSourcePlacementStart = (sourceId: string, source: SourceSpecification) => {
    this.setState({ pendingImagePlacement: { sourceId, source } });
  };

  onImagePlacementCancel = () => {
    this.setState({ pendingImagePlacement: null });
  };

  // The placement click landed: `source` already carries the coordinates
  // computed from that click (see MapMaplibreGl). Create the source and its
  // companion raster layer together, then select the new layer.
  onImagePlaced = (sourceId: string, source: SourceSpecification) => {
    const styleWithSource = addSource(this.state.mapStyle, sourceId, source);
    const layer = createImageRasterLayer(styleWithSource.layers, sourceId);
    const styleWithLayer = {
      ...styleWithSource,
      layers: [...styleWithSource.layers, layer],
    };

    this.onStyleChanged(styleWithLayer);
    this.setState({
      pendingImagePlacement: null,
      selectedLayerIndex: styleWithLayer.layers.length - 1,
      selectedLayerOriginalId: layer.id,
    }, this.setStateInUrl);
  };

  // Dragging the gizmo (translate/scale/rotate) calls this on every tick,
  // with opts: {addRevision: false, save: false} so a drag in progress
  // doesn't flood the undo history or the persisted style - only the final
  // call on mouseup (opts omitted, so onStyleChanged's real defaults apply)
  // commits the gesture as one undoable step.
  onImageSourceChanged = (sourceId: string, source: SourceSpecification, opts: OnStyleChangedOpts = {}) => {
    this.onStyleChanged(changeSource(this.state.mapStyle, sourceId, source), opts);
  };

  setModal(modalName: keyof AppState["isOpen"], value: boolean) {
    this.setState({
      isOpen: {
        ...this.state.isOpen,
        [modalName]: value
      }
    }, this.setStateInUrl);
  }

  toggleModal(modalName: keyof AppState["isOpen"]) {
    this.setModal(modalName, !this.state.isOpen[modalName]);
  }

  onSetFileHandle = (fileHandle: FileSystemFileHandle | null) => {
    this.setState({ fileHandle });
  };

  onChangeOpenlayersDebug = (key: keyof AppState["openlayersDebugOptions"], value: boolean) => {
    this.setState({
      openlayersDebugOptions: {
        ...this.state.openlayersDebugOptions,
        [key]: value,
      }
    });
  };

  onChangeMaplibreGlDebug = (key: keyof AppState["maplibreGlDebugOptions"], value: any) => {
    this.setState({
      maplibreGlDebugOptions: {
        ...this.state.maplibreGlDebugOptions,
        [key]: value,
      }
    });
  };

  render() {
    const layers = this.state.mapStyle.layers || [];
    const selectedLayer = layers.length > 0 ? layers[this.state.selectedLayerIndex] : undefined;

    const toolbar = <AppToolbar
      renderer={this._getRenderer()}
      mapState={this.state.mapState}
      mapStyle={this.state.mapStyle}
      inspectModeEnabled={this.state.mapState === "inspect"}
      sources={this.state.sources}
      onStyleChanged={this.onStyleChanged}
      onStyleOpen={this.onStyleChanged}
      onSetMapState={this.setMapState}
      onToggleModal={(modal: keyof AppState["isOpen"]) => this.toggleModal(modal)}
    />;

    const codeEditor = this.state.isOpen.codeEditor ? <CodeEditor
      value={this.state.mapStyle}
      onChange={(style) => this.onStyleChanged(style)}
      onClose={() => this.setModal("codeEditor", false)}
    /> : undefined;

    const layerList = <LayerList
      onMoveLayer={this.onMoveLayer}
      onLayerDestroy={this.onLayerDestroy}
      onLayerCopy={this.onLayerCopy}
      onLayerDuplicateAsType={this.onLayerDuplicateAsType}
      onLayerDuplicateImage={this.onLayerDuplicateImage}
      onLayerVisibilityToggle={this.onLayerVisibilityToggle}
      onLayerTagColor={this.onLayerTagColor}
      onLayersChange={this.onLayersChange}
      onLayerSelect={this.onLayerSelect}
      selectedLayerIndex={this.state.selectedLayerIndex}
      layers={layers}
      sources={this.state.sources}
      errors={this.state.errors}
    />;

    const layerEditor = selectedLayer ? <LayerEditor
      key={this.state.selectedLayerOriginalId}
      layer={selectedLayer}
      layerIndex={this.state.selectedLayerIndex}
      isFirstLayer={this.state.selectedLayerIndex < 1}
      isLastLayer={this.state.selectedLayerIndex === this.state.mapStyle.layers.length-1}
      sources={this.state.sources}
      mapStyleSources={this.state.mapStyle.sources}
      vectorLayers={this.state.vectorLayers}
      spec={this.state.spec}
      onMoveLayer={this.onMoveLayer}
      onLayerChanged={this.onLayerChanged}
      onLayerDestroy={this.onLayerDestroy}
      onLayerCopy={this.onLayerCopy}
      onLayerVisibilityToggle={this.onLayerVisibilityToggle}
      onLayerIdChange={this.onLayerIdChange}
      onImageSourceChanged={this.onImageSourceChanged}
      isImagePivotFixed={this.isImagePivotFixed}
      onImagePivotFixedChanged={this.onImagePivotFixedChanged}
      errors={this.state.errors}
    /> : undefined;

    const bottomPanel = (this.state.errors.length + this.state.infos.length) > 0 ? <MessagePanel
      currentLayer={selectedLayer}
      selectedLayerIndex={this.state.selectedLayerIndex}
      onLayerSelect={this.onLayerSelect}
      mapStyle={this.state.mapStyle}
      errors={this.state.errors}
      infos={this.state.infos}
    /> : undefined;


    const modals = <div>
      <ModalDebug
        renderer={this._getRenderer()}
        maplibreGlDebugOptions={this.state.maplibreGlDebugOptions}
        openlayersDebugOptions={this.state.openlayersDebugOptions}
        onChangeMaplibreGlDebug={this.onChangeMaplibreGlDebug}
        onChangeOpenlayersDebug={this.onChangeOpenlayersDebug}
        isOpen={this.state.isOpen.debug}
        onOpenToggle={() => this.toggleModal("debug")}
        mapView={this.state.mapView}
      />
      <ModalShortcuts
        isOpen={this.state.isOpen.shortcuts}
        onOpenToggle={() => this.toggleModal("shortcuts")}
      />
      <ModalSettings
        mapStyle={this.state.mapStyle}
        onStyleChanged={this.onStyleChanged}
        onChangeMetadataProperty={this.onChangeMetadataProperty}
        isOpen={this.state.isOpen.settings}
        onOpenToggle={() => this.toggleModal("settings")}
      />
      <ModalExport
        mapStyle={this.state.mapStyle}
        onStyleChanged={this.onStyleChanged}
        isOpen={this.state.isOpen.export}
        onOpenToggle={() => this.toggleModal("export")}
        fileHandle={this.state.fileHandle}
        onSetFileHandle={this.onSetFileHandle}
      />
      <ModalOpen
        isOpen={this.state.isOpen.open}
        onStyleOpen={this.openStyle}
        onOpenToggle={() => this.toggleModal("open")}
        fileHandle={this.state.fileHandle}
      />
      <ModalSources
        mapStyle={this.state.mapStyle}
        onStyleChanged={this.onStyleChanged}
        isOpen={this.state.isOpen.sources}
        onOpenToggle={() => this.toggleModal("sources")}
        onImageSourcePlacementStart={this.onImageSourcePlacementStart}
      />
      <ModalGlobalState
        mapStyle={this.state.mapStyle}
        onStyleChanged={this.onStyleChanged}
        isOpen={this.state.isOpen.globalState}
        onOpenToggle={() => this.toggleModal("globalState")}
      />
    </div>;

    return <AppLayout
      toolbar={toolbar}
      layerList={layerList}
      layerEditor={layerEditor}
      codeEditor={codeEditor}
      map={this.mapRenderer()}
      bottom={bottomPanel}
      modals={modals}
    />;
  }
}
