// client-localstorage-schema: 键带版本号，读取只发生一次并缓存（js-cache-storage）
export interface Settings {
  serviceName: string;
  defaultDomain: string;
  weeklyDigest: boolean;
  slowLinkAlert: boolean;
  pageSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  serviceName: 'Beacon 信标短链',
  defaultDomain: 'bcn.example',
  weeklyDigest: true,
  slowLinkAlert: false,
  pageSize: 10,
};

const STORAGE_KEY = 'beacon.admin.settings.v1';

let cached: Settings | null = null;

function readOnce(): Settings {
  if (cached !== null) return cached;
  cached = { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        cached = { ...cached, ...(parsed as Partial<Settings>) };
      }
    }
  } catch {
    /* file:// 或隐私模式下 localStorage 可能抛错：降级为内存态 */
  }
  return cached;
}

export function loadSettings(): Settings {
  return { ...readOnce() };
}

export function persistSettings(next: Settings): boolean {
  cached = { ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
