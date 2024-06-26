import React from 'react'
import IconLayer from './IconLayer'
import type {InspectFeature} from './MapMaplibreGlFeaturePropertyPopup';

function groupFeaturesBySourceLayer(features: InspectFeature[]) {
  const sources: {[key: string]: InspectFeature[]} = {}

  const returnedFeatures: {[key: string]: number} = {}

  features.forEach(feature => {
    if(Object.prototype.hasOwnProperty.call(returnedFeatures, feature.layer.id)) {
      returnedFeatures[feature.layer.id]++

      const featureObject = sources[feature.layer['source-layer']].find((f: InspectFeature) => f.layer.id === feature.layer.id)

      featureObject!.counter = returnedFeatures[feature.layer.id]
    } else {
      sources[feature.layer['source-layer']] = sources[feature.layer['source-layer']] || []
      sources[feature.layer['source-layer']].push(feature)

      returnedFeatures[feature.layer.id] = 1
    }
  })

  return sources
}

type FeatureLayerPopupProps = {
  onLayerSelect(layerId: string): unknown
  features: InspectFeature[]
  zoom?: number
};

class FeatureLayerPopup extends React.Component<FeatureLayerPopupProps> {
  _getFeatureColor(feature: InspectFeature, _zoom?: number) {
    // Guard because openlayers won't have this
    if (!feature.layer.paint) {
      return;
    }

    try {
      const paintProps = feature.layer.paint;
      let propName;

      if(Object.prototype.hasOwnProperty.call(paintProps, "text-color") && paintProps["text-color"]) {
        propName = "text-color";
      }
      else if (Object.prototype.hasOwnProperty.call(paintProps, "fill-color") && paintProps["fill-color"]) {
        propName = "fill-color";
      }
      else if (Object.prototype.hasOwnProperty.call(paintProps, "line-color") && paintProps["line-color"]) {
        propName = "line-color";
      }
      else if (Object.prototype.hasOwnProperty.call(paintProps, "fill-extrusion-color") && paintProps["fill-extrusion-color"]) {
        propName = "fill-extrusion-color";
      }

      if(propName) {
        const color = feature.layer.paint[propName];
        return String(color);
      }
      else {
        // Default color
        return "black";
      }
    }
    // This is quite complex, just incase there's an edgecase we're missing
    // always return black if we get an unexpected error.
    catch (err) {
      console.warn("Unable to get feature color, error:", err);
      return "black";
    }
  }

  render() {
    const sources = groupFeaturesBySourceLayer(this.props.features)

    const items = Object.keys(sources).map(vectorLayerId => {
      const layers = sources[vectorLayerId].map((feature: InspectFeature, idx: number) => {
        const featureColor = this._getFeatureColor(feature, this.props.zoom);

        return <div
          key={idx}
          className="maputnik-popup-layer"
        >
          <div
            className="maputnik-popup-layer__swatch"
            style={{background: featureColor}}
          ></div>
          <label
            className="maputnik-popup-layer__label"
            onClick={() => {
              this.props.onLayerSelect(feature.layer.id)
            }}
          >
            {feature.layer.type &&
              <IconLayer type={feature.layer.type} style={{
                width: 14,
                height: 14,
                paddingRight: 3
              }}/>
            }
            {feature.layer.id}
            {feature.counter && <span> × {feature.counter}</span>}
          </label>
        </div>
      })
      return <div key={vectorLayerId}>
        <div className="maputnik-popup-layer-id">{vectorLayerId}</div>
        {layers}
      </div>
    })

    return <div className="maputnik-feature-layer-popup">
      {items}
    </div>
  }
}


export default FeatureLayerPopup
