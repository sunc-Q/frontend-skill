import React from 'react';
import { TextField } from '@mui/material';
import { useFormContext } from 'react-hook-form';
import { ARM_NAME, MEMO_ARM, meter } from '@/lib/ablation';
import { ASYNC_BAD } from '../helpers/asyncText';
import type { OptionSpec, WizardValues } from '~types/index';

/**
 * One leaf component per registered field; every prop is a primitive or a module-level
 * stable array, which is the precondition for the memo arm to do anything at all.
 *
 * Two arms of the *same* leaf live here and nothing else differs:
 *   memo arm  — React.memo(...)                        (the skill's "useCallback for
 *               handlers passed to children" + "React.memo: expensive components")
 *   plain arm — the same function, unmemoised, inline handlers
 * check-dom mounts both bundles and compares rendered DOM bytes and renders-per-keystroke.
 *
 * register() is called inside the leaf, so no handler crosses the props boundary — that is
 * precisely why the "wrap handlers in useCallback" clause has nothing to bite on here, and
 * group N measures whether the memo wrapper earns its cost instead of assuming it does.
 */

export type FieldKind = 'text' | 'tel' | 'counter' | 'select' | 'switch';

export interface FieldLeafProps {
  name: keyof WizardValues;
  label: string;
  kind?: FieldKind;
  hint?: string;
  options?: readonly OptionSpec[];
  /** surface the error even though the field itself was never touched (step gate pressed 下一步) */
  reveal?: boolean;
  asyncText?: string;
  dirtyText?: string;
  countText?: string;
  placeholder?: string;
  wide?: boolean;
  ariaLabel?: string;
}

function FieldLeafBody(props: FieldLeafProps): React.JSX.Element {
  const {
    name,
    label,
    kind = 'text',
    hint = '',
    options,
    reveal = false,
    asyncText = '',
    dirtyText = '',
    countText = '',
    placeholder = '',
    wide = false,
    ariaLabel = '',
  } = props;
  meter(`field:${ARM_NAME}:${name}`);
  const {
    register,
    formState: { errors, touchedFields },
  } = useFormContext<WizardValues>();
  const err = errors[name];
  const show = err !== undefined && (touchedFields[name] === true || reveal);
  /**
   * The async verdict drives the border here rather than through setError: react-hook-form's
   * resolver re-runs on every change and wipes externally injected errors, so a taken name
   * would flicker back to neutral. asyncText is derived state, so it survives.
   */
  const asyncBad = ASYNC_BAD.has(asyncText);
  const verdict = show || asyncBad ? 'error' : asyncText === '' ? undefined : asyncText === '可用' ? 'ok' : 'pending';

  return (
    <span className="fd-field" data-field-id={name} data-state={verdict} data-wide={wide ? '1' : undefined}>
      <span className="fd-label" data-field-label={name}>
        {label}
        {requiredMark(kind, name) ? <span className="fd-required"> ·必填</span> : null}
      </span>
      {kind === 'select' ? (
        <select
          className="fd-select"
          data-field={name}
          aria-label={ariaLabel === '' ? label : ariaLabel}
          {...register(name)}
        >
          <option value="">（未选择）</option>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : kind === 'switch' ? (
        <span className="fd-switch">
          <input type="checkbox" data-field={name} id={`sw-${name}`} {...register(name)} />
          <label htmlFor={`sw-${name}`}>{label}</label>
        </span>
      ) : (
        <TextField
          label={label}
          placeholder={placeholder}
          type={kind === 'tel' ? 'tel' : 'text'}
          size="small"
          fullWidth
          inputProps={{ 'data-field': name, 'aria-invalid': show || asyncBad ? 'true' : 'false' }}
          {...register(name)}
        />
      )}
      <span className="fd-chips" data-chips={name}>
        {show ? (
          <span className="fd-chip" data-kind="error" data-error-for={name}>
            {String(err?.message ?? '')}
          </span>
        ) : null}
        {asyncText === '' ? null : (
          <span className="fd-chip" data-kind="pending" data-async-for={name}>
            {asyncText}
          </span>
        )}
        {dirtyText === '' ? null : (
          <span className="fd-chip" data-kind="dirty" data-dirty-for={name}>
            {dirtyText}
          </span>
        )}
        {countText === '' ? null : (
          <span className="fd-count" data-count-for={name}>
            {countText}
          </span>
        )}
        {hint === '' ? null : (
          <span className="fd-help" data-help-for={name}>
            {hint}
          </span>
        )}
      </span>
    </span>
  );
}

const REQUIRED = new Set<string>([
  'storeName',
  'subdomain',
  'tagline',
  'category',
  'timezone',
  'plan',
  'seats',
  'billing',
  'currency',
  'accountType',
  'contactEmail',
  'invoiceType',
  'agree',
]);

const requiredMark = (kind: FieldKind, name: keyof WizardValues): boolean =>
  REQUIRED.has(name) && kind !== 'switch';

const FieldLeafPlain: React.FC<FieldLeafProps> = (props) => FieldLeafBody(props);
/** default shallow prop compare — every prop is a primitive or a module-level stable array */
const FieldLeafMemo: React.FC<FieldLeafProps> = React.memo((props) => FieldLeafBody(props));

export const FieldLeaf: React.FC<FieldLeafProps> = MEMO_ARM ? FieldLeafMemo : FieldLeafPlain;

export default FieldLeaf;
