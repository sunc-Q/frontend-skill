import React, { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@mui/material';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BRAND, SAMPLE_VALUES, STEPS, STEP_FIELDS } from '@/lib/facts';
import { clearDraft, draftRaw, loadDraft, saveDraft } from '@/lib/draft';
import { ARM_NAME, meter, renderCounts } from '@/lib/ablation';
import { useMuiSnackbar } from '@/hooks/useMuiSnackbar';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';
import { AccountCards, AddonField, BillingCards, FieldsGrid, PlanCards, SeatsField } from './controls';
import type { FieldChips } from './controls';
import { OptionFields } from './OptionFields';
import { AddonLegend, CompletenessPanel, DraftBar, StepRail, SummaryPanel } from './panels';
import { allIssues, stepValid, wizardSchema } from '../helpers/wizardSchema';
import { annualSaving, clampSeats, quote } from '../helpers/pricing';
import { asyncBlockers, buildPayload, submitToken } from '../helpers/payload';
import type { AsyncField } from '../helpers/payload';
import { useWizardAsyncFields } from '../hooks/useWizardAsyncFields';
import { ASYNC_DEBOUNCE_MS, useDebouncedCallback } from '../hooks/useDebouncedCallback';
import { useWizardSteps } from '../hooks/useWizardSteps';
import { VERDICT_LABEL } from '../helpers/asyncText';
import { wizardApi } from '../api/wizardApi';
import { FIELD_LABEL } from '../helpers/fields';
import { charCount, money } from '@/lib/format';
import type { AddonId, Billing, PlanId, StepId, WizardValues } from '~types/index';

/** split evidence: the review panel is only needed once the first three steps pass */
const ReviewStep = lazy(() => import('./StepReview'));

const IDENTITY_STATIC: (keyof WizardValues)[] = ['storeName', 'subdomain', 'tagline', 'supportPhone'];
const IDENTITY_OPTIONS: (keyof WizardValues)[] = ['category', 'timezone', 'notify'];
const PAYMENT_PERSONAL: (keyof WizardValues)[] = ['realName', 'idLast4'];
const PAYMENT_ENTERPRISE: (keyof WizardValues)[] = ['companyName', 'uscc'];
const PAYMENT_ALWAYS: (keyof WizardValues)[] = ['contactEmail'];
const PAYMENT_INVOICE: (keyof WizardValues)[] = ['invoiceType', 'taxTitle', 'taxNo'];
const PAYMENT_AGREE: (keyof WizardValues)[] = ['agree'];

interface SubmitState {
  phase: 'idle' | 'sending' | 'done' | 'failed';
  text: string;
  orderId: string | null;
  requests: number;
}

export const WizardPage: React.FC = () => {
  meter('page:WizardPage');
  const draft = useMemo(() => loadDraft(), []);
  const snackbar = useMuiSnackbar();

  const methods = useForm<WizardValues>({
    resolver: zodResolver(wizardSchema),
    mode: 'onTouched',
    defaultValues: draft.values,
  });
  const { control, setValue, getValues, setError, clearErrors, trigger, handleSubmit, formState } = methods;

  const watched = useWatch({ control });
  const values = (watched ?? draft.values) as WizardValues;

  const { asyncMap, asyncMapRef, requestCheck } = useWizardAsyncFields(
    useCallback((f: AsyncField, message: string) => setError(f, { type: 'async', message }), [setError]),
    useCallback((f: AsyncField) => clearErrors(f), [clearErrors]),
  );

  const requestRef = useRef(requestCheck);
  requestRef.current = requestCheck;
  const debSub = useDebouncedCallback((v: string) => void requestRef.current('subdomain', v), ASYNC_DEBOUNCE_MS);
  const debMail = useDebouncedCallback((v: string) => void requestRef.current('contactEmail', v), ASYNC_DEBOUNCE_MS);
  const subValue = values.subdomain;
  const mailValue = values.contactEmail;
  useEffect(() => {
    debSub.run(subValue);
  }, [debSub, subValue]);
  useEffect(() => {
    debMail.run(mailValue);
  }, [debMail, mailValue]);

  /* ---------- derived: schema, money, gates ---------- */
  const issues = allIssues(values);
  const blockers = asyncBlockers(asyncMap, values);
  const validity = useMemo(() => {
    /* A field's async verdict belongs to *its own* step's gate: otherwise a taken subdomain
       only bites at the final door and the user can walk away from the field that is wrong. */
    const map: Partial<Record<StepId, boolean>> = {};
    for (const s of STEPS) {
      const stepBad = blockers.some((b) => (s.fields as string[]).includes(b.field));
      map[s.id] = s.fields.length > 0 && stepValid(values, s.fields) && !stepBad;
    }
    map.review = STEPS.slice(0, 3).every((s) => map[s.id] === true) && blockers.length === 0;
    return map;
  }, [blockers, values]);
  const q = quote(values);
  const { step, travel, next, reachable, visited } = useWizardSteps(draft.step, validity);
  const [revealSteps, setRevealSteps] = useState<StepId[]>([]);
  const revealed = revealSteps.includes(step);

  const dirtyFlags = formState.dirtyFields as Partial<Record<keyof WizardValues, boolean>>;
  const dirtyNames = Object.keys(dirtyFlags).filter((k) => dirtyFlags[k as keyof WizardValues] === true) as (keyof WizardValues)[];
  const dirtyCount = dirtyNames.length;

  const chips = useMemo(() => {
    const out: Partial<Record<keyof WizardValues, FieldChips>> = {};
    for (const name of dirtyNames) out[name] = { ...(out[name] ?? {}), dirtyText: '已修改' };
    for (const name of ['subdomain', 'contactEmail'] as AsyncField[]) {
      const st = asyncMap[name];
      if (st.verdict !== 'idle' && st.forValue === String(values[name] ?? '')) {
        out[name] = { ...(out[name] ?? {}), asyncText: VERDICT_LABEL[st.verdict] };
      }
    }
    out.tagline = { ...(out.tagline ?? {}), countText: `${charCount(values.tagline)}/40` };
    return out;
  }, [asyncMap, dirtyNames, values]);

  const errorText = (name: keyof WizardValues): string => {
    const e = formState.errors[name];
    return e === undefined ? '' : String(e.message ?? '');
  };

  /* ---------- actions ---------- */
  const goNext = () => {
    const ok = next();
    if (ok) return;
    setRevealSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
    void trigger(STEP_FIELDS[step]);
    snackbar.push(`「${STEPS.find((s) => s.id === step)?.title ?? step}」还有未通过项`, 'warning');
    const first = STEP_FIELDS[step].find((f) => issues.some((i) => i.path === f));
    if (first !== undefined) {
      const el = document.querySelector<HTMLElement>(`[data-field="${first}"]`);
      el?.focus();
    }
  };

  const onPlan = (id: PlanId) => {
    setValue('plan', id, { shouldDirty: true, shouldValidate: true });
    /* 席位范围随套餐变：不重新钳制的话越界值会一路带到报价单 */
    setValue('seats', clampSeats(id, getValues('seats')), { shouldDirty: true, shouldValidate: true });
  };

  const onSeats = (n: number) => setValue('seats', clampSeats(values.plan, n), { shouldDirty: true, shouldValidate: true });

  const onAddon = (id: AddonId, on: boolean) => {
    const cur = new Set(getValues('addons'));
    if (on) cur.add(id);
    else cur.delete(id);
    setValue('addons', [...cur].sort() as AddonId[], { shouldDirty: true, shouldValidate: true });
  };

  const onBilling = (b: Billing) => setValue('billing', b, { shouldDirty: true, shouldValidate: true });
  const onAccount = (t: WizardValues['accountType']) => setValue('accountType', t, { shouldDirty: true, shouldValidate: true });

  const [submit, setSubmit] = useState<SubmitState>({ phase: 'idle', text: '尚未提交', orderId: null, requests: 0 });
  const lockRef = useRef(false);
  const draftClosed = useRef(false);

  const onValid = async (v: WizardValues): Promise<void> => {
    const blocked = asyncBlockers(asyncMapRef.current, v);
    if (blocked.length > 0) {
      setSubmit({ phase: 'failed', text: `异步校验未通过：${blocked.map((b) => FIELD_LABEL[b.field as keyof typeof FIELD_LABEL]).join('、')}`, orderId: null, requests: submit.requests });
      snackbar.push('异步校验尚未通过，请求未发出', 'error');
      return;
    }
    if (lockRef.current) return;
    lockRef.current = true;
    setSubmit((s) => ({ ...s, phase: 'sending', text: '提交中…', requests: s.requests + 1 }));
    const payload = buildPayload(v);
    const token = submitToken(v);
    /* parallel by contract: audit is advisory and must not add to the critical path */
    const [res, problems] = await Promise.all([wizardApi.submit({ token, payload }), wizardApi.audit(payload)]);
    lockRef.current = false;
    if (res.ok && problems.length === 0) {
      draftClosed.current = true;
      clearDraft();
      setSubmit({ phase: 'done', text: res.duplicate === true ? '重复提交已并入同一订单' : '已受理', orderId: res.orderId ?? '', requests: submit.requests + 1 });
      snackbar.push(`开通申请已受理：${res.orderId ?? ''}`, 'success');
      return;
    }
    setSubmit({ phase: 'failed', text: res.reason === 'subdomain_taken' ? '子域名已被占用（服务端 409）' : `服务端退回：${problems.join('、') || res.reason || '未知'}`, orderId: null, requests: submit.requests + 1 });
    snackbar.push('提交未通过，请检查完整性清单', 'error');
  };

  const onSubmitClick = (): void => {
    void handleSubmit(onValid, () => {
      setRevealSteps((prev) => (prev.includes(step) ? prev : [...prev, step]));
      snackbar.push('表单仍有未通过项', 'error');
    })();
  };

  /* ---------- draft persistence ---------- */
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    /* one accepted submission ends the draft's life: the effect re-runs whenever the value
       snapshot changes, and re-saving there resurrects the draft we just cleared */
    if (!formState.isDirty || submit.phase === 'done') return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (draftClosed.current) return;
      const env = saveDraft(getValues(), step);
      setLastSaved(env.savedAt);
    }, 700);
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
  }, [formState.isDirty, getValues, step, values, submit.phase]);

  useEffect(() => {
    if (!formState.isDirty || submit.phase === 'done') return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [formState.isDirty]);

  const draftText =
    draft.reason === 'restored'
      ? `已恢复上次草稿（${draft.savedAt ?? '未知时间'}${draft.droppedKeys.length > 0 ? `，丢弃 ${draft.droppedKeys.length} 个未知字段` : ''}${draft.defaultedKeys.length > 0 ? `，${draft.defaultedKeys.length} 个字段类型不符已回落` : ''}）`
      : draft.reason === 'version'
        ? '草稿版本与当前表单不一致，已从默认值开始'
        : draft.reason === 'corrupt'
          ? '草稿无法解析，已从默认值开始'
          : '尚无草稿';

  const styleTag = typeof document === 'undefined' ? '' : document.documentElement.getAttribute('data-fd-style') ?? '';

  return (
    <div className="fd-app" data-arm={ARM_NAME} data-style={styleTag}>
      <div className="fd-shell">
        <header className="fd-head">
          <h1 className="fd-brand">
            {BRAND.zh} <span className="fd-brand-latin">{BRAND.latin}</span>
          </h1>
          <p className="fd-head-sub">
            手作订阅开站向导 · {STEPS.length} 步 · {STEP_FIELDS.identity.length + STEP_FIELDS.plan.length + STEP_FIELDS.payment.length} 个校验字段
          </p>
          <div className="fd-head-meta">
            <span data-role="meta-step">
              STEP {STEPS.find((s) => s.id === step)?.no ?? 1}/{STEPS.length}
            </span>
            <span data-role="meta-total">{money(q.display, values.currency)}</span>
            <span data-role="meta-dirty">{dirtyCount} 项已改</span>
            <span data-role="meta-visited">{visited.length} 步已访问</span>
          </div>
        </header>

        <FormProvider {...methods}>
          <StepRail current={step} validity={validity} reachable={reachable} onGo={travel} />

          <main className="fd-main">
            {step === 'identity' ? (
              <section className="fd-panel" aria-label="站点身份" data-role="step-identity">
                <h2 className="fd-panel-title">站点身份</h2>
                <p className="fd-panel-hint">{STEPS[0]?.hint}</p>
                <FieldsGrid names={IDENTITY_STATIC} reveal={revealed} chips={chips} />
                <SuspenseLoader minHeight={176} label="正在读取品类与时区…">
                  <OptionFields names={IDENTITY_OPTIONS} reveal={revealed} chips={chips} />
                </SuspenseLoader>
                <p className="fd-note" data-role="probe-below">
                  以上区域由服务端选项渲染；占位在数据到达前已按 {176}px 预留。
                </p>
                <StepActions onBack={null} onNext={goNext} />
              </section>
            ) : null}

            {step === 'plan' ? (
              <section className="fd-panel" aria-label="方案与容量" data-role="step-plan">
                <h2 className="fd-panel-title">方案与容量</h2>
                <p className="fd-panel-hint">{STEPS[1]?.hint}</p>
                <div className="fd-fields">
                  <span className="fd-field" data-field-id="plan" data-wide="1">
                    <span className="fd-label" data-field-label="plan">
                      订阅套餐<span className="fd-required"> ·必填</span>
                    </span>
                    <PlanCards value={values.plan} seats={values.seats} onSelect={onPlan} />
                    {errorText('plan') === '' ? null : (
                      <span className="fd-chips">
                        <span className="fd-chip" data-kind="error" data-error-for="plan">
                          {errorText('plan')}
                        </span>
                      </span>
                    )}
                  </span>
                  <SeatsField
                    plan={values.plan}
                    value={values.seats}
                    onCommit={onSeats}
                    dirtyText={chips.seats?.dirtyText ?? ''}
                    errorText={revealed || chips.seats !== undefined ? errorText('seats') : ''}
                  />
                  <span className="fd-field" data-field-id="addons" data-wide="1">
                    <span className="fd-label" data-field-label="addons">
                      增值模块
                    </span>
                    <AddonField
                      value={values.addons}
                      plan={values.plan}
                      seats={values.seats}
                      onToggle={onAddon}
                      dirtyText={chips.addons?.dirtyText ?? ''}
                      errorText={errorText('addons')}
                    />
                  </span>
                  <span className="fd-field" data-field-id="billing" data-wide="1">
                    <span className="fd-label" data-field-label="billing">
                      结算周期<span className="fd-required"> ·必填</span>
                    </span>
                    <BillingCards value={values.billing} savingText={`年付一次结清，省 ${money(annualSaving(values), values.currency)}`} onCommit={onBilling} />
                  </span>
                  <FieldsGrid names={['currency']} reveal={revealed} chips={chips} />
                </div>
                <StepActions onBack={() => travel('identity')} onNext={goNext} />
              </section>
            ) : null}

            {step === 'payment' ? (
              <section className="fd-panel" aria-label="收款与合规" data-role="step-payment">
                <h2 className="fd-panel-title">收款与合规</h2>
                <p className="fd-panel-hint">{STEPS[2]?.hint}</p>
                <div className="fd-fields">
                  <span className="fd-field" data-field-id="accountType" data-wide="1">
                    <span className="fd-label" data-field-label="accountType">
                      收款主体<span className="fd-required"> ·必填</span>
                    </span>
                    <AccountCards value={values.accountType} onCommit={onAccount} />
                    {dirtyFlags.accountType === true ? (
                      <span className="fd-chips">
                        <span className="fd-chip" data-kind="dirty" data-dirty-for="accountType">
                          已修改
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <FieldsGrid
                    names={values.accountType === 'personal' ? PAYMENT_PERSONAL : PAYMENT_ENTERPRISE}
                    reveal={revealed}
                    chips={chips}
                  />
                  <FieldsGrid names={PAYMENT_ALWAYS} reveal={revealed} chips={chips} />
                  <SuspenseLoader minHeight={56} label="正在读取发票选项…">
                    <OptionFields names={PAYMENT_INVOICE.slice(0, 1)} reveal={revealed} chips={chips} />
                  </SuspenseLoader>
                  <FieldsGrid names={values.invoiceType === 'none' ? [] : PAYMENT_INVOICE.slice(1)} reveal={revealed} chips={chips} />
                  <FieldsGrid names={PAYMENT_AGREE} reveal={revealed} chips={chips} />
                </div>
                <StepActions onBack={() => travel('plan')} onNext={goNext} />
              </section>
            ) : null}

            {step === 'review' ? (
              <SuspenseLoader minHeight={420} label="正在准备预览页…">
                <ReviewStep
                  values={values}
                  issues={issues}
                  blockers={blockers}
                  onGo={travel}
                  submitting={submit.phase === 'sending'}
                  submitText={submit.text}
                  onSubmit={onSubmitClick}
                  orderId={submit.orderId}
                />
              </SuspenseLoader>
            ) : null}

            {step !== 'review' ? (
              <section className="fd-panel" aria-label="异步校验状态" data-role="async-state">
                <h2 className="fd-panel-title">异步校验</h2>
                <p className="fd-note" data-role="async-subdomain">
                  子域名：{asyncMap.subdomain.verdict}（{asyncMap.subdomain.forValue || '空'}）
                </p>
                <p className="fd-note" data-role="async-email">
                  邮箱：{asyncMap.contactEmail.verdict}（{asyncMap.contactEmail.forValue || '空'}）
                </p>
                <p className="fd-note" data-role="renders-total">
                  当前臂 {ARM_NAME} · 字段渲染计数见 window.__fdBridge.renders
                </p>
              </section>
            ) : null}
          </main>

          <aside className="fd-side">
            <SummaryPanel values={values} q={q} />
            <CompletenessPanel issues={issues} blockers={blockers} values={values} onGo={travel} />
            <DraftBar
              draftText={draftText}
              isDirty={formState.isDirty}
              dirtyCount={dirtyCount}
              onSave={() => {
                const env = saveDraft(getValues(), step);
                setLastSaved(env.savedAt);
                snackbar.push('草稿已保存', 'success');
              }}
              onSample={() => {
                for (const key of Object.keys(SAMPLE_VALUES) as (keyof WizardValues)[]) {
                  setValue(key, SAMPLE_VALUES[key] as never, { shouldDirty: true, shouldValidate: true });
                }
                snackbar.push('已载入示例数据', 'info');
              }}
              onClear={() => {
                clearDraft();
                snackbar.push(`草稿已清空（当前 ${draftRaw() === null ? '无草稿' : '仍有草稿'}）`, 'info');
              }}
            />
            <p className="fd-note" data-role="last-saved">
              {lastSaved === null ? '本次会话尚未保存' : `最近保存 ${lastSaved}`}
            </p>
            <AddonLegend values={values} />
            <section className="fd-panel" aria-label="自检" data-role="self-check">
              <h2 className="fd-panel-title">渲染自检</h2>
              <p className="fd-mono" data-role="render-keys">
                {Object.keys(renderCounts()).length}
              </p>
            </section>
          </aside>

          <footer className="fd-foot">
            {BRAND.zh} {BRAND.year} · 本页面为技能验证产物，示例邮箱 {BRAND.supportMail} 不可送达 · 客服电话 {BRAND.helpLine}
          </footer>
        </FormProvider>
      </div>
    </div>
  );
};

const StepActions: React.FC<{ onBack: (() => void) | null; onNext: () => void }> = ({ onBack, onNext }) => (
  <div className="fd-actions">
    {onBack === null ? null : (
      <Button variant="text" onClick={onBack} data-action="back">
        上一步
      </Button>
    )}
    <Button variant="contained" onClick={onNext} data-action="next">
      下一步
    </Button>
    <span className="fd-note">未通过的项会在对应字段下方就地说明，不会跳页</span>
  </div>
);

export default WizardPage;
