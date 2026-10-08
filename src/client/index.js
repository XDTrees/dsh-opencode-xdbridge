/**
 * Browser half: the OpenCode-XDbridge settings page.
 *
 * Layout follows the OW Bridge control panel — a status line, a metric strip,
 * and a model directory where each row carries its capability badges, a
 * recommended-use line and its last-observed response time — adapted to a DSH
 * settings page rather than a standalone window.
 *
 * This file is authored as the body of the host's module-loader factory: it is
 * plain CJS, it may `require` only platform-seeded packages (`react`), and it
 * ends by assigning `module.exports`. `scripts/build-client.mjs` wraps it.
 *
 * @module dsh-opencode-xdbridge/client
 */

const React = require('react')
const h = React.createElement

/** Stable browser-plugin name. */
const name = 'dsh-opencode-xdbridge-client'

/**
 * Client services required by this page.
 *
 * Only services present on every host line may be named here: cordis' gate is
 * hard, and an inject entry the running line does not provide keeps `apply`
 * from ever running. The settings surface itself is reached through `ctx.get()`
 * inside `apply`, never named here.
 */
const inject = ['slots', 'locale']

/** Settings namespace, shared with the host half. */
const SETTINGS_NS = 'opencode-xdbridge'

/** Host plugin entry id, used to find this plugin's config form. */
const ENTRY_ID = 'llm-opencode-xdbridge'

/** Plugin-owned routes. Mirrored from lib/status-paths.js. */
const STATUS_PATH = '/plugins/dsh-opencode-xdbridge/status'
const REFRESH_PATH = '/plugins/dsh-opencode-xdbridge/models/refresh'
const PROBE_PATH = '/plugins/dsh-opencode-xdbridge/models/probe'
const RESTART_PATH = '/plugins/dsh-opencode-xdbridge/runtime/restart'

/** How often the card re-reads the status document while it is open. */
const POLL_INTERVAL_MS = 5000

/**
 * The product mark, drawn inline so the page needs no asset pipeline.
 *
 * A diamond (OpenCode's own motif) above a bridge arch: the bridge is what this
 * plugin is.
 */
const MARK_SVG = [
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">',
  '<path d="M12 2.6 15.4 6 12 9.4 8.6 6z" fill="currentColor"/>',
  '<path d="M3.6 20.2c0-4.64 3.76-8.4 8.4-8.4s8.4 3.76 8.4 8.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  '</svg>',
].join('')

/**
 * The same mark as a CSS mask, for the Settings nav row.
 *
 * The `settings.section` contract carries no icon field — the shell paints its
 * own glyph per section id and falls back to a gear — so the row is marked in
 * the DOM and this artwork is masked over the shell's svg.
 */
const MARK_MASK_URL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M12 2.6 15.4 6 12 9.4 8.6 6z" fill="#000"/>' +
  '<path d="M3.6 20.2c0-4.64 3.76-8.4 8.4-8.4s8.4 3.76 8.4 8.4" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round"/>' +
  '</svg>',
)}")`

/** Locale copy. */
const zh = {
  'row.navLabel': 'OpenCode-XD',
  'page.title': 'OpenCode-XDbridge',
  'page.desc': '由本机受管的 OpenCode 运行时提供，自动发现全部免费模型。',
  'action.refresh': '读取模型',
  'action.refreshing': '正在读取…',
  'action.probe': '检测全部',
  'action.probing': '正在检测…',
  'action.restart': '重启运行时',
  'action.restarting': '正在重启…',
  'metric.discovered': '已发现',
  'metric.available': '可用',
  'metric.pending': '待检测',
  'metric.flaky': '不稳定',
  'metric.unusable': '不可用',
  'status.starting': '正在启动隔离模型服务',
  'status.ready': '运行中',
  'status.error': '运行时错误',
  'status.stopped': '已停止',
  'status.retry': '重试',
  'models.empty': '正在安装或扫描模型，完成后将在这里显示。',
  'models.title': '模型目录',
  'models.hint': '推荐用途按模型实测能力整理，仅供参考。',
  'badge.reasoning': '推理',
  'badge.images': '图片',
  'badge.tools': '工具',
  'state.available': '可用',
  'state.chatOnly': '可用 · 仅对话',
  'state.probing': '检测中',
  'state.queued': '等待检测',
  'state.busy': '请求中',
  'state.pending': '待检测',
  'state.timeout': '检测超时',
  'state.quota': '额度不足',
  'state.rateLimit': '请求受限',
  'state.access': '访问受限',
  'state.region': '地区不可用',
  'state.unusable': '不可用',
  'timing.none': '耗时 —',
  'timing.probe': '最近检测',
  'timing.request': '最近调用',
  'timing.ok': '响应',
  'timing.fail': '失败',
  'detail.context': '可用上下文',
  'detail.contextRaw': '声明',
  'detail.output': '输出上限',
  'detail.images': '图片输入',
  'detail.tools': '工具调用',
  'detail.reasoning': '推理',
  'detail.efforts': '可选档位',
  'detail.default': '使用默认模式',
  'detail.yes': '支持',
  'detail.no': '不支持',
  'detail.use': '推荐用途',
  'detail.calls': '最近一次调用返回了 {n} 个动作。',
  'detail.native': '最近一次调用拦截了 {n} 次本地执行尝试，动作必须由 Harness 执行。',
  'detail.handoff': '最近一次调用把被拦下的本地动作转交成外部 {name} 调用。',
  'detail.updated': '最近更新：{time}',
  'detail.never': '尚未检测',
  'detail.close': '收起',
  'footer.note': '免费模型由 OpenCode Zen 提供，清单与额度随上游变化。检测会发送一次真实请求，消耗少量免费额度。',
  'runtime.version': '运行时',
  'runtime.endpoint': '本地端点',
  'runtime.dataDir': '数据目录',
  'runtime.proxy': '运行时代理',
  'feedback.refreshed': '已读取 {n} 个免费模型。',
  'feedback.probed': '检测完成：{ok} 个可用，{fail} 个不可用。',
  'feedback.restarted': '运行时已重启，共 {n} 个免费模型。',
  'error.prefix': '操作失败：',
}

