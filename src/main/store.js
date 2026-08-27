// ============================================================
// store.js —— 轻量运行时状态盒
// 多模块共享的"小本本"：记录探测结果、在线状态、错误信息
// 避免模块间互相 import 成环，统一走这一个共享对象。
// ============================================================

class State {
  constructor(init = {}) {
    // 关键运行态字段（语义即命名，一看就懂）
    this.webUrl = init.webUrl ?? null;   // 官方 Web 地址
    this.running = init.running ?? false;// 官方 Web 是否在跑
    this.inferring = false;              // 官方进程是否在"推理中"（procmon CPU 判断）
    this.probe = null;                   // detect.js 的探测结果快照
    this.error = null;                   // 最近一次错误（供 UI 提示/上报）
    this.listeners = new Set();          // 状态变更时的回调（渲染层订阅）
    this.child = null;                   // 当前托管的 dsh web 子进程
  }

  // 探测完成后记录快照
  setProbe(probe) {
    this.probe = probe;
    this.webUrl = probe.webUrl;
    if (probe.running) this.running = true;
    this._emit();
  }

  markOnline(url) {
    this.running = true;
    this.webUrl = url || this.webUrl;
    this.error = null;
    this._emit();
  }

  markOffline(err) {
    this.running = false;
    this.inferring = false; // 不在线当然不可能在推理
    if (err) this.error = err;
    this._emit();
  }

  // 记录"是否在推理中"（procmon 每轮更新，值改变时才调用）
  setInferring(v) {
    if (this.inferring !== v) {
      this.inferring = v;
      this._emit();
    }
  }

  setChild(child) {
    this.child = child;
    this._emit();
  }

  // 订阅/退订状态变化（渲染层用，刷新顶栏在线灯等）
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.snapshot());
  }

  // 只序列化外壳需要的最小叶子字段（不把 live 对象塞回 UI 进程）
  snapshot() {
    return {
      running: this.running,
      inferring: this.inferring,
      webUrl: this.webUrl,
      error: this.error ? String(this.error) : null,
      probe: this.probe
        ? {
            found: this.probe.found,
            running: this.probe.running,
            home: this.probe.home,
            portInUse: this.probe.portInUse,
            onPath: this.probe.onPath,
          }
        : null,
    };
  }
}

module.exports = { State };
