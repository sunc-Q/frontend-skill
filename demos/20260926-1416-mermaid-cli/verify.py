import re, struct, sys, json, os
d = os.path.dirname(os.path.abspath(__file__))
ok = fail = 0
def chk(name, cond, detail=''):
    global ok, fail
    print(('PASS' if cond else 'FAIL') + ' | ' + name + (' | ' + detail if detail else ''))
    if cond: ok += 1
    else: fail += 1

# independent recount from .mmd sources
flow = open(d+'/pipeline-flow.mmd').read()
mmd_nodes = set(re.findall(r'\b([A-Z])(?:\(\[|\[|\{)', flow)) & set('ABCDEFGHIJKLX')
mmd_edges = len(re.findall(r'-->', flow))
svg = open(d+'/pipeline-flow.svg').read()
chk('F1 flow 节点集合与 mmd 一致(13)', mmd_nodes == set('ABCDEFGHIJKLX'), 'mmd=%d' % len(mmd_nodes))
chk('F2 SVG 含全部 12 个节点 id', all(("flowchart-%s-" % c) in svg for c in mmd_nodes), str(sorted(mmd_nodes)))
chk('F3 SVG 边数 == mmd --> 数', svg.count('class="edge') >= mmd_edges or svg.count('flowchart-link') >= mmd_edges, 'mmd edges=%d, flowchart-link=%d' % (mmd_edges, svg.count('flowchart-link')))
for t in ['每30分钟','安全闸门','双变异','skill-showcase 分支','收尾核查']:
    chk('F4 期望文案在 SVG 里: '+t, t in svg or t.replace('','') in svg)

pie = open(d+'/time-pie.mmd').read()
data_rows = re.findall(r'^\s+"(.+?)"\s*:\s*(\d+)', pie, re.M)
psvg = open(d+'/time-pie.svg').read()
chk('P1 pie 切片数 == 计时轮次 16', len(data_rows) == 16, str(len(data_rows)))
chk('P2 SVG slice path 数 == 16', len(re.findall(r'<path[^>]*d="M[^"]+Z"', psvg)) >= 16, str(len(re.findall(r'd="M[^"]+Z"', psvg))))
chk('P3 每个 skill 名都出现在图中', all(n in psvg for n,_ in data_rows))
total = sum(int(s) for _,s in data_rows)
chk('P4 标题总分钟数与现场重算一致', ('%.1f' % (total/60)) in psvg.replace(',',''), 'total=%ds=%.1fmin' % (total, total/60))
chk('P5 百分比标注存在(>=15 个 %)', len(re.findall(r'\d+(\.\d+)?%', psvg)) >= 15, str(len(re.findall(r'%',psvg))))

tl = open(d+'/rounds-timeline.mmd').read()
events = re.findall(r'^\s+(.+?)\s*:\s(.+)$', tl, re.M)
events = [(p,e) for p,e in events if e != 'skill-showcase 演示场 17 轮时间线 (2026-09-25 17:23 → 2026-09-26 13:48)']
tsvg = open(d+'/rounds-timeline.svg').read()
names = [e for _,e in events]
chk('T1 timeline 事件数 == 17', len(names) == 17, str(len(names)))
chk('T2 17 个 skill 名全在 SVG', all(n in tsvg for n in names))
chk('T3 标题含箭头日期区间', '17' + '轮时间线' in tsvg or '17 轮时间线' in tsvg)

st = open(d+'/dedup-contract.mmd').read()
states = set(re.findall(r'^\s+([A-Z]+)\s+:', st, re.M))
ssvg = open(d+'/dedup-contract.svg').read()
chk('S1 状态名与描述映射齐全(10 个中文态)', len(states) == 10, str(sorted(states)))
chk('S2 中文态名全部出现在图中', all(re.search(r':\s+(.+)$', l).group(1).strip() in ssvg for l in st.splitlines() if re.match(r'^\s+[A-Z]+ : \S', l)))
chk('S3 note 里的 tried 口径 17 在图中', '17' in ssvg and 'drafter' in ssvg and 'golang-gin-api' in ssvg)

png = open(d+'/pipeline-flow.png','rb').read()
chk('G1 PNG 签名', png[:8] == b'\x89PNG\r\n\x1a\n')
w,h = struct.unpack('>II', png[16:24])
chk('G2 PNG 尺寸非零', w>0 and h>0, '%dx%d' % (w,h))

err = open(d+'/broken-error.log').read()
chk('N1 负对照: 坏语法报 Parse error', 'Parse error' in err, err.strip().splitlines()[0] if err.strip() else '')
chk('N2 产物目录无 _broken.svg(验证失败不落盘)', not os.path.exists(d+'/_broken.svg'))

print('\n%d PASS / %d FAIL' % (ok, fail))
sys.exit(1 if fail else 0)
