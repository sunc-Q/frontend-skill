import json, datetime
LAB = __import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', '..'))
st = json.load(open(LAB + '/state/state.json'))
runs = [r for r in st['runs'] if r.get('time')]
runs.sort(key=lambda r: r['time'])

def hhmm(t):  # "2026-09-25T17:23+08:00" -> minutes since first
    return datetime.datetime.fromisoformat(t)

f0 = hhmm(runs[0]['time'])
def m(t): return int((hhmm(t) - f0).total_seconds() // 60)

# 1) flowchart: the 10-step pipeline itself
flow = """flowchart TD
    A([cron 每30分钟]) --> B[读 work-log + state.json]
    B --> C{有未试 skill?}
    C -- 否 --> X[记录卡点并收尾]
    C -- 是 --> D[按来源顺序发现: 市场→SSH clone→本机]
    D --> E{安全闸门<br/>读全文 SKILL.md}
    E -- 拒绝 --> F[记 skills_seen blocked] --> B
    E -- 通过 --> G[15分钟跑 1 skill × 1 小任务]
    G --> H[验证: 断言 + 双变异负对照]
    H --> I[清理: 删依赖/杀进程/限 LAB 内]
    I --> J[写 reports + state + work-log]
    J --> K[git push 仅 skill-showcase 分支]
    K --> L([收尾核查: status/du/df/lsof])
"""
open(LAB + '/demos/20260926-1416-mermaid-cli/pipeline-flow.mmd','w').write(flow)

# 2) timeline: every run, skill + artifact kind
tl = ['timeline']
tl.append('    title skill-showcase 演示场 17 轮时间线 (2026-09-25 17:23 → 2026-09-26 13:48)')
for r in runs:
    t = r['time'][5:10].replace('-','/') + ' ' + r['time'][11:16].replace(':',chr(0xB7))
    tl.append(f"    {t} : {r['skill']}")
open(LAB + '/demos/20260926-1416-mermaid-cli/rounds-timeline.mmd','w').write('\n'.join(tl)+'\n')

# 3) stateDiagram: dedup contract
names = [r['skill'] for r in runs]
state = """stateDiagram-v2
    [*] --> 发现候选
    发现候选 --> 已记账跳过 : 名字在 tried 里
    发现候选 --> 来源不可用 : skills_seen 标记 blocked/unreachable
    来源不可用 --> 发现候选 : 换来源
    发现候选 --> 安全闸门
    安全闸门 --> 放弃并记录 : 触闸门(凭据/外发/sudo)
    安全闸门 --> 跑小任务 : 通过
    跑小任务 --> 无产物收尾 : 超15分钟或真实报错
    跑小任务 --> 验证
    验证 --> 清理写回
    清理写回 --> 推送skill-showcase
    推送skill-showcase --> [*] : 本地commit保留失败原因
    note right of 已记账跳过 : tried 已累积 %d 个 skill 名<br/>最早: %s | 最新: %s
""" % (len(names), names[0], names[-1])
open(LAB + '/demos/20260926-1416-mermaid-cli/dedup-contract.mmd','w').write(state)

# 4) pie: seconds spent per round (only timed runs)
timed = [(r['skill'], r['seconds']) for r in runs if isinstance(r.get('seconds'), (int,float)) and r['seconds']>0]
total = sum(s for _,s in timed)
pie = ['pie showData', '    title 各轮耗时占比（秒，共 %d 轮计时 / %.1f 分钟）' % (len(timed), total/60)]
for n,s in timed:
    pie.append('    "%s" : %d' % (n, s))
open(LAB + '/demos/20260926-1416-mermaid-cli/time-pie.mmd','w').write('\n'.join(pie)+'\n')

print('generated 4 .mmd; timed runs=%d total=%ds; runs=%d' % (len(timed), total, len(runs)))
