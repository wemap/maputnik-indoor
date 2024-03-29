import React from 'react'
import latest from '@maplibre/maplibre-gl-style-spec/dist/latest.json'
import type { StyleSpecification } from 'maplibre-gl'

import Modal from './Modal'
import FieldCheckbox from './FieldCheckbox'

type ModalGlobalSettingsProps = {
  mapStyle: StyleSpecification
  onStyleChanged(...args: unknown[]): unknown
  onChangeMetadataProperty(...args: unknown[]): unknown
  isOpen: boolean
  onOpenToggle(...args: unknown[]): unknown
};

const storagePrefix = "maputnik"
export const autoExportKey = [storagePrefix, 'autoExportExpressionFilter'].join(':');

const ModalGlobalSettings = (props: ModalGlobalSettingsProps) => {
  const [autoExportExpressionFilter, setAutoExportExpressionFilter] = React.useState(localStorage.getItem(autoExportKey) === 'true');

  React.useEffect(() => {
    localStorage.setItem(autoExportKey, autoExportExpressionFilter.toString());
  }, [autoExportExpressionFilter]);

  return <Modal
    data-wd-key="modal:global"
    isOpen={props.isOpen}
    onOpenToggle={props.onOpenToggle}
    title={'Global Settings'}
  >
    <div className="modal:global">
      <FieldCheckbox
        label={'Auto export filter as expression'}
        value={autoExportExpressionFilter}
        onChange={autoExport => {
          setAutoExportExpressionFilter(Boolean(autoExport))
        }}
      />
    </div>
  </Modal>
}

export default ModalGlobalSettings;