const en = {
  'row.navLabel': 'OpenCode-XD',
  'page.title': 'OpenCode-XDbridge',
  'page.desc': 'Served by a managed local OpenCode runtime, which discovers every free model automatically.',
  'action.refresh': 'Read models',
  'action.refreshing': 'Reading…',
  'action.probe': 'Test all',
  'action.probing': 'Testing…',
  'action.restart': 'Restart runtime',
  'action.restarting': 'Restarting…',
  'metric.discovered': 'Discovered',
  'metric.available': 'Available',
  'metric.pending': 'Untested',
  'metric.flaky': 'Flaky',
  'metric.unusable': 'Unusable',
  'status.starting': 'Starting the isolated model service',
  'status.ready': 'Running',
  'status.error': 'Runtime error',
  'status.stopped': 'Stopped',
  'status.retry': 'Retry',
  'models.empty': 'Models appear here once installation and scanning finish.',
  'models.title': 'Model directory',
  'models.hint': 'Recommended use is derived from each model\u2019s measured capabilities and is advisory only.',
  'badge.reasoning': 'Reasoning',
  'badge.images': 'Images',
  'badge.tools': 'Tools',
  'state.available': 'Available',
  'state.chatOnly': 'Available · chat only',
  'state.probing': 'Testing',
  'state.queued': 'Queued',
  'state.busy': 'In flight',
  'state.pending': 'Untested',
  'state.timeout': 'Timed out',
  'state.quota': 'Out of quota',
  'state.rateLimit': 'Rate limited',
  'state.access': 'Access denied',
  'state.region': 'Region blocked',
  'state.unusable': 'Unusable',
  'timing.none': 'Time —',
  'timing.probe': 'Last test',
  'timing.request': 'Last call',
  'timing.ok': 'ok',
  'timing.fail': 'failed',
  'detail.context': 'Usable context',
  'detail.contextRaw': 'declared',
  'detail.output': 'Output limit',
  'detail.images': 'Image input',
  'detail.tools': 'Tool calls',
  'detail.reasoning': 'Reasoning',
  'detail.efforts': 'Levels',
  'detail.default': 'using the default mode',
  'detail.yes': 'yes',
  'detail.no': 'no',
  'detail.use': 'Recommended use',
  'detail.calls': 'The last call returned {n} action(s).',
  'detail.native': 'The last call blocked {n} native execution attempt(s); the Harness owns execution.',
  'detail.handoff': 'The last call handed a blocked native action over as an external {name} call.',
  'detail.updated': 'Last updated: {time}',
  'detail.never': 'Not tested yet',
  'detail.close': 'Collapse',
  'footer.note': 'Free models come from OpenCode Zen; the roster and quota follow upstream. Testing sends one real request and spends a little of the free quota.',
  'runtime.version': 'Runtime',
  'runtime.endpoint': 'Endpoint',
  'runtime.dataDir': 'Data dir',
  'runtime.proxy': 'Runtime proxy',
  'feedback.refreshed': 'Read {n} free model(s).',
  'feedback.probed': 'Testing done: {ok} available, {fail} unusable.',
  'feedback.restarted': 'Runtime restarted with {n} free model(s).',
  'error.prefix': 'Failed: ',
}

