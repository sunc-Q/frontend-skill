import React, { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Box, Button, Paper, Switch, TextField, Typography } from '@mui/material';
import { DEFAULT_SETTINGS, settingsApi } from '../api/settingsApi';
import { settingsSchema } from '../helpers/settingsValidation';
import { useMuiSnackbar } from '@/hooks/useMuiSnackbar';
import type { Settings } from '~types/index';

/** Skill clause: "React Hook Form with Zod validation" (resources/common-patterns.md is not shipped). */
export const SettingsSection: React.FC = () => {
  const snackbar = useMuiSnackbar();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<Settings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsApi.load(),
    mode: 'onSubmit',
  });

  const onSubmit = useCallback(
    (values: Settings) => {
      const ok = settingsApi.save(values);
      reset(values);
      snackbar.enqueue(ok ? '设置已保存' : '设置仅在本次会话生效（本地存储不可用）', ok ? 'success' : 'error');
    },
    [reset, snackbar],
  );

  // reset(DEFAULT_SETTINGS) would clear isDirty (RHF treats reset values as the new baseline),
  // which would make the "有未保存修改" indicator lie — so the defaults are written field by field.
  const onReset = useCallback(() => {
    setValue('serviceName', DEFAULT_SETTINGS.serviceName, { shouldDirty: true });
    setValue('defaultDomain', DEFAULT_SETTINGS.defaultDomain, { shouldDirty: true });
    setValue('pageSize', DEFAULT_SETTINGS.pageSize, { shouldDirty: true });
    setValue('weeklyDigest', DEFAULT_SETTINGS.weeklyDigest, { shouldDirty: true });
    setValue('slowLinkAlert', DEFAULT_SETTINGS.slowLinkAlert, { shouldDirty: true });
    snackbar.enqueue('已恢复默认值，未保存', 'info');
  }, [setValue, snackbar]);

  return (
    <Paper className="fd-relief" sx={{ p: 2, display: 'grid', gap: 1.5 }} data-section="settings">
      <div className="fd-panel-head">
        <Typography variant="subtitle2" component="h2">服务设置</Typography>
        <Typography variant="caption" component="span" data-fd="dirty-flag" data-dirty={isDirty ? '1' : '0'}>
          {isDirty ? '有未保存修改' : '已与服务配置同步'}
        </Typography>
      </div>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'grid', gap: 1.5 }}>
        <TextField
          label="服务名称"
          size="small"
          helperText={errors.serviceName?.message ?? '显示在侧栏与邮件抬头'}
          error={errors.serviceName !== undefined}
          inputProps={{ 'data-field': 'serviceName' }}
          {...register('serviceName')}
        />
        <TextField
          label="默认短链域名"
          size="small"
          helperText={errors.defaultDomain?.message ?? '新短链将使用该域名前缀'}
          error={errors.defaultDomain !== undefined}
          inputProps={{ 'data-field': 'defaultDomain' }}
          {...register('defaultDomain')}
        />
        <TextField
          label="列表每页条数"
          size="small"
          type="number"
          helperText={errors.pageSize?.message ?? '5–50 之间的整数'}
          error={errors.pageSize !== undefined}
          inputProps={{ min: 5, max: 50, 'data-field': 'pageSize' }}
          {...register('pageSize', { valueAsNumber: true })}
        />

        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <label className="fd-switch">
            <Switch size="small" {...register('weeklyDigest')} />
            <span>每周一发送数据周报邮件</span>
          </label>
          <label className="fd-switch">
            <Switch size="small" {...register('slowLinkAlert')} />
            <span>慢链路（&gt;800ms）触发告警</span>
          </label>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button type="submit" variant="contained" data-fd="save">保存设置</Button>
          <Button variant="outlined" data-fd="reset" onClick={onReset}>恢复默认</Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default SettingsSection;
