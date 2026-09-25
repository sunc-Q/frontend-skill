import { requestLog } from './apiClient';
import { buildDataset } from './dataset';
import { STYLES, paletteOf, styleCss, STYLE_IDS } from './style/registry';
import { CONTROL_EARLY_RETURN } from './ablation';

export interface FdBridge {
  version: string;
  requestLog: () => ReturnType<typeof requestLog>;
  facts: ReturnType<typeof buildDataset>;
  styles: typeof STYLES;
  styleIds: StyleIdList;
  paletteOf: (id: keyof typeof STYLES) => string[];
  styleCss: (id: keyof typeof STYLES) => string;
  earlyReturnControl: boolean;
}

type StyleIdList = typeof STYLE_IDS;

/** Read-only window for the verification scripts: no product behaviour depends on it. */
export function installBridge(): void {
  const bridge: FdBridge = {
    version: '20260926-07',
    requestLog,
    facts: buildDataset(),
    styles: STYLES,
    styleIds: STYLE_IDS,
    paletteOf,
    styleCss,
    earlyReturnControl: CONTROL_EARLY_RETURN,
  };
  (window as unknown as { __fdBridge: FdBridge }).__fdBridge = bridge;
}