/**
 * Curated "what is this good for" notes, keyed by runtime model id.
 *
 * Every claim here is grounded in the capabilities the runtime actually reports
 * (context window, output ceiling, image input, reasoning levels) plus the
 * model family — never in an unverifiable marketing claim. `recommendedUse`
 * falls back to a capability-derived line for any model not listed, so a new
 * free model still gets a truthful summary on the day it appears.
 */
const USE_NOTES = {
  'opencode/big-pickle': {
    zh: '通用对话与轻量编码。上下文适中、响应稳定，适合日常问答、短代码片段和快速改写。',
    en: 'General chat and light coding. Moderate context and steady latency; good for everyday Q&A, short code snippets and quick rewrites.',
  },
  'opencode/ling-3.0-flash-fin-free': {
    zh: '金融领域调优的轻量快速模型，带 low/medium/high 推理档。适合金融文本分析、结构化抽取，以及需要控制推理深度省时间的任务。',
    en: 'A light, fast model tuned for finance, with low/medium/high reasoning. Good for financial text analysis, structured extraction, and tasks where reasoning depth is traded for speed.',
  },
  'opencode/longcat-2.5-preview-free': {
    zh: '100 万上下文 + 图片输入（预览版）。适合长文档通读、整库检索、图文混合问答。',
    en: 'One-million-token context plus image input (preview). Good for reading whole documents, repo-wide retrieval, and mixed text-and-image Q&A.',
  },
  'opencode/mimo-v2.6-flash-free': {
    zh: '快速多模态，支持图片输入。适合图片理解、短任务和批量处理。',
    en: 'Fast and multimodal, with image input. Good for image understanding, short tasks and batch work.',
  },
  'opencode/nemotron-3-ultra-free': {
    zh: '100 万上下文旗舰，推理强。适合大型代码库分析、深度推理和长报告撰写。',
    en: 'A million-token flagship with strong reasoning. Good for large-codebase analysis, deep reasoning and long reports.',
  },
  'opencode/nemotron-3.5-lightning-free': {
    zh: '输出上限高达 26 万 token 的闪电版。适合生成长文档、大段代码，或一次性输出大量内容。',
    en: 'A lightning variant with a 262K output ceiling. Good for generating long documents, large code blocks, or a lot of output in one pass.',
  },
  'opencode/space-bunny-free': {
    zh: '100 万上下文 + 52 万输出 + 最全推理档位（5 档）。适合超长生成、复杂代理任务和需要精细控制推理的场景。',
    en: 'Million-token context, 524K output, and the fullest set of reasoning levels (five). Good for very long generation, complex agent work, and cases needing fine reasoning control.',
  },
  'opencode/muse-spark-1.3-contributor-free': {
    zh: '贡献者免费档，100 万上下文 + 图片输入 + 5 档推理。适合图文长文和综合性代理任务。',
    en: 'A contributor-tier free model: million-token context, image input, five reasoning levels. Good for long mixed-media work and broad agent tasks.',
  },
}

/** The recommended-use line for one model. */
function recommendedUse(model, locale) {
  const note = USE_NOTES[model.id]
  if (note !== undefined) return locale === 'en' ? note.en : note.zh
  const parts = []
  if (model.contextWindow >= 1_000_000) parts.push(locale === 'en' ? '1M context' : '100 万上下文')
  else if (model.contextWindow >= 200_000) parts.push(locale === 'en' ? `${Math.round(model.contextWindow / 1000)}K context` : `${Math.round(model.contextWindow / 1000)}K 上下文`)
  if (model.maxOutputTokens >= 100_000) parts.push(locale === 'en' ? 'very large output' : '超大输出上限')
  if (model.supportsImages) parts.push(locale === 'en' ? 'image input' : '图片输入')
  if (model.supportsReasoning) parts.push(locale === 'en' ? 'reasoning' : '支持推理')
  return parts.length === 0 ? '' : `${parts.join(' · ')}.`
}

