/* 占位分析模块：真实项目里这里是第三方统计 SDK。
   它只通过动态 import 在首次交互后被拉起（bundle-defer-third-party），
   初始包里不应包含它的任何字符串——split 构建的断言会核对这一点。 */
const queue: string[] = [];

/* 只在动态模块内部出现的标记串：入口 chunk 里搜不到它，才能证明这块代码没被并进首包。 */
const FLUSH_TARGET = 'songta-analytics://queue-v1';

export function track(event: string, props?: Readonly<Record<string, string | number>>): void {
  queue.push(event + (props === undefined ? '' : ' ' + JSON.stringify(props)));
}

export function pending(): number {
  return queue.length + FLUSH_TARGET.length;
}
