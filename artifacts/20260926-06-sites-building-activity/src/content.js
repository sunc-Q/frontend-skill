/* 事实源：与 2026-09-25 20:00 轮（vercel-react-best-practices × 活动报名页）逐字段相同，
   复制自 artifacts/20260925-20-vercel-react-activity/src/lib/content.ts。
   目的是让「同一张活动页、两种 skill 实现」的字节数/LOC/能力差成为受控对照。 */
const EVENT = {
  name: '星屿·声浪岛音乐节',
  enName: 'Sound Isle Festival',
  city: '长沙 · 湘江中央星屿',
  startsAt: new Date('2026-10-16T18:00:00+08:00').getTime(),
  days: [
    { key: 'fri', label: '10.16 周五', stage: '开幕夜' },
    { key: 'sat', label: '10.17 周六', stage: '全日' },
    { key: 'sun', label: '10.18 周日', stage: '收官日' },
  ],
  tiers: [
    { id: 'day', name: '单日通票', price: 380, note: '任选一日入场' },
    { id: 'full', name: '三日全通', price: 980, note: '含露营位预订资格' },
    { id: 'vip', name: '内场 VIP', price: 1580, note: '前区平台 + 专属通道' },
  ],
};

const FIXTURE_SUMMARY = {
  signedCount: 12483,
  ticketsLeft: 642,
  capacity: 18000,
  brandPartners: 23,
  serverNow: 1760000000000,
};

const FIXTURE_ARTISTS = [
  { id: 'a01', name: '潮汐地图', enName: 'Tidemap', genre: '数学摇滚', city: '长沙', votes: 3121, headliner: true },
  { id: 'a02', name: '岛屿信号', enName: 'Isle Signal', genre: '合成器流行', city: '上海', votes: 2980, headliner: true },
  { id: 'a03', name: '南墙乐队', enName: 'Southwall', genre: '民谣摇滚', city: '广州', votes: 2218, headliner: false },
  { id: 'a04', name: '电子羊', enName: 'Electronic Sheep', genre: 'Techno', city: '柏林', votes: 2530, headliner: true },
  { id: 'a05', name: '芥末汽水', enName: 'Mustard Soda', genre: '盯鞋', city: '成都', votes: 2714, headliner: false },
  { id: 'a06', name: '夜航班机', enName: 'Nightflight', genre: 'City Pop', city: '东京', votes: 2044, headliner: false },
  { id: 'a07', name: '白噪音研究所', enName: 'White Lab', genre: '氛围电子', city: '杭州', votes: 1876, headliner: false },
  { id: 'a08', name: '铜锣湾少年', enName: 'Causeway Boys', genre: '冲浪摇滚', city: '厦门', votes: 1690, headliner: false },
  { id: 'a09', name: '低多边形', enName: 'Low Poly', genre: '独立电子', city: '武汉', votes: 1455, headliner: false },
  { id: 'a10', name: '橘子罐头', enName: 'Tangerine Tin', genre: '车库摇滚', city: '西安', votes: 1320, headliner: false },
  { id: 'a11', name: '雾中列车', enName: 'Fog Train', genre: '后摇', city: '重庆', votes: 1176, headliner: false },
  { id: 'a12', name: '银河录像厅', enName: 'Galaxy Video', genre: 'Disco', city: '北京', votes: 998, headliner: false },
];

