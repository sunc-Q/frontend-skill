import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { STYLES, type StyleId, type StyleTokens } from './registry';

/** "Theme access: (theme) => theme.palette.primary.main" — every MUI colour is a token. */
function reliefShadow(t: StyleTokens): string {
  if (t.shadowLevel === 'double-relief') {
    return `8px 8px 18px ${t.color.reliefDark}, -8px -8px 18px ${t.color.reliefLight}`;
  }
  if (t.shadowLevel === 'luminous') {
    return `0 0 18px rgba(0,0,0,.6)`;
  }
  return 'none';
}

export function buildTheme(id: StyleId): Theme {
  const t = STYLES[id];
  const c = t.color;
  return createTheme({
    shape: { borderRadius: t.shape },
    typography: {
      fontFamily: t.fontUi,
      h6: {
        fontSize: t.headingSize,
        fontWeight: id === 'bitmap' ? 700 : 600,
        textTransform: t.headTransform,
        letterSpacing: t.letterSpacing,
      },
      subtitle2: { fontSize: '0.94rem', fontWeight: 600, letterSpacing: t.letterSpacing },
      body2: { fontSize: t.bodySize },
      caption: { fontSize: '0.78rem', color: c.muted, letterSpacing: t.letterSpacing },
      button: { fontSize: '0.84rem', textTransform: id === 'bitmap' ? 'uppercase' : 'none', fontWeight: 600 },
    },
    palette: {
      mode: id === 'phosphor' ? 'dark' : 'light',
      background: { default: c.bg, paper: c.paper },
      text: { primary: c.text, secondary: c.muted },
      primary: { main: c.primary, contrastText: c.onPrimary },
      secondary: { main: c.muted, contrastText: c.text },
      success: { main: c.success },
      warning: { main: c.warning },
      error: { main: c.danger },
      divider: c.border,
    },
    components: {
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: {
            background: id === 'bitmap' ? c.text : c.paper,
            color: id === 'bitmap' ? c.onPrimary : c.text,
            border: `${t.borderWidth}px solid ${id === 'bitmap' ? c.text : c.border}`,
            boxShadow: reliefShadow(t),
            letterSpacing: t.letterSpacing,
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `${t.borderWidth}px solid ${c.border}`,
            boxShadow: reliefShadow(t),
          },
        },
      },
      MuiButton: {
        defaultProps: { disableRipple: id === 'bitmap', disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: t.shape,
            border: `${Math.max(1, t.borderWidth)}px solid ${id === 'neumorph' ? c.paper : c.border}`,
            textTransform: t.headTransform,
            letterSpacing: t.letterSpacing,
            padding: '8px 14px',
            boxShadow: id === 'neumorph' ? reliefShadow(t) : 'none',
          },
          containedPrimary: {
            background: c.primary,
            color: c.onPrimary,
            '&:hover': { background: c.primary },
          },
          outlined: { borderColor: c.border },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: id === 'neumorph' ? 999 : t.shape,
            border: `${Math.max(1, t.borderWidth)}px solid ${c.border}`,
            background: id === 'bitmap' ? 'transparent' : c.paperAlt,
            color: c.text,
            fontFamily: t.fontNum,
            fontWeight: 600,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: c.border,
            color: c.text,
            fontFamily: id === 'bitmap' ? t.fontNum : undefined,
          },
          head: {
            color: id === 'bitmap' ? c.onPrimary : c.muted,
            background: id === 'bitmap' ? c.text : 'transparent',
            fontFamily: t.fontNum,
            fontSize: '0.78rem',
            letterSpacing: t.letterSpacing,
            textTransform: t.headTransform,
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: { root: { border: `${Math.max(1, t.borderWidth)}px solid ${c.border}`, borderRadius: t.shape } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: t.shape,
            background: id === 'neumorph' ? c.paper : c.paperAlt,
            boxShadow: id === 'neumorph' ? `inset 4px 4px 10px ${c.reliefDark}, inset -4px -4px 10px ${c.reliefLight}` : 'none',
          },
          notchedOutline: { borderStyle: id === 'bitmap' ? 'dashed' : 'solid' },
        },
      },
      MuiInputBase: { styleOverrides: { root: { color: c.text } } },
      MuiSwitch: {
        styleOverrides: {
          root: { height: 24 },
          track: { background: id === 'bitmap' ? c.paper : c.paperAlt, border: `1px solid ${c.border}`, opacity: 1, borderRadius: t.shape },
          thumb: { background: id === 'bitmap' ? c.text : c.primary, borderRadius: id === 'neumorph' ? 999 : t.shape },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { background: c.paperAlt, borderRadius: t.shape }, bar: { background: c.primary } } },
      MuiTab: {
        styleOverrides: {
          root: {
            color: id === 'bitmap' ? c.onPrimary : c.muted,
            textTransform: t.headTransform,
            letterSpacing: t.letterSpacing,
            fontFamily: t.fontNum,
          },
          selected: { color: id === 'bitmap' ? c.onPrimary : c.primary },
        },
      },
      MuiTabs: { styleOverrides: { indicator: { background: id === 'bitmap' ? c.onPrimary : c.primary, height: id === 'phosphor' ? 3 : 2 } } },
    },
  });
}
