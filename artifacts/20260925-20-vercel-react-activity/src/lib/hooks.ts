import { useSyncExternalStore } from 'react';
import type { Resource } from './api';

/**
 * useResource：数据未就绪时在组件里 throw promise 交给 Suspense 边界（async-suspense-boundaries）；
 * 就绪后走 useSyncExternalStore，使乐观补丁/服务端覆盖都能驱动重渲染。
 */
export function useResource<T>(res: Resource<T>): T {
  const data = useSyncExternalStore(
    (cb) => res.subscribe(cb),
    () => res.data,
    () => res.data,
  );
  if (res.error !== null) throw res.error;
  if (data !== null) return data;
  throw res.promise;
}

/** 已经 bootstrap 过的资源：await 其 promise（promise 早已在发起，属于 start-early / await-late） */
export function awaitResource<T>(res: Resource<T>): Promise<T> {
  return res.promise;
}
