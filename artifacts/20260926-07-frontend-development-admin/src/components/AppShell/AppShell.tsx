import React, { type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { AppBar, Chip, Toolbar, Typography } from '@mui/material';
import { STYLES, readStyleId } from '@/lib/style/registry';
import { settingsApi } from '~features/settings/api/settingsApi';

const NAV = [
  { to: '/', label: '总览', icon: 'M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 9h8V3h-8v6Z' },
  { to: '/links', label: '短链管理', icon: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM9 13h6v-2H9v2Z' },
  { to: '/keys', label: 'API 密钥', icon: 'M12.5 6.5a4 4 0 1 0-3.4 6.3L7 15H5v2H3v2h4l6.2-6.2a4 4 0 0 0-.7-6.3Z' },
  { to: '/settings', label: '服务设置', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9.4 4a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2l-.4-2.5H10.4l-.4 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h4.4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z' },
] as const;

export interface AppShellProps {
  children: ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const style = STYLES[readStyleId()];
  const settings = settingsApi.load();
  return (
    <>
      <AppBar position="static" data-fd="appbar" className="fd-scanline">
        <Toolbar>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginRight: 10 }}>
            <circle cx="12" cy="12" r="3" fill="currentColor" />
            <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <Typography variant="subtitle2" component="h1" sx={{ flexGrow: 1, fontSize: '1.05rem' }}>
            {settings.serviceName}
          </Typography>
          <Chip size="small" data-fd="style-tag" label={`${style.name} · ${style.id}`} variant="outlined" />
        </Toolbar>
      </AppBar>
      <div className="fd-shell">
        <nav className="fd-relief" aria-label="主导航" data-fd="nav" style={{ alignSelf: 'start', padding: 12, display: 'grid', gap: 6 }}>
          {NAV.map((item) => (
            <Link key={item.to} to={item.to}>
              {({ isActive }) => (
                <span className="fd-navlink" data-active={isActive ? '1' : '0'} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                  {item.label}
                </span>
              )}
            </Link>
          ))}
          <p className="fd-foot">默认域名 {settings.defaultDomain} · 每页 {settings.pageSize} 条</p>
        </nav>
        <main className="fd-main" data-fd="main">{children}</main>
      </div>
    </>
  );
};

export default AppShell;