/** Card styles. Uses the host's own theme tokens so it matches built-in pages. */
const CSS = `
.dsm-ocxb-page{max-width:860px;flex-direction:column;gap:16px;display:flex}
.dsm-ocxb-head{align-items:center;gap:12px;flex-wrap:wrap;display:flex}
.dsm-ocxb-mark{width:34px;height:34px;flex:none;color:#28c8b4}
.dsm-ocxb-mark svg{width:100%;height:100%;display:block}
.dsm-ocxb-headcopy{flex-direction:column;gap:4px;min-width:0;flex:1 1 220px;display:flex}
.dsm-ocxb-title{color:var(--dsw-alias-label-primary,#e6e6e6);margin:0;font-size:16px;font-weight:600;line-height:1.4}
.dsm-ocxb-desc{color:var(--dsw-alias-label-tertiary,#999);margin:0;font-size:13px;line-height:1.5}
.dsm-ocxb-actions{align-items:center;gap:8px;flex-wrap:wrap;flex:none;display:flex}
.dsm-ocxb-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-2,#232529);border-radius:14px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}
.dsm-ocxb-cardtitle{color:var(--dsw-alias-label-primary,#e6e6e6);margin:0;font-size:14px;font-weight:600;line-height:1.4}
.dsm-ocxb-cardhint{color:var(--dsw-alias-label-tertiary,#9aa0a8);margin:0;font-size:11px;line-height:1.5}
.dsm-ocxb-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dsm-ocxb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}
.dsm-ocxb-btn:disabled{opacity:.4;cursor:default}
.dsm-ocxb-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}
.dsm-ocxb-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}
.dsm-ocxb-btn-primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-layer-3,#202126)}
.dsm-ocxb-btn-primary:hover:not(:disabled){opacity:.9}
.dsm-ocxb-status{align-items:center;gap:10px;flex-wrap:wrap;display:flex;font-size:13px;color:var(--dsw-alias-label-secondary,#c6c9d0)}
.dsm-ocxb-dot{width:8px;height:8px;flex:none;border-radius:50%;background:#28c8b4}
.dsm-ocxb-dot-error{background:#e85a5a}
.dsm-ocxb-dot-starting{background:#d8a657}
.dsm-ocxb-metrics{display:flex;gap:26px;flex-wrap:wrap}
.dsm-ocxb-metric{flex-direction:column;gap:2px;display:flex}
.dsm-ocxb-metric b{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:20px;font-weight:600;line-height:1.2}
.dsm-ocxb-metric span{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:1.4}
.dsm-ocxb-meta{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a8);word-break:break-all}
.dsm-ocxb-meta-muted{opacity:.75}
.dsm-ocxb-list{flex-direction:column;gap:6px;display:flex}
/* One directory entry: the row plus, when open, its own detail panel directly
   beneath it. Keeping them in one item is what anchors the panel to the row. */
.dsm-ocxb-item{flex-direction:column;gap:6px;display:flex}
.dsm-ocxb-row{align-items:flex-start;gap:11px;width:100%;text-align:left;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-3,#2a2c33);color:var(--dsw-alias-label-primary,#e6e6e6);display:flex}
.dsm-ocxb-row:hover{border-color:var(--dsw-alias-border-l2)}
.dsm-ocxb-row-selected{border-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsm-ocxb-row-icon{width:15px;flex:none;text-align:center;color:#28c8b4;font-size:13px;line-height:1.5}
.dsm-ocxb-row-info{flex-direction:column;gap:3px;min-width:0;flex:1 1 auto;display:flex}
.dsm-ocxb-row-name{font-size:13px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsm-ocxb-row-use{font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a8);line-height:1.55}
.dsm-ocxb-row-meta{font-size:11px;color:var(--dsw-alias-label-dimmed,#7b828c);line-height:1.4}
.dsm-ocxb-badges{align-items:center;gap:6px;flex:none;flex-wrap:wrap;display:flex;justify-content:flex-end}
.dsm-ocxb-badge{font-size:11px;line-height:1.6;border-radius:6px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-secondary,#c6c9d0);background:transparent;white-space:nowrap}
.dsm-ocxb-badge-reasoning{color:#8ab4f8;border-color:rgba(138,180,248,.4)}
.dsm-ocxb-badge-images{color:#7fd1b9;border-color:rgba(127,209,185,.4)}
.dsm-ocxb-badge-ok{color:#4ade9f;border-color:rgba(74,222,159,.4)}
.dsm-ocxb-badge-bad{color:#ff6b68;border-color:rgba(255,107,104,.4)}
.dsm-ocxb-detail{gap:6px;border-radius:10px;padding:12px;background:var(--dsw-alias-bg-layer-3,#2a2c33);display:flex;flex-direction:column}
.dsm-ocxb-detail-id{margin:0;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#c6c9d0);word-break:break-all}
.dsm-ocxb-detail p{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsm-ocxb-detail .dsm-ocxb-error{color:#ff6b68}
.dsm-ocxb-empty{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:13px;margin:0}
.dsm-ocxb-feedback{border-radius:10px;padding:9px 12px;font-size:12px;line-height:1.5;background:rgba(40,200,180,.12);color:var(--dsw-alias-label-secondary,#c6c9d0);border:1px solid rgba(40,200,180,.3)}
.dsm-ocxb-feedback-error{background:rgba(232,90,90,.12);border-color:rgba(232,90,90,.35);color:#ff9b98}
.dsm-ocxb-footer{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:1.6;margin:0}
.dsm-ocxb-spinner{display:inline-block;width:11px;height:11px;border:2px solid var(--dsw-alias-border-l2,#3a3d45);border-top-color:var(--dsw-alias-label-secondary,#c6c9d0);border-radius:50%;animation:dsm-ocxb-spin .7s linear infinite}
@keyframes dsm-ocxb-spin{to{transform:rotate(360deg)}}
`

