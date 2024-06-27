import React, {type JSX} from 'react'
import ReactDOM from 'react-dom'
import MapLibreGl, {LayerSpecification, LngLat, Map, MapMouseEvent, MapOptions, SourceSpecification, StyleSpecification} from 'maplibre-gl'
// @ts-ignore
import MapboxInspect from 'mapbox-gl-inspect'
// @ts-ignore
import colors from 'mapbox-gl-inspect/lib/colors'
import MapMaplibreGlLayerPopup from './MapMaplibreGlLayerPopup'
import MapMaplibreGlFeaturePropertyPopup, { InspectFeature } from './MapMaplibreGlFeaturePropertyPopup'
import Color from 'color'
// import MapboxDraw from '@mapbox/mapbox-gl-draw';

import ZoomControl from '../libs/zoomcontrol'
import LevelSelector from '../libs/levelselector'
import { HighlightedLayer, colorHighlightedLayer } from '../libs/highlight'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../maplibregl.css'
import '../libs/maplibre-rtl'

//@ts-ignore
import MaplibreGeocoder from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { useDrawStore } from './App'

function renderPopup(popup: JSX.Element, mountNode: ReactDOM.Container) {
  ReactDOM.render(popup, mountNode);
  return mountNode;
}

function buildInspectStyle(originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[], highlightedLayer?: HighlightedLayer) {
  const backgroundLayer = {
    "id": "background",
    "type": "background",
    "paint": {
      "background-color": '#1c1f24',
    }
  } as LayerSpecification

  const layer = colorHighlightedLayer(highlightedLayer)
  if(layer) {
    coloredLayers.push(layer)
  }

  const sources: {[key:string]: SourceSpecification} = {}
  Object.keys(originalMapStyle.sources).forEach(sourceId => {
    const source = originalMapStyle.sources[sourceId]
    if(source.type !== 'raster' && source.type !== 'raster-dem') {
      sources[sourceId] = source
    }
  })

  const inspectStyle = {
    ...originalMapStyle,
    sources: sources,
    layers: [backgroundLayer].concat(coloredLayers as LayerSpecification[])
  }
  return inspectStyle
}

type MapMaplibreGlProps = {
  onDataChange?(event: {map: Map | null}): unknown
  onLayerSelect(...args: unknown[]): unknown
  onLevelChange(level: number): void;
  mapStyle: StyleSpecification
  inspectModeEnabled: boolean
  highlightedLayer?: HighlightedLayer
  options?: Partial<MapOptions> & {
    showTileBoundaries?: boolean
    showCollisionBoxes?: boolean
    showOverdrawInspector?: boolean
  }
  replaceAccessTokens(mapStyle: StyleSpecification): StyleSpecification
  onChange(value: {center: LngLat, zoom: number}): unknown
};

type MapMaplibreGlState = {
  map: Map | null
  inspect: MapboxInspect | null
  zoom?: number
};

export default class MapMaplibreGl extends React.Component<MapMaplibreGlProps, MapMaplibreGlState> {
  static defaultProps = {
    onMapLoaded: () => {},
    onDataChange: () => {},
    onLayerSelect: () => {},
    onChange: () => {},
    options: {} as MapOptions,
  }
  container: HTMLDivElement | null = null

  constructor(props: MapMaplibreGlProps) {
    super(props)
    this.state = {
      map: null,
      inspect: null,
    }
  }

  updateMapFromProps(props: MapMaplibreGlProps) {
    if(!this.state.map) return

    //Maplibre GL now does diffing natively so we don't need to calculate
    //the necessary operations ourselves!
    this.state.map.setStyle(
      this.props.replaceAccessTokens(props.mapStyle),
      {diff: true}
    )
  }

  shouldComponentUpdate(nextProps: MapMaplibreGlProps, nextState: MapMaplibreGlState) {
    let should = false;
    try {
      should = JSON.stringify(this.props) !== JSON.stringify(nextProps) || JSON.stringify(this.state) !== JSON.stringify(nextState);
    } catch(e) {
      // no biggie, carry on
    }
    return should;
  }

  componentDidUpdate() {
    const map = this.state.map;

    this.updateMapFromProps(this.props);

    if(this.state.inspect && this.props.inspectModeEnabled !== this.state.inspect._showInspectMap) {
      // HACK: Fix for <https://github.com/maplibre/maputnik/issues/576>, while we wait for a proper fix.
      // eslint-disable-next-line
      this.state.inspect._popupBlocked = false;
      this.state.inspect.toggleInspector()
    }
    if (map) {
      if (this.props.inspectModeEnabled) {
        // HACK: We need to work out why we need to do this and what's causing
        // this error. I'm assuming an issue with maplibre-gl update and
        // mapbox-gl-inspect.
        try {
          this.state.inspect.render();
        } catch(err) {
          console.error("FIXME: Caught error", err);
        }
      }

      map.showTileBoundaries = this.props.options?.showTileBoundaries!;
      map.showCollisionBoxes = this.props.options?.showCollisionBoxes!;
      map.showOverdrawInspector = this.props.options?.showOverdrawInspector!;
    }
  }

  componentDidMount() {
    const mapOpts = {
      ...this.props.options,
      container: this.container!,
      style: this.props.mapStyle,
      hash: true,
      maxZoom: 24
    }

    const map = new MapLibreGl.Map(mapOpts);

    const mapViewChange = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      this.props.onChange({center, zoom});
    }
    mapViewChange();

    map.showTileBoundaries = mapOpts.showTileBoundaries!;
    map.showCollisionBoxes = mapOpts.showCollisionBoxes!;
    map.showOverdrawInspector = mapOpts.showOverdrawInspector!;

    this.initGeocoder(map);

