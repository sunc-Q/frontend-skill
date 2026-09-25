import type { Settings } from '~types/index';

/** Same storage key + schema as the 17:00 round, so the two rounds persist interchangeably. */
export const SETTINGS_KEY = 'beacon.admin.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  serviceName: 'Beacon 信标短链',
  defaultDomain: 'bcn.example',
  weeklyDigest: true,
  slowLinkAlert: false,
  pageSize: 10,
};

export interface SettingsApi {
  load: () => Settings;
  save: (next: Settings) => boolean;
}

/** The skill's api-service clause assumes HTTP; settings are device-local, so this is the same shape over localStorage. */
export const settingsApi: SettingsApi = {
  load: () => {
    const base: Settings = { ...DEFAULT_SETTINGS };
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw === null) return base;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return base;
      const patch = parsed as Partial<Settings>;
      return {
        serviceName: typeof patch.serviceName === 'string' ? patch.serviceName : base.serviceName,
        defaultDomain: typeof patch.defaultDomain === 'string' ? patch.defaultDomain : base.defaultDomain,
        weeklyDigest: typeof patch.weeklyDigest === 'boolean' ? patch.weeklyDigest : base.weeklyDigest,
        slowLinkAlert: typeof patch.slowLinkAlert === 'boolean' ? patch.slowLinkAlert : base.slowLinkAlert,
        pageSize: Number.isInteger(patch.pageSize) ? (patch.pageSize as number) : base.pageSize,
      };
    } catch {
      return base;
    }
  },
  save: (next: Settings) => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return true;
    } catch {
      return false;
    }
  },
};

export default settingsApi;
