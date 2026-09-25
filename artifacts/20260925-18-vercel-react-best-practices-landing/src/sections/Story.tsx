import { FEATURES, STEPS, STATS } from '../lib/content';
import { Icon, scrollToId, usePointerVars } from '../components/ui';

export function Hero() {
  const onMove = usePointerVars();
  return (
    <section id="hero" className="hero">
      <div className="hero-copy">
        <p className="eyebrow" data-reveal>
          端侧 AI 相册整理 · 买断制
        </p>
        <h1 className="hero-title">
          十万张照片<span className="hero-break" />
          <em>留在你自己的硬盘里</em>
        </h1>
        <p className="hero-lead">
          拾光在本地跑完人脸识别、场景分类与重复检测，把散乱的年份堆整理成可以翻给家人看的事件相册。
          不上传、不订阅、不联网也能用。
        </p>
        <div className="hero-actions">
          <a
            className="btn btn--primary"
            href="#cta"
            data-cta="hero-primary"
            onClick={(e) => {
              e.preventDefault();
              scrollToId('cta');
            }}
          >
            下载 14 天全功能试用
          </a>
          <a
            className="btn btn--ghost"
            href="#how"
            onClick={(e) => {
              e.preventDefault();
              scrollToId('how');
            }}
          >
            看它怎么工作
          </a>
        </div>
        <ul className="hero-badges">
          <li>macOS 14+ / Windows 11</li>
          <li>模型 260MB</li>
          <li>离线可用</li>
        </ul>
      </div>

      {/* 指针位置写进 --px/--py，由三套主题各自决定拿它做什么（光斑 / 视差 / 旋转） */}
      <div className="hero-visual" data-visual onMouseMove={onMove} aria-hidden="true">
        <div className="stack-photos">
          <span className="ph ph--1">2019 · 未整理</span>
          <span className="ph ph--2">模糊 · 连拍</span>
          <span className="ph ph--3">截图 · 重复</span>
        </div>
        <div className="arrow" />
        <div className="organised">
          <span className="grp">家庭 12</span>
          <span className="grp">旅行 9</span>
          <span className="grp">人物 14</span>
          <span className="grp">待确认 3</span>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section id="features" className="section">
      <h2 className="section-title">它在做什么</h2>
      <div className="cards">
        {FEATURES.map((f) => (
          <article className="card" key={f.id} data-feature={f.id} data-reveal>
            <span className="card-icon">
              <Icon name={f.id} size={22} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function How() {
  return (
    <section id="how" className="section">
      <h2 className="section-title">三步跑完，随时可停</h2>
      <ol className="steps">
        {STEPS.map((s) => (
          <li className="step" key={s.n} data-step={s.n} data-reveal>
            <span className="step-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="stats" data-stats>
        {STATS.map((s) => (
          <div className="stat" key={s.k}>
            <span className="stat-v">{s.v}</span>
            <span className="stat-u">{s.unit}</span>
            <span className="stat-k">{s.k}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
