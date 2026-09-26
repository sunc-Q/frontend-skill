import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { STYLES, type StyleId } from './registry';

/**
 * The skill's styling clause says: "Use `sx` prop for MUI components / Theme access:
 * (theme) => theme.palette.primary.main". Doing that literally makes the emotion class
 * hash (and, with cssVariables, the inline custom-property bag on the theme root) differ
 * per skin, which is exactly what breaks "three styles, one DOM".
 *
 * So the theme is derived from the same token object the skin uses (one source, two
 * derivations) and the components below only pass *layout* sx — colours come from the
 * [data-fd-style] layer. Group C asserts both halves: identical normalised DOM (class and
 * style attributes stripped) and a non-empty colour set actually applied per skin.
 */
export function buildTheme(id: StyleId): Theme {
  const t = STYLES[id];
  const c = t.color;
  return createTheme({
    cssVariables: true,
    shape: { borderRadius: t.radius === '0px' ? 0 : 4 },
    typography: {
      fontFamily: t.fontUi,
      fontSize: 14,
      h1: { fontFamily: t.fontUi, fontWeight: 700, fontSize: '1.6rem' },
      h2: { fontFamily: t.fontUi, fontWeight: 700, textTransform: t.headTransform },
      body1: { fontSize: t.bodySize },
    },
    palette: {
      mode: id === 'pcb-green' ? 'dark' : 'light',
      background: { default: c.bg, paper: c.paper },
      text: { primary: c.text, secondary: c.muted },
      primary: { main: c.primary, contrastText: c.onPrimary },
      success: { main: c.success },
      warning: { main: c.warning },
      error: { main: c.danger },
      divider: c.border,
    },
    components: {
      MuiTextField: { defaultProps: { size: 'small', variant: 'outlined', fullWidth: true } },
      MuiSelect: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiButton: { defaultProps: { disableElevation: true, size: 'medium' } },
    },
  });
}
