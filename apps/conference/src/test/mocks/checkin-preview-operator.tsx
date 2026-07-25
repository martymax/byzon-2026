'use client';

import { CheckinOperator } from '../../components/checkin-operator';
import {
  browserCheckinCamera,
  type CheckinCameraPort,
  type CheckinScenarioCode,
} from '../../components/checkin-scanner';

export const CHECKIN_PREVIEW_BOUNDARY_MARKER =
  'BYZON_CHECKIN_PREVIEW_SCENARIOS_F5';

export const checkinPreviewScenarioCodes: readonly CheckinScenarioCode[] =
  Object.freeze([
    { code: 'DEMO-VALID', label: 'Platná vstupenka' },
    { code: 'DEMO-DUPLICATE', label: 'Duplicitní vstup' },
    { code: 'DEMO-CANCELLED', label: 'Zrušená vstupenka' },
    { code: 'DEMO-REFUNDED', label: 'Vrácená vstupenka' },
    { code: 'DEMO-BLOCKED', label: 'Blokovaná vstupenka' },
    { code: 'DEMO-UNKNOWN', label: 'Neznámý kód' },
    { code: 'DEMO-ERROR', label: 'Chyba spojení se službou' },
  ]);

const previewCamera: CheckinCameraPort = Object.freeze({
  ...browserCheckinCamera,
  readSyntheticCredential: async () => checkinPreviewScenarioCodes[0]!.code,
});

export const CheckinPreviewOperator = () => (
  <div data-checkin-preview-boundary={CHECKIN_PREVIEW_BOUNDARY_MARKER}>
    <CheckinOperator
      camera={previewCamera}
      scenarioCodes={checkinPreviewScenarioCodes}
    />
  </div>
);
