export const VOICE_TAGS = ['家庭', '职业', '公益'] as const;
export type VoiceTag = (typeof VOICE_TAGS)[number];

export interface Faq {
  id: string;
  q: string;
  a: string;
}
export interface Feature {
  id: 'private' | 'fast' | 'smart';
  title: string;
  body: string;
}
export interface Step {
  n: string;
  title: string;
  body: string;
}
export interface Voice {
  id: string;
  name: string;
  role: string;
  quote: string;
  photos: string;
  tag: VoiceTag;
}
export const FEATURES: Feature[] = [
  {
    id: 'private',
    title: '照片不出本机',
    body: '人脸识别、场景分类、重复检测全部在端侧模型里跑完。没有上传队列，没有云端训练，断网也能整理十万张。',
  },
  {
    id: 'fast',
    title: '一晚整理完一整个童年',
    body: '增量索引 + 并行分块，M 系列芯片实测 6 万张 42 分钟；过程中可以先看已完成的相册，不必等全部跑完。',
  },
  {
    id: 'smart',
    title: '它记得你在意什么',
    body: '按人物、地点、事件与「你反复放大看过」的行为聚类，把每年真正值得留的 200 张挑出来，其余归档不删除。',
  },
];
export const STEPS: Step[] = [
  { n: '01', title: '指向一个文件夹', body: '选本地相册或外接硬盘，拾光只读不写，原图永远保持原样。' },
  { n: '02', title: '端侧跑一遍模型', body: '人脸、场景、模糊、截图、连拍在本地打分，进度可中断可续跑。' },
  { n: '03', title: '审阅再落盘', body: '所有整理结果先进待确认清单，你逐条通过或退回，才写入相册结构。' },
];
export const VOICES: Voice[] = [
  {
    id: 'a',
    name: '林墨',
    role: '两个孩子的妈妈 / 摄影爱好者',
    quote: '以前每年三月都在硬盘里翻照片。现在拾光把 2019 到 2025 拆成了 41 个事件相册，重复和糊掉的自己进回收站，我只做确认。',
    photos: '11.2 万张',
    tag: '家庭',
  },
  {
    id: 'b',
    name: '阿肯',
    role: '独立摄影师',
    quote: '客户素材不能上云，这条就把市面上大部分工具淘汰了。拾光是唯一一个我敢在样片机上装的。',
    photos: '3.8 万张 RAW',
    tag: '职业',
  },
  {
    id: 'c',
    name: '周予',
    role: '档案馆数字化志愿者',
    quote: '扫描的老照片命名混乱，靠人脸聚类把同一位老人的照片聚到了一起，志愿者省掉了大半个月的手工分拣。',
    photos: '7.4 万张扫描件',
    tag: '公益',
  },
];
export const FAQS: Faq[] = [
  {
    id: 'f1',
    q: '整理会不会动我的原始文件？',
    a: '不会。拾光默认只读，所有分类结果写在应用自己的数据库里；只有你显式点「应用整理结构」，才会在目标文件夹生成相册子目录，且原始文件的修改时间与内容都不改变。',
  },
  {
    id: 'f2',
    q: '支持哪些格式？',
    a: '常见 JPEG / PNG / HEIC / WebP / GIF，以及主流相机的 RAW（CR2、CR3、NEF、ARW、DNG）。视频支持 MP4 与 MOV 的关键帧分类。',
  },
  {
    id: 'f3',
    q: '端侧模型有多大，会不会拖慢电脑？',
    a: '全套模型 260MB，运行时按分块加载，峰值内存约 1.4GB。可以在设置里限制占用核心数，跑后台整理时仍可正常使用其他应用。',
  },
  {
    id: 'f4',
    q: '换电脑怎么办？',
    a: '索引数据库可导出为单个文件，随相册一起拷贝；在新机器上导入后不需要重新跑模型，只有新增照片走增量分析。',
  },
  {
    id: 'f5',
    q: '收费方式是什么？',
    a: '买断制，一次付费永久使用并包含后续模型更新；提供 14 天全功能试用，试用期结束前整理结果不会丢失。',
  },
];
export const STATS = [
  { k: '上传到云端的照片', v: '0', unit: '张' },
  { k: '实测整理 6 万张耗时', v: '42', unit: '分钟' },
  { k: '离线可用的核心功能', v: '100', unit: '%' },
  { k: '模型与索引体积', v: '260', unit: 'MB' },
];
export interface Plan {
  id: string;
  name: string;
  price: string;
  unit: string;
  limit: string;
  lines: string[];
  badge?: string;
}
export const PLANS: Plan[] = [
  {
    id: 'solo',
    name: '个人版',
    price: '¥198',
    unit: '一次买断',
    limit: '1 台设备',
    lines: ['端侧全模型', '无限照片数量', '索引库导出迁移', '含后续模型更新'],
  },
  {
    id: 'pro',
    name: '摄影师版',
    price: '¥458',
    unit: '一次买断',
    limit: '2 台设备',
    lines: ['个人版全部内容', 'RAW 全格式与色彩配置档', '客户素材隔离（按项目建库）', '优先级人工支持'],
    badge: '多数人选择',
  },
  {
    id: 'team',
    name: '机构版',
    price: '按需',
    unit: '年度授权',
    limit: '5 台起',
    lines: ['摄影师版全部内容', '离线内网部署包', '批量扫描件人脸归档', '发票与采购流程对接'],
  },
];
export const PLATFORMS = [
  { id: 'mac', name: 'macOS 14+（Apple Silicon / Intel）' },
  { id: 'win', name: 'Windows 11（x64）' },
];