import React from 'react';
import { useBootstrapQuery } from '~features/bootstrap/hooks/useBootstrapQuery';
import { FieldsGrid } from './controls';
import { optionFieldsFrom } from '../helpers/fields';
import type { BootstrapPayload } from '~types/index';
import type { WizardValues } from '~types/index';

/**
 * The option-backed fields (品类 / 时区 / 通知方式 / 发票类型) are the only part of the form
 * that cannot render without server data, so they get their own Suspense boundary and their
 * own useSuspenseQuery consumer. Step 1 and step 3 each mount one, on the same query key —
 * group F reads the request log to prove the second consumer cost nothing.
 */
export const OptionFields: React.FC<{
  names: readonly (keyof WizardValues)[];
  reveal: boolean;
  chips: Partial<Record<keyof WizardValues, { asyncText?: string; dirtyText?: string; countText?: string }>>;
}> = ({ names, reveal, chips }) => {
  const { data } = useBootstrapQuery();
  return <FieldsGrid names={names} reveal={reveal} chips={chips} descriptors={optionFieldsFrom(data as BootstrapPayload, names)} />;
};

export default OptionFields;