    const zoomControl = new ZoomControl;
    map.addControl(zoomControl, 'top-right');

    const levelSelector = new LevelSelector;
    map.addControl(levelSelector, 'bottom-right');

    levelSelector.onLevelChange(this.props.onLevelChange);

    const nav = new MapLibreGl.NavigationControl({visualizePitch:true});
    map.addControl(nav, 'top-right');

    const tmpNode = document.createElement('div');

    const inspect = new MapboxInspect({
      popup: new MapLibreGl.Popup({
        closeOnClick: false
      }),
      showMapPopup: true,
      showMapPopupOnHover: false,
      showInspectMapPopupOnHover: true,
      showInspectButton: false,
      blockHoverPopupOnClick: true,
      assignLayerColor: (layerId: string, alpha: number) => {
        return Color(colors.brightColor(layerId, alpha)).desaturate(0.5).string()
      },
      buildInspectStyle: (originalMapStyle: StyleSpecification, coloredLayers: HighlightedLayer[]) => buildInspectStyle(originalMapStyle, coloredLayers, this.props.highlightedLayer),
      renderPopup: (features: InspectFeature[]) => {
        if(this.props.inspectModeEnabled) {
          return renderPopup(<MapMaplibreGlFeaturePropertyPopup features={features} />, tmpNode);
        } else {
          return renderPopup(<MapMaplibreGlLayerPopup features={features} onLayerSelect={this.onLayerSelectById} zoom={this.state.zoom} />, tmpNode);
        }
      }
    })
    map.addControl(inspect);

    map.on("style.load", () => {
      this.setState({
        map,
        inspect,
        zoom: map.getZoom()
      });
    })

    map.on("data", e => {
      if(e.dataType !== 'tile') return
      this.props.onDataChange!({
        map: this.state.map
      })
    })

    map.on("error", e => {
      console.log("ERROR", e);
    })

    map.on("zoom", _e => {
      this.setState({
        zoom: map.getZoom()
      });
    });

    map.on("dragend", mapViewChange);
    map.on("zoomend", mapViewChange);

    let clickEvent: Array<MapMouseEvent> = [];
    map.on('click', (e) => {
      const imageUrl = useDrawStore.getState().source.url;
      if (useDrawStore.getState().isDrawing && imageUrl) {

        clickEvent.push(e);

        if (clickEvent.length === 2) {
          const [topLeft, bottomRight] = clickEvent;
          const img = new Image();
          img.src = imageUrl;
          img.onload = () => {
            const { width, height } = img;
            // Apply corners based on image ratio and topLeftClick and bottomRightClick
            function getCorners(topLeft: LngLat, bottomRight: LngLat, width: number, height: number) {
              const ratio = width / height;
              const topLeftClick = topLeft;
              const bottomRightClick = bottomRight;
              if (ratio > 1) {
                // Image is wider than it is tall
                const newWidth = height * ratio;
                const newTopLeftX = topLeftClick.lng - (newWidth - width) / 2;
                const newBottomRightX = bottomRightClick.lng + (newWidth - width) / 2;
                return [
                  [newTopLeftX, topLeftClick.lat],
                  [newTopLeftX, bottomRightClick.lat],
                  [newBottomRightX, bottomRightClick.lat],
                  [newBottomRightX, topLeftClick.lat]
                ];
              } else {
                // Image is taller than it is wide
                const newHeight = width / ratio;
                const newTopLeftY = topLeftClick.lat - (newHeight - height) / 2;
                const newBottomRightY = bottomRightClick.lat + (newHeight - height) / 2;
                return [
                  [topLeftClick.lng, newTopLeftY],
                  [topLeftClick.lng, newBottomRightY],
                  [bottomRightClick.lng, newBottomRightY],
                  [bottomRightClick.lng, newTopLeftY]
                ];
              }
            }

            const corners = getCorners(topLeft.lngLat, bottomRight.lngLat, width, height);

            useDrawStore.getState().setSource({
              corners: {
                topLeft: corners[0],
                bottomLeft: corners[1],
                bottomRight: corners[2],
                topRight: corners[3],
              }
            });

            useDrawStore.getState().stopDrawing();
            clickEvent = [];
          };

        }
      }
    });

    map.on('draw.modechange', () => {
      if (useDrawStore.getState().isDrawing) {
        useDrawStore.getState().stopDrawing();
      }
    });

    useDrawStore.subscribe((state) => state.isDrawing, () => {
      // if (isDrawing) {
      //   map.removeControl(inspect);
      //   map.addControl(draw);
      // } else {
      //   draw.deleteAll();
      //   map.removeControl(draw);
      //   map.addControl(inspect);
      // }
    });

    useDrawStore.subscribe((state) => state.drawingMode, () => {
      if (useDrawStore.getState().isDrawing) {
        // draw.changeMode(drawingMode || MapboxDraw.constants.modes.SIMPLE_SELECT);
      }
    });

  }

  onLayerSelectById = (id: string) => {
    const index = this.props.mapStyle.layers.findIndex(layer => layer.id === id);
    this.props.onLayerSelect(index);
  }

  initGeocoder(map: Map) {
    const geocoderConfig = {
      forwardGeocode: async (config:{query: string, limit: number, language: string[]}) => {
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
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: center
              },
              place_name: feature.properties.display_name,
              properties: feature.properties,
              text: feature.properties.display_name,
              place_type: ['place'],
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
      }
    };
    const geocoder = new MaplibreGeocoder(geocoderConfig, {maplibregl: MapLibreGl});
    map.addControl(geocoder, 'top-left');
  }

  render() {
    return <div
      className="maputnik-map__map"
      role="region"
      aria-label="Map view"
      ref={x => this.container = x}
      data-wd-key="maplibre:map"
    ></div>
  }
}

