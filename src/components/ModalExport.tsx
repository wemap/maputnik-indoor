import React, { useState } from 'react';
import Slugify from 'slugify';
import { saveAs } from 'file-saver';
import { version } from 'maplibre-gl/package.json';
import { format } from '@maplibre/maplibre-gl-style-spec';
import type { StyleSpecification } from 'maplibre-gl';
import { MdFileDownload } from 'react-icons/md';

import FieldString from './FieldString';
import InputButton from './InputButton';
import Modal from './Modal';
import style from '../libs/style';
import fieldSpecAdditional from '../libs/field-spec-additional';
import { autoExportKey } from './ModalGlobalSettings';
import FieldCheckbox from './FieldCheckbox';

const MAPLIBRE_GL_VERSION = version;

type ModalExportProps = {
  mapStyle: StyleSpecification & { id: string };
  onStyleChanged(...args: unknown[]): unknown;
  isOpen: boolean;
  onOpenToggle(...args: unknown[]): unknown;
};

const ModalExport: React.FC<ModalExportProps> = ({
  mapStyle,
  onStyleChanged,
  isOpen,
  onOpenToggle,
}) => {
  const [autoExportExpressionFilter, setAutoExportExpressionFilter] = React.useState(localStorage.getItem(autoExportKey) === 'true');

  React.useEffect(() => {
    localStorage.setItem(autoExportKey, autoExportExpressionFilter.toString());
  }, [autoExportExpressionFilter]);

  const tokenizedStyle = () => {
    const mapStyleCopy = style.stripAccessTokens(style.replaceAccessTokens({ ...mapStyle }));

    return format(autoExportExpressionFilter ? style.replaceExpressionFilter(mapStyleCopy) : mapStyleCopy);
  };

  const exportName = () => {
    if (mapStyle.name) {
      return Slugify(mapStyle.name, {
        replacement: '_',
        remove: /[*\-+~.()'"!:]/g,
        lower: true,
      });
    } else {
      return mapStyle.id;
    }
  };

  const downloadHtml = () => {
    const tokenStyle = tokenizedStyle();
    const htmlTitle = mapStyle.name || "Map";
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${htmlTitle}</title>
  <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no" />
  <script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_GL_VERSION}/dist/maplibre-gl.js"></script>
  <link href="https://unpkg.com/maplibre-gl@${MAPLIBRE_GL_VERSION}/dist/maplibre-gl.css" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
      const map = new maplibregl.Map({
         container: 'map',
         style: ${tokenStyle},
      });
      map.addControl(new maplibregl.NavigationControl());
  </script>
</body>
</html>
`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const exportNameValue = exportName();
    saveAs(blob, exportNameValue + ".html");
  };

  const downloadStyle = () => {
    const tokenStyle = tokenizedStyle();
    const blob = new Blob([tokenStyle], { type: "application/json;charset=utf-8" });
    const exportNameValue = exportName();
    saveAs(blob, exportNameValue + ".json");
  };

  const changeMetadataProperty = (property: string, value: any) => {
    const changedStyle = {
      ...mapStyle,
      metadata: {
        ...(mapStyle.metadata as any),
        [property]: value,
      },
    };
    onStyleChanged(changedStyle);
  };

  return (
    <Modal
      data-wd-key="modal:export"
      isOpen={isOpen}
      onOpenToggle={onOpenToggle}
      title={'Export Style'}
      className="maputnik-export-modal"
    >
      <section className="maputnik-modal-section">
        <h1>Download Style</h1>
        <p>
          Download a JSON style to your computer.
        </p>

        <div>
          <FieldCheckbox
            label={'Auto export filter as expression'}
            value={autoExportExpressionFilter}
            onChange={(autoExport) => {
              setAutoExportExpressionFilter(Boolean(autoExport));
            }}
          />
          <FieldString
            label={fieldSpecAdditional.maputnik.maptiler_access_token.label}
            fieldSpec={fieldSpecAdditional.maputnik.maptiler_access_token}
            value={(mapStyle.metadata || {} as any)['maputnik:openmaptiles_access_token']}
            onChange={changeMetadataProperty.bind(null, "maputnik:openmaptiles_access_token")}
          />
          <FieldString
            label={fieldSpecAdditional.maputnik.thunderforest_access_token.label}
            fieldSpec={fieldSpecAdditional.maputnik.thunderforest_access_token}
            value={(mapStyle.metadata || {} as any)['maputnik:thunderforest_access_token']}
            onChange={changeMetadataProperty.bind(null, "maputnik:thunderforest_access_token")}
          />
        </div>

        <div className="maputnik-modal-export-buttons">
          <InputButton onClick={downloadStyle}>
            <MdFileDownload />
            Download Style
          </InputButton>

          <InputButton onClick={downloadHtml}>
            <MdFileDownload />
            Download HTML
          </InputButton>
        </div>
      </section>
    </Modal>
  );
};

export default ModalExport;