const FIXTURE_SESSIONS = [
  ['m01', 'fri', 'main', '18:30', '19:20', '开幕：鼓圈巡游', '星屿鼓班', '开幕'],
  ['m02', 'fri', 'main', '19:40', '20:40', '潮汐地图 全专首演', '潮汐地图', '头牌'],
  ['m03', 'fri', 'isle', '20:00', '20:50', '不插电黄昏场', '南墙乐队', '不插电'],
  ['m04', 'fri', 'lounge', '21:00', '23:00', '黑胶静默迪斯科', 'DJ 白噪音', '静音'],
  ['m05', 'fri', 'main', '21:10', '22:10', '岛屿信号 宇宙电波', '岛屿信号', '头牌'],
  ['m06', 'fri', 'isle', '21:30', '22:30', 'City Pop 霓虹夜', '夜航班机', '复古'],
  ['m07', 'fri', 'lounge', '23:00', '01:00', '日场收声派对', '电子羊', '派对'],
  ['m08', 'sat', 'main', '13:00', '13:50', '开场：声音装置导览', '白噪音研究所', '装置'],
  ['m09', 'sat', 'main', '14:20', '15:10', '芥末汽水 盯鞋风暴', '芥末汽水', '盯鞋'],
  ['m10', 'sat', 'isle', '13:30', '14:20', '少年冲浪声', '铜锣湾少年', '冲浪'],
  ['m11', 'sat', 'isle', '15:00', '15:50', '低多边形 现场编程', '低多边形', '生成'],
  ['m12', 'sat', 'lounge', '14:00', '17:00', '唱片市集：厂牌擂台', '六厂牌', '市集'],
  ['m13', 'sat', 'main', '16:00', '17:00', '橘子罐头 车库狂想', '橘子罐头', '车库'],
  ['m14', 'sat', 'main', '18:00', '19:00', '雾中列车 慢速轰鸣', '雾中列车', '后摇'],
  ['m15', 'sat', 'isle', '17:30', '18:30', '落日对唱会', '南墙 × 芥末', '联名'],
  ['m16', 'sat', 'main', '20:00', '21:10', '银河录像厅 舞池重启', '银河录像厅', 'Disco'],
  ['m17', 'sat', 'lounge', '21:30', '23:30', '氛围场：江面回声', '白噪音研究所', '氛围'],
  ['m18', 'sat', 'main', '21:40', '22:50', '电子羊 三小时装置 Techno', '电子羊', '头牌'],
  ['m19', 'sun', 'main', '13:30', '14:20', '亲子声浪工坊', '星屿剧团', '亲子'],
  ['m20', 'sun', 'isle', '14:00', '15:00', '新声竞演：八支Demo', '八支新声', '竞演'],
  ['m21', 'sun', 'main', '15:30', '16:30', '城市之声圆桌演出', '长沙音乐人联盟', '在地'],
  ['m22', 'sun', 'lounge', '15:00', '18:00', '交换唱片下午茶', '乐迷会', '市集'],
  ['m23', 'sun', 'main', '17:30', '18:40', '潮汐地图 × 交响组曲', '潮汐地图', '联名'],
  ['m24', 'sun', 'isle', '19:00', '20:00', '告别的轮盘：观众点歌', '夜航班机', '互动'],
  ['m25', 'sun', 'main', '20:30', '22:00', '闭幕大合奏 + 江面烟花', '全体阵容', '闭幕'],
].map(function (r) {
  return { id: r[0], day: r[1], stage: r[2], start: r[3], end: r[4], title: r[5], artist: r[6], tag: r[7] };
});

const FIXTURE_NOTICES = [
  { id: 'n1', kind: 'shuttle', title: '免费接驳轮渡', body: '湘江三号码头 ↔ 星屿东埠，12:00-23:30 每 20 分钟一班；凭票根登船。散场后加开 22:30 / 23:00 / 23:30 三班大船。' },
  { id: 'n2', kind: 'entry', title: '入场与安检', body: '每日 12:00 开闸。禁止携带玻璃容器、冷焰火、长度超过 50cm 的应援物。现场设寄存处（¥10/件，支持扫码）。' },
  { id: 'n3', kind: 'weather', title: '天气预案', body: '据 10 日预报，三日晴间多云、江边夜间约 16℃。中雨以上演出照常（主舞台顶棚覆盖 70%）；暴雨红色预警时启动闭幕日顺延预案，票务自动保留。' },
  { id: 'n4', kind: 'camp', title: '露营区守则', body: '三日全通票可预订湖东营地（200 顶限额）。15:00 后禁止生明火；营地 24h 有值守与热水站，撤营请带走垃圾可换纪念徽章。' },
];

const STAGES = [
  { id: 'main', name: '主舞台 · 潮声' },
  { id: 'isle', name: '屿林舞台' },
  { id: 'lounge', name: '江畔静舞台' },
];
