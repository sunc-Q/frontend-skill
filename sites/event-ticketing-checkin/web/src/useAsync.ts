import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './types';

export interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  fields: Record<string, string>;
  reload: () => void;
}

/** 所有读接口共用的取数状态机：失败只暴露可控文案，不吞掉错误码。 */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setErrorCode(null);
    load(controller.signal)
      .then((value) => {
        if (mounted.current && !controller.signal.aborted) setData(value);
      })
      .catch((err: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (err instanceof ApiError) {
          setError(err.message);
          setErrorCode(err.code);
        } else {
          setError('无法连接后端服务，请先启动 cmd/api');
          setErrorCode('network');
        }
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, errorCode, fields, reload };
}

export interface Action {
  run: (fn: () => Promise<void>) => void;
  busy: boolean;
  message: string | null;
  kind: 'ok' | 'err' | null;
  lastError: ApiError | null;
  clear: () => void;
}

/** 写操作（建场次 / 出票 / 核销 / 退票）共用的提交状态。 */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<'ok' | 'err' | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);

  const run = useCallback((fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    setKind(null);
    setLastError(null);
    fn()
      .then(() => {
        setKind('ok');
        setMessage('操作已完成');
      })
      .catch((err: unknown) => {
        setKind('err');
        if (err instanceof ApiError) {
          setLastError(err);
          setMessage(`${err.message}（${err.code}）`);
        } else {
          setMessage('操作失败，请稍后重试');
        }
      })
      .finally(() => setBusy(false));
  }, []);

  return {
    run,
    busy,
    message,
    kind,
    lastError,
    clear: () => {
      setMessage(null);
      setKind(null);
      setLastError(null);
    },
  };
}
