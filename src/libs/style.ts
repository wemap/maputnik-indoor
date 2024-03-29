import { derefLayers, migrate } from '@maplibre/maplibre-gl-style-spec'
import type {StyleSpecification, LayerSpecification, ExpressionSpecification, LegacyFilterSpecification} from 'maplibre-gl'
import tokens from '../config/tokens.json'
import { combiningFilterOps } from '../libs/filterops'

// Empty style is always used if no style could be restored or fetched
const emptyStyle = ensureStyleValidity({
  version: 8,
  sources: {},
  layers: [],
})

function generateId() {
  return Math.random().toString(36).substring(2, 9)
}

function ensureHasId(style: StyleSpecification & { id?: string }): StyleSpecification & { id: string } {
  if(!('id' in style) || !style.id) {
    style.id = generateId();
    return style as StyleSpecification & { id: string };
  }
  return style as StyleSpecification & { id: string };
}

function combiningFilter(filterProps: any[]): LegacyFilterSpecification | ExpressionSpecification {
  const filter = filterProps || ['all'];

  if (!Array.isArray(filter)) {
    return filter;
  }

  let combiningOp = filter[0];
  let filters = filter.slice(1);

  if (combiningFilterOps.indexOf(combiningOp) < 0) {
    combiningOp = 'all';
    filters = [filter.slice(0)];
  }

  return [combiningOp, ...filters] as LegacyFilterSpecification | ExpressionSpecification;
}

function migrateFilter(filter: LegacyFilterSpecification | ExpressionSpecification) {
  // This "any" can be removed in latest version of maplibre where maplibre re-exported types from style-spec
  return (migrate(createStyleFromFilter(filter) as any).layers[0] as any).filter;
}

function createStyleFromFilter(filter: LegacyFilterSpecification | ExpressionSpecification): StyleSpecification & { id: string } {
  return {
    "id": "tmp",
    "version": 8,
    "name": "Empty Style",
    "metadata": { "maputnik:renderer": "mlgljs" },
    "sources": {
      "tmp": {
        "type": "geojson",
        "data": ''
      }
    },
    "sprite": "",
    "glyphs": "https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf",
    "layers": [
      {
        id: "tmp",
        type: "fill",
        source: "tmp",
        filter: filter,
      },
    ],
  };
}

function replaceExpressionFilter(mapStyle: StyleSpecification): StyleSpecification {
  const changedLayers = mapStyle.layers.map(layer => {
    const changedLayer: LayerSpecification & { filter?: any } = { ...layer }
    if (changedLayer.filter) {
      changedLayer.filter = migrateFilter(combiningFilter(changedLayer.filter));
    }

    return changedLayer
  })

  return {
    ...mapStyle,
    layers: changedLayers
  }
}

function ensureHasNoInteractive(style: StyleSpecification & {id: string}) {
  const changedLayers = style.layers.map(layer => {
    const changedLayer: LayerSpecification & { interactive?: any } = { ...layer }
    delete changedLayer.interactive
    return changedLayer
  })

  return {
    ...style,
    layers: changedLayers
  }
}

function ensureHasNoRefs(style: StyleSpecification & {id: string}) {
  return {
    ...style,
    layers: derefLayers(style.layers)
  }
}

function ensureStyleValidity(style: StyleSpecification): StyleSpecification & { id: string } {
  return ensureHasNoInteractive(ensureHasNoRefs(ensureHasId(style)))
}

function indexOfLayer(layers: LayerSpecification[], layerId: string) {
  for (let i = 0; i < layers.length; i++) {
    if(layers[i].id === layerId) {
      return i
    }
  }
  return null
}

function getAccessToken(sourceName: string, mapStyle: StyleSpecification, opts: {allowFallback?: boolean}) {
  if(sourceName === "thunderforest_transport" || sourceName === "thunderforest_outdoors") {
    sourceName = "thunderforest"
  }

  const metadata = mapStyle.metadata || {} as any;
  let accessToken = metadata[`maputnik:${sourceName}_access_token`]

  if(opts.allowFallback && !accessToken) {
    accessToken = tokens[sourceName as keyof typeof tokens]
  }

  return accessToken;
}

function replaceSourceAccessToken(mapStyle: StyleSpecification, sourceName: string, opts={}) {
  const source = mapStyle.sources[sourceName]
  if(!source) return mapStyle
  if(!("url" in source) || !source.url) return mapStyle

  const accessToken = getAccessToken(sourceName, mapStyle, opts)

  if(!accessToken) {
    // Early exit.
    return mapStyle;
  }

  const changedSources = {
    ...mapStyle.sources,
    [sourceName]: {
      ...source,
      url: source.url.replace('{key}', accessToken)
    }
  }
  const changedStyle = {
    ...mapStyle,
    sources: changedSources
  }
  return changedStyle
}

function replaceAccessTokens(mapStyle: StyleSpecification, opts={}) {
  let changedStyle = mapStyle

  Object.keys(mapStyle.sources).forEach((sourceName) => {
    changedStyle = replaceSourceAccessToken(changedStyle, sourceName, opts);
  })

  if (mapStyle.glyphs && (mapStyle.glyphs.match(/\.tilehosting\.com/) || mapStyle.glyphs.match(/\.maptiler\.com/))) {
    const newAccessToken = getAccessToken("openmaptiles", mapStyle, opts);
    if (newAccessToken) {
      changedStyle = {
        ...changedStyle,
        glyphs: mapStyle.glyphs.replace('{key}', newAccessToken)
      }
    }
  }

  return changedStyle
}

function stripAccessTokens(mapStyle: StyleSpecification) {
  const changedMetadata = {
    ...mapStyle.metadata as any
  };
  delete changedMetadata['maputnik:openmaptiles_access_token'];
  return {
    ...mapStyle,
    metadata: changedMetadata
  };
}

export default {
  ensureStyleValidity,
  emptyStyle,
  indexOfLayer,
  generateId,
  replaceExpressionFilter,
  getAccessToken,
  replaceAccessTokens,
  stripAccessTokens,
}