/** Install or refresh this card's stylesheet. */
function installStyles() {
  if (typeof document === 'undefined') return
  const id = 'dsh-opencode-xdbridge/client.css'
  const existing = document.querySelector(`style[data-plugin-css="${id}"]`)
  if (existing !== null) {
    existing.textContent = CSS
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-opencode-xdbridge'
  tag.dataset.pluginCss = id
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Substitute `{name}` placeholders. */
function fill(template, params) {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
}

/** Format a millisecond duration the way the OW Bridge panel does. */
function formatDuration(ms) {
  if (!Number.isFinite(ms)) return undefined
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Format a timestamp for the detail row. */
function formatTime(ms) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

/**
 * Format a token count compactly: 200K, 1.0M.
 *
 * The raw numbers are seven digits long, which crowds the detail row without
 * telling the reader anything more than the rounded figure does.
 */
function formatTokens(tokens) {
  if (!Number.isFinite(tokens)) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/**
 * Rank a model for display: healthy first, unusable last, untested between.
 *
 * Mirrors the OW Bridge panel so a broken model never sits above a working one.
 */
function rank(model, status) {
  if (status.probe?.running && (status.probe.pending ?? []).includes(model.id)) return 1
  if (model.lastResult?.ok === true) return 0
  if (model.lastResult?.ok === false) return 2
  return 1
}

/** The status label and tone for one model row. */
function modelState(model, status, t) {
  const probing = status.probe?.running === true
  const pending = status.probe?.pending ?? []
  if (probing && pending.includes(model.id)) {
    return { text: status.probe.current === model.id ? t('state.probing') : t('state.queued'), tone: 'wait' }
  }
  if ((status.activity ?? []).some(entry => entry.model === model.id)) {
    return { text: t('state.busy'), tone: 'wait' }
  }
  const result = model.lastResult
  if (result === undefined) return { text: t('state.pending'), tone: 'wait' }
  if (result.ok === true) {
    return { text: result.chatOnly === true ? t('state.chatOnly') : t('state.available'), tone: 'ok' }
  }
  const byCategory = {
    timeout: t('state.timeout'),
    quota: t('state.quota'),
    rate_limit: t('state.rateLimit'),
    access: t('state.access'),
    region: t('state.region'),
  }
  // A transient failure is shown in the waiting tone, not the failure tone: the
  // model is still offered, so painting it red would overstate the problem.
  const transient = !['region', 'access', 'quota'].includes(result.category)
  return { text: byCategory[result.category] ?? t('state.unusable'), tone: transient ? 'wait' : 'bad' }
}

/** The "last measured" line under a model's recommended use. */
function timingLine(model, t) {
  const result = model.lastResult
  if (result === undefined || !Number.isFinite(result.durationMs)) return t('timing.none')
  const duration = formatDuration(result.durationMs)
  const kind = result.source === 'probe' ? t('timing.probe') : t('timing.request')
  const outcome = result.ok ? t('timing.ok') : t('timing.fail')
  return `${kind} · ${outcome} ${duration}`
}

/** One small badge. */
function badge(text, variant) {
  return h('span', { className: `dsm-ocxb-badge${variant ? ` dsm-ocxb-badge-${variant}` : ''}`, key: text }, text)
}

/** The model directory, sorted so healthy models come first. */
function ModelList({ status, t, locale, selected, onSelect }) {
  const models = [...(status.models ?? [])].sort((a, b) => rank(a, status) - rank(b, status) || a.name.localeCompare(b.name))
  if (models.length === 0) return h('p', { className: 'dsm-ocxb-empty' }, t('models.empty'))

  const rows = []
  for (const model of models) {
    const state = modelState(model, status, t)
    const tone = state.tone === 'ok' ? 'ok' : state.tone === 'bad' ? 'bad' : undefined
    const badges = []
    if (model.supportsReasoning) badges.push(badge(t('badge.reasoning'), 'reasoning'))
    if (model.supportsImages) badges.push(badge(t('badge.images'), 'images'))
    badges.push(badge(state.text, tone))

    const open = selected === model.id

    // The row and its detail share one list item, so the panel opens directly
    // under the row that was clicked rather than after the whole directory.
    rows.push(h('div', { key: model.id, className: 'dsm-ocxb-item' },
      h('button', {
        type: 'button',
        className: `dsm-ocxb-row${open ? ' dsm-ocxb-row-selected' : ''}`,
        onClick: () => onSelect(open ? null : model.id),
        'aria-expanded': String(open),
      },
      h('span', { className: 'dsm-ocxb-row-icon', 'aria-hidden': 'true' },
        status.probe?.running && (status.probe.pending ?? []).includes(model.id)
          ? h('span', { className: 'dsm-ocxb-spinner' })
          : '◇'),
      h('span', { className: 'dsm-ocxb-row-info' },
        h('span', { className: 'dsm-ocxb-row-name' }, model.name),
        h('span', { className: 'dsm-ocxb-row-use' }, recommendedUse(model, locale)),
        h('span', { className: 'dsm-ocxb-row-meta' }, timingLine(model, t))),
      h('span', { className: 'dsm-ocxb-badges' }, badges)),
      open && h(ModelDetail, { model, t, locale })))
  }
  return h('div', { className: 'dsm-ocxb-list' }, rows)
}

/** The expanded detail panel for one model. */
function ModelDetail({ model, t, locale }) {
  const result = model.lastResult ?? {}
  const lines = []

  if (Number.isInteger(result.calls) && result.calls > 0) {
    lines.push({ text: fill(t('detail.calls'), { n: result.calls }) })
  }
  if (Number.isInteger(result.nativeAttempts) && result.nativeAttempts > 0) {
    lines.push({ text: fill(t('detail.native'), { n: result.nativeAttempts }), error: true })
  }
  if (typeof result.handoff === 'string') {
    lines.push({ text: fill(t('detail.handoff'), { name: result.handoff }) })
  }

  const use = recommendedUse(model, locale)
  // The advertised context is the usable budget, not the raw window: the
  // difference is what stops the Harness from building a request the model
  // cannot accept. Both numbers are shown so the gap is not a mystery.
  const contextText = model.reportedContextWindow !== undefined && model.reportedContextWindow !== model.contextWindow
    ? `${formatTokens(model.contextWindow)} / ${t('detail.contextRaw')} ${formatTokens(model.reportedContextWindow)}`
    : formatTokens(model.contextWindow)
  const detail = [
    ...(use === '' ? [] : [{ text: `${t('detail.use')}：${use}` }]),
    { text: `${t('detail.context')}：${contextText}` },
    { text: `${t('detail.output')}：${formatTokens(model.maxOutputTokens)}` },
    { text: `${t('detail.images')}：${model.supportsImages ? t('detail.yes') : t('detail.no')}` },
    { text: `${t('detail.tools')}：${model.supportsTools ? t('detail.yes') : t('detail.no')}` },
    {
      text: model.supportsReasoning
        ? `${t('detail.reasoning')}：${t('detail.yes')} · ${(model.supportedEfforts ?? []).length > 0 ? `${t('detail.efforts')} ${model.supportedEfforts.join(' / ')}` : t('detail.default')}`
        : `${t('detail.reasoning')}：${t('detail.no')}`,
    },
    { text: fill(t('detail.updated'), { time: result.time ? formatTime(result.time) : t('detail.never') }) },
  ]
  if (typeof result.error === 'string' && result.error !== '') detail.push({ text: result.error, error: true })

  return h('div', { className: 'dsm-ocxb-detail' },
    h('p', { className: 'dsm-ocxb-detail-id' }, model.id),
    [...lines, ...detail].map((line, index) => h('p', {
      key: `${index}-${line.text}`,
      className: line.error ? 'dsm-ocxb-error' : undefined,
    }, line.text)))
}

/** The whole settings page. */
function BridgePage(props) {
  const { t, locale } = props
  const [status, setStatus] = React.useState(null)
  const [feedback, setFeedback] = React.useState(null)
  const [busy, setBusy] = React.useState(null)
  const [selected, setSelected] = React.useState(null)

  // Poll the host for the live status document. The page is the only reader, so
  // the interval is owned here and torn down with the component.
  React.useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        const response = await fetch(STATUS_PATH, { headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next = await response.json()
        if (alive) setStatus(next)
      } catch (error) {
        if (alive) setStatus(previous => previous ?? {
          phase: 'error', message: String(error?.message ?? error), models: [], probe: { running: false, pending: [] }, activity: [], metrics: { discovered: 0, available: 0, pending: 0, unusable: 0 }, dataDir: '', provider: '',
        })
      }
    }
    void read()
    const timer = setInterval(read, POLL_INTERVAL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const act = async (key, path, body) => {
    if (busy !== null) return
    setBusy(key)
    setFeedback(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      if (key === 'refresh') setFeedback({ text: fill(t('feedback.refreshed'), { n: result.count ?? 0 }) })
      else if (key === 'probe') setFeedback({ text: fill(t('feedback.probed'), { ok: result.ok ?? 0, fail: result.failed ?? 0 }) })
      else if (key === 'restart') setFeedback({ text: fill(t('feedback.restarted'), { n: result.count ?? 0 }) })
      // Re-read immediately so the panel reflects the action without waiting a tick.
      const fresh = await fetch(STATUS_PATH).then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (fresh) setStatus(fresh)
    } catch (error) {
      setFeedback({ text: `${t('error.prefix')}${String(error?.message ?? error)}`, error: true })
    } finally {
      setBusy(null)
    }
  }

  const running = status?.probe?.running === true
  const phase = status?.phase ?? 'starting'
  const metrics = status?.metrics ?? { discovered: 0, available: 0, pending: 0, unusable: 0 }

  const action = (key, path, labelKey, body) => h('button', {
    type: 'button',
    className: `dsm-ocxb-btn ${key === 'refresh' ? 'dsm-ocxb-btn-primary' : 'dsm-ocxb-btn-outline'}`,
    disabled: busy !== null || running || phase === 'starting',
    onClick: () => void act(key, path, body),
  }, busy === key
    ? h('span', {}, h('span', { className: 'dsm-ocxb-spinner' }), ` ${t(labelKey)}`)
    : t(labelKey))

  const phaseText = running
    ? t('state.probing')
    : (status?.activity?.length > 0 ? `${t('state.busy')} · ${status.activity[0].model}` : null)
      ?? status?.message
      ?? t(`status.${phase}`)

  return h('div', { className: 'dsm-ocxb-page' },
    // Header: mark and identity on the left, primary actions on the right.
    h('div', { className: 'dsm-ocxb-head' },
      h('span', { className: 'dsm-ocxb-mark', dangerouslySetInnerHTML: { __html: MARK_SVG } }),
      h('div', { className: 'dsm-ocxb-headcopy' },
        h('h2', { className: 'dsm-ocxb-title' }, t('page.title')),
        h('p', { className: 'dsm-ocxb-desc' }, t('page.desc'))),
      h('div', { className: 'dsm-ocxb-actions' },
        action('refresh', REFRESH_PATH, busy === 'refresh' ? 'action.refreshing' : 'action.refresh'),
        action('probe', PROBE_PATH, busy === 'probe' ? 'action.probing' : 'action.probe'),
        action('restart', RESTART_PATH, busy === 'restart' ? 'action.restarting' : 'action.restart'))),

    // Service state + runtime facts.
    h('div', { className: 'dsm-ocxb-card' },
      h('div', { className: 'dsm-ocxb-status' },
        h('span', { className: `dsm-ocxb-dot${phase === 'error' ? ' dsm-ocxb-dot-error' : phase === 'starting' ? ' dsm-ocxb-dot-starting' : ''}` }),
        h('span', {}, phaseText),
        phase === 'error' && h('button', {
          type: 'button', className: 'dsm-ocxb-btn dsm-ocxb-btn-outline', disabled: busy !== null,
          onClick: () => void act('restart', RESTART_PATH),
        }, t('status.retry'))),
      h('div', { className: 'dsm-ocxb-metrics' },
        h('div', { className: 'dsm-ocxb-metric' }, h('b', {}, String(metrics.discovered)), h('span', {}, t('metric.discovered'))),
        h('div', { className: 'dsm-ocxb-metric' }, h('b', {}, String(metrics.available)), h('span', {}, t('metric.available'))),
        h('div', { className: 'dsm-ocxb-metric' }, h('b', {}, String(metrics.pending)), h('span', {}, t('metric.pending'))),
        (metrics.flaky ?? 0) > 0 && h('div', { className: 'dsm-ocxb-metric' }, h('b', {}, String(metrics.flaky)), h('span', {}, t('metric.flaky'))),
        h('div', { className: 'dsm-ocxb-metric' }, h('b', {}, String(metrics.unusable)), h('span', {}, t('metric.unusable')))),
      status !== null && h('div', { className: 'dsm-ocxb-meta' },
        status.runtimeVersion !== undefined && h('span', {}, `${t('runtime.version')}：OpenCode ${status.runtimeVersion}`),
        status.endpoint !== undefined && h('span', {}, `${t('runtime.endpoint')}：${status.endpoint}`),
        // Which route the runtime's own upstream calls take. Without it, a
        // proxied network the runtime did not inherit looks exactly like the
        // upstream being down.
        status.proxy !== undefined && h('span', {
          className: status.proxy.configured ? undefined : 'dsm-ocxb-meta-muted',
        }, `${t('runtime.proxy')}：${status.proxy.summary}`),
        status.dataDir !== '' && h('span', {}, `${t('runtime.dataDir')}：${status.dataDir}`))),

    feedback !== null && h('div', { className: `dsm-ocxb-feedback${feedback.error ? ' dsm-ocxb-feedback-error' : ''}` }, feedback.text),

    // Model directory. The detail panel is rendered by the list itself, inside
    // the clicked row's own item, so it opens directly underneath that row.
    h('div', { className: 'dsm-ocxb-card' },
      h('h3', { className: 'dsm-ocxb-cardtitle' }, t('models.title')),
      h('p', { className: 'dsm-ocxb-cardhint' }, t('models.hint')),
      status === null
        ? h('p', { className: 'dsm-ocxb-empty' }, t('models.empty'))
        : h(ModelList, { status, t, locale, selected, onSelect: setSelected })),

    h('p', { className: 'dsm-ocxb-footer' }, t('footer.note')))
}

/** Attribute carrying the nav-row marker this module installs. */
const NAV_ICON_MARKER = 'data-dsh-ocxb-nav-icon'

/**
 * The settings nav rows, as the shell renders them. Scoped to the settings
 * dialog on purpose: the main sidebar has its own nav, and matching rows there
 * would stamp this glyph onto an unrelated control.
 */
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/**
 * Draw this page's own glyph in its Settings nav row.
 *
 * The `settings.section` contract carries no icon field: the shell decides the
 * glyph from the section id and falls back to a gear for anything it does not
 * know. So the row is matched by its LABEL (the same thunk passed to the
 * registration, re-read on every pass so a locale switch is followed) and
 * marked; CSS then hides the shell svg and masks this artwork into the row.
 *
 * Re-scanned on DOM mutations because the shell re-renders the nav on locale
 * and theme changes, which replaces the row elements and drops the marker.
 */
function installNavIcon(ctx, resolveLabel) {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-opencode-xdbridge'
    tag.dataset.pluginCss = 'dsh-opencode-xdbridge/settings-nav-icon'
    tag.textContent = [
      `[${NAV_ICON_MARKER}] > svg { display: none; }`,
      `[${NAV_ICON_MARKER}]::before {`,
      "  content: '';",
      '  flex: none;',
      '  width: 16px;',
      '  height: 16px;',
      '  background-color: currentColor;',
      `  -webkit-mask-image: ${MARK_MASK_URL};`,
      `  mask-image: ${MARK_MASK_URL};`,
      '  -webkit-mask-repeat: no-repeat;',
      '  mask-repeat: no-repeat;',
      '  -webkit-mask-position: center;',
      '  mask-position: center;',
      '  -webkit-mask-size: 16px 16px;',
      '  mask-size: 16px 16px;',
      '}',
    ].join('\n')
    document.head.appendChild(tag)

    let disposed = false
    let scheduled = false
    const sync = () => {
      scheduled = false
      if (disposed) return
      const wanted = String(resolveLabel() ?? '').trim()
      if (wanted === '') return
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (String(row.textContent ?? '').trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }
    const schedule = () => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }
    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer.disconnect()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
      tag.remove()
    }
  }, 'dsh-opencode-xdbridge: settings nav icon')
}

/**
 * Register the page and its copy.
 *
 * The whole body is wrapped so a slot-API change degrades to a console error
 * instead of tripping the host's "failed to load plugins" banner — the provider
 * keeps serving models either way.
 */
function apply(ctx) {
  try {
    const namespace = `settings.${SETTINGS_NS}`
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-opencode-xdbridge: settings copy')
    const t = ctx.locale.bind(namespace)

    // The nav label and the recommended-use line follow the active dictionary.
    // The locale snapshot's active field is `active` (see the host's own
    // `snapshot.active === 'zh'` check); `getSnapshot` is read defensively
    // because a locked-down host may not expose it.
    const locale = () => {
      try {
        return ctx.locale.getSnapshot?.()?.active ?? 'zh'
      } catch {
        return 'zh'
      }
    }

    installStyles()

    // Two-phase registration: `inject` waits for the slot to be declared by the
    // settings shell, which is what lets this page land in the left nav.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: SETTINGS_NS,
      // After the built-in pages (General 0 / Models 10 / Plugins 15 / presets 20
      // / market 40) so this sits with the other community pages.
      order: 450,
      // A thunk, not a resolved string: the shell re-reads it on every
      // projection, so the nav row follows a locale change.
      label: () => t('row.navLabel'),
      inject: () => ({ t, locale: locale() }),
    }, BridgePage))

    installNavIcon(ctx, () => t('row.navLabel'))
  } catch (error) {
    console.error('[dsh-opencode-xdbridge] client page failed to load (host provider unaffected):', error)
  }
}

module.exports = { name, inject, apply }
