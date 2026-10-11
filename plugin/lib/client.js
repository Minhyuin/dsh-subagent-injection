/**
 * dsh-subagent-injection — client half.
 *
 * Contributes one page to the Plugins settings section. The page owns no state
 * of its own: it reads the `llm-pi-ai` provider catalog and this plugin's
 * settings entry through `ctx.remote.settings`, and writes the edited priority
 * list back to the same entry, so the Host's Cordis configuration and the page
 * can never disagree.
 *
 * It draws no title-bar control: the Host half does the work, and the shell
 * shows exactly one 子智能体 surface — this page.
 *
 * @module dsh-subagent-injection/client
 */
window.__ModuleLoader__.load({
  id: "dsh-subagent-injection",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");
    const { Button, Checkbox } = require("@deepseek-ai/dsh-client-ui-primitives");

  /** Locale namespace owned by this plugin. */
  const NS = "subagent-injection";

  /** This plugin's settings entry id (its Cordis entry id). */
  const SETTINGS_NS = "subagent-injection";

  /**
   * The namespace-bound locale hook, resolved at render time.
   *
   * The slot hands `t` over as a prop, which is the normal path; this is the
   * fallback so the page still draws its own copy if that prop ever changes
   * shape.
   */
  let boundT = (key) => key;


  /** Locale dictionaries. */
  const zh = {
    title: "子智能体注入",
    subtitle: "按优先级为 subagent 调用注入 provider / model / 推理强度",
    empty: "还没有配置任何子智能体路由。",
    emptyHint: "添加一条路由后，主代理每次调用 subagent 都会按下面的顺序尝试。",
    add: "添加路由",
    priority: "优先级（拖动 ⠿ 调整顺序）",
    provider: "提供方",
    model: "模型",
    effort: "推理强度",
    effortAuto: "跟随模型默认",
    remove: "删除",
    moveUp: "上移",
    moveDown: "下移",
    fork: "允许 subagent_fork",
    forkHint: "取消勾选后禁用 subagent_fork：该调用会被自动改派为 subagent，并套用下面的路由顺序。",
    enabled: "启用调度",
    enabledHint: "关闭后，本插件不再改写 subagent 调用。",
    refresh: "重新读取配置",
    reload: "刷新",
    save: "保存",
    saving: "保存中…",
    saved: "已保存",
    cancel: "取消",
    routes: "路由",
    loading: "读取配置…",
    loadFailed: "读取配置失败",
    catalogFailed: "读取模型目录失败",
    catalogEmpty: "当前没有可用的模型路由",
    saveFailed: "保存失败",
    pendingEdit: "检测到外部改动，已放弃本地未保存的修改",
    noEffort: "该模型未声明推理强度",
    dragHandle: "拖动以调整优先级",
    noRemote: "客户端未拿到设置服务（remote.settings），无法读写配置。",
    noDocument: "设置文档里没有 subagent-injection 这一项，配置无法保存。",
    incompleteRow: "有一行还没选好提供方和模型",
    effortUnavailable: "有一行选了该模型不支持的推理强度，请重新选择",
  };

  const en = {
    title: "Subagent injection",
    subtitle: "Inject provider / model / reasoning effort into subagent calls, in priority order",
    empty: "No child route is configured yet.",
    emptyHint: "Add a route and every subagent call will try the candidates below, top to bottom.",
    add: "Add route",
    priority: "Priority (drag ⠿ to reorder)",
    provider: "Provider",
    model: "Model",
    effort: "Reasoning effort",
    effortAuto: "Model default",
    remove: "Remove",
    moveUp: "Move up",
    moveDown: "Move down",
    fork: "Allow subagent_fork",
    forkHint: "When unchecked, subagent_fork is disabled: the call is re-dispatched as subagent and still follows the route order below.",
    enabled: "Orchestration enabled",
    enabledHint: "When off, this plugin no longer rewrites subagent calls.",
    refresh: "Reload configuration",
    reload: "Reload",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    cancel: "Cancel",
    routes: "routes",
    loading: "Loading configuration…",
    loadFailed: "Could not read the configuration",
    catalogFailed: "Could not read the model catalog",
    catalogEmpty: "No model route is currently available",
    saveFailed: "Could not save",
    pendingEdit: "The document changed elsewhere; your unsaved edits were discarded",
    noEffort: "This model declares no reasoning effort",
    dragHandle: "Drag to change priority",
    noRemote: "The client did not receive the settings service (remote.settings), so the configuration cannot be read or written.",
    noDocument: "The settings document has no subagent-injection entry, so nothing can be saved.",
    incompleteRow: "A route still needs both a provider and a model",
    effortUnavailable: "A route carries a reasoning effort this model does not support; pick another",
  };

  /**
   * Styles, carried by the factory so module materialization injects them once.
   *
   * The page copies the shell's own settings-section geometry (`max-width:760px`,
   * a 12px flex column, 13px tertiary body text) instead of drawing a card, so it
   * reads as one more page inside the Plugins section rather than a widget
   * dropped into it.
   */
  const CSS = `
  .sinj-root{display:flex;flex-direction:column;gap:12px;max-width:760px;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
  .sinj-head{margin:0;font-size:18px;font-weight:600;line-height:26px}
  .sinj-sub{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
  .sinj-switches{display:flex;flex-direction:column;gap:6px;padding-bottom:12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
  .sinj-switch-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:22px}
  .sinj-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
  .sinj-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
  .sinj-row{display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent}
  .sinj-row[data-dragging="true"]{opacity:.45}
  .sinj-row[data-over="true"]{border-color:var(--dsw-alias-state-business-primary)}
  .sinj-grip{flex:none;width:20px;text-align:center;color:var(--dsw-alias-label-tertiary);cursor:grab;user-select:none;letter-spacing:-1px}
  .sinj-index{flex:none;width:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:right}
  .sinj-field{display:flex;align-items:center;gap:4px;min-width:0}
  .sinj-field-provider{flex:0 0 132px}
  .sinj-field-model{flex:1 1 auto}
  .sinj-field-effort{flex:0 0 116px}
  .sinj-select{box-sizing:border-box;width:100%;height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
  .sinj-select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
  .sinj-none{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}
  .sinj-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
  .sinj-actions-right{display:flex;align-items:center;gap:8px}
  .sinj-note{color:var(--dsw-alias-label-tertiary);font-size:12px}
  .sinj-note[data-error="true"]{color:var(--dsw-alias-state-error-primary)}
  .sinj-empty{padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
  .sinj-busy{padding:12px 0;color:var(--dsw-alias-label-tertiary)}
  .sinj-debug{color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;word-break:break-all}
  `;

  /** Install the stylesheet once per document. */
  function installStyles() {
    const doc = globalThis.document;
    if (doc === undefined) return;
    if (doc.querySelector("style[data-dsh-subagent-injection]") !== null) return;
    const style = doc.createElement("style");
    style.dataset.dshSubagentInjection = "";
    style.textContent = CSS;
    doc.head.append(style);
  }

  /** Every namespace name a `settings.describe()` payload carries. */
  function namespaceNames(payload) {
    const namespaces = isRecord(payload) && Array.isArray(payload.namespaces) ? payload.namespaces : Array.isArray(payload) ? payload : [];
    const names = [];
    for (const entry of namespaces) {
      if (isRecord(entry) && typeof entry.ns === "string") names.push(entry.ns);
    }
    return names;
  }

  /** Narrow an unknown value to a plain record. */
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** How long one read may take before the page reports it instead of waiting. */
  const READ_TIMEOUT_MS = 12000;

  /**
   * Bound one read.
   *
   * Every input on this page is held while a read is in flight, so a request
   * that never settles would leave the page looking disabled forever with no
   * way out. A timeout turns that silence into a failure the page can show and
   * the reader can retry.
   */
  function withTimeout(promise, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`${label} timed out after ${READ_TIMEOUT_MS}ms`));
      }, READ_TIMEOUT_MS);
      const finish = (settle) => (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle(value);
      };
      Promise.resolve(promise).then(finish(resolve), finish(reject));
    });
  }

  /**
   * Resolve the reasoning efforts one model really accepts.
   *
   * Report `null` when the model must not show an effort selector at all: the
   * model advertises no reasoning capability, so the profile serves no effort
   * levels for it. The levels shown are exactly the ones the live registry
   * advertises — an effort the adapter does not accept can never be picked, and
   * therefore can never be stored and handed to a subagent call.
   */
  function effortsFor(model) {
    const reasoning = isRecord(model) ? model.reasoning : undefined;
    if (!isRecord(reasoning) || !Array.isArray(reasoning.efforts)) return null;
    const efforts = [];
    for (const entry of reasoning.efforts) {
      if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") continue;
      efforts.push({ id: entry.id, label: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id });
    }
    return efforts.length === 0 ? null : efforts;
  }

  /**
   * Flatten the browser model catalog into the page's catalog.
   *
   * The catalog is a projection of the live LLM registry: every route the Host
   * can dispatch, with the reasoning metadata its adapter advertises, so the
   * page only ever offers routes that are really callable. Providers the Host
   * reports as failures are omitted rather than shown as empty.
   */
  function buildCatalog(payload) {
    const groups = isRecord(payload) && Array.isArray(payload.groups) ? payload.groups : [];
    const providers = [];
    const byProvider = new Map();
    for (const group of groups) {
      if (!isRecord(group) || typeof group.id !== "string" || group.id === "") continue;
      const models = [];
      if (Array.isArray(group.models)) {
        for (const model of group.models) {
          if (!isRecord(model) || typeof model.id !== "string" || model.id === "") continue;
          models.push({ id: model.id, name: typeof model.name === "string" && model.name !== "" ? model.name : model.id, efforts: effortsFor(model) });
        }
      }
      if (models.length === 0) continue;
      const provider = { id: group.id, name: typeof group.name === "string" && group.name !== "" ? group.name : group.id, models };
      providers.push(provider);
      byProvider.set(group.id, provider);
    }
    return { providers, byProvider };
  }

  /**
   * Load the live model catalog.
   *
   * `session/modelCatalog` is the shipped projection of the Host's LLM registry
   * and the same source the composer's model selector reads, so the page and the
   * picker can never disagree about which efforts a model accepts.
   */
  async function loadCatalog(session) {
    const response = await withTimeout(session.modelCatalog(), "session.modelCatalog");
    const payload = isRecord(response) && response.ok === true ? response.value : response;
    return buildCatalog(payload);
  }

  /**
   * Unwrap one remote reply.
   *
   * Every `ctx.remote.*` method resolves to an outcome envelope — `{ok: true,
   * value}` or `{ok: false, error: {message}}` — even when the Host call threw.
   * Reading the envelope as if it were the payload silently yields `undefined`,
   * which is indistinguishable from an empty document, so the unwrap happens in
   * one place and a refusal becomes a real error the page can print.
   */
  function unwrap(response, label) {
    if (!isRecord(response) || typeof response.ok !== "boolean") return response;
    if (response.ok === true) return response.value;
    const error = isRecord(response.error) ? response.error : undefined;
    throw new Error(typeof error?.message === "string" ? `${label}: ${error.message}` : `${label} failed`);
  }

  /** Read one namespace's descriptor out of a `settings.describe()` payload. */
  function descriptorOf(payload, ns) {
    const namespaces = isRecord(payload) && Array.isArray(payload.namespaces) ? payload.namespaces : Array.isArray(payload) ? payload : [];
    for (const entry of namespaces) {
      if (isRecord(entry) && entry.ns === ns) return entry;
    }
    return undefined;
  }

  /** Normalize a stored route list into rows the page can edit. */
  function rowsFromValue(value) {
    const raw = isRecord(value) && Array.isArray(value.routes) ? value.routes : [];
    const rows = [];
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      rows.push({
        key: `r${rows.length}-${Math.random().toString(36).slice(2, 8)}`,
        provider: typeof entry.provider === "string" ? entry.provider : "",
        model: typeof entry.model === "string" ? entry.model : "",
        effort: typeof entry.effort === "string" ? entry.effort : "",
      });
    }
    return rows;
  }

  /**
   * Project the page's rows back onto the stored route list.
   *
   * Report `null` when a row is still blank: the Host drops routes without a
   * provider and a model, so saving one would silently discard what is on
   * screen. The page asks for the missing pick instead.
   *
   * A row may also hold an effort left over from the model picked before it. The
   * Host forwards whatever it is given, so an effort the chosen model does not
   * advertise would fail that route's preflight and push the call down the list
   * for no reason; it is dropped here instead, which leaves the model's own
   * default in charge.
   */
  function routesFromRows(rows, catalog) {
    const routes = [];
    for (const row of rows) {
      if (row.provider === "" || row.model === "") return null;
      const route = { provider: row.provider, model: row.model };
      if (row.effort !== "" && modelEfforts(catalog, row.provider, row.model).some((entry) => entry.id === row.effort)) route.effort = row.effort;
      routes.push(route);
    }
    return routes;
  }

  /** The efforts one catalog route advertises, or none. */
  function modelEfforts(catalog, provider, model) {
    const entry = catalog === undefined ? undefined : catalog.byProvider.get(provider);
    const found = entry === undefined ? undefined : entry.models.find((candidate) => candidate.id === model);
    return Array.isArray(found?.efforts) ? found.efforts : [];
  }

  /** The stable identity of one route, used to keep selection through edits. */
  function routeKey(route) {
    return `${route.provider}\u0000${route.model}\u0000${route.effort ?? ""}`;
  }

  /** A `<select>` bound to a value list. */
  function Select({ label, value, options, placeholder, disabled, onChange }) {
    return jsx("select", {
      className: "sinj-select",
      "aria-label": label,
      value,
      disabled: disabled === true,
      onChange: (event) => onChange(event.target.value),
      children: [
        ...(placeholder === undefined ? [] : [jsx("option", { key: "", value: "", children: placeholder }, "__placeholder")]),
        ...options.map((option) => jsx("option", { key: option.id, value: option.id, children: option.label }, option.id)),
      ],
    });
  }

  /**
   * Render one candidate route row: drag handle, provider, model, and effort.
   */
  function RouteRow({ row, index, providers, byProvider, onDragStart, onDragOver, onDrop, onDragEnd, drag, onChange }) {
    const provider = byProvider.get(row.provider);
    const models = provider?.models ?? [];
    const model = models.find((entry) => entry.id === row.model);
    const efforts = model?.efforts ?? null;
    // A model the catalog no longer serves stays selectable rather than silently
    // rewriting the stored route.
    const modelOptions = models.map((entry) => ({ id: entry.id, label: entry.name === entry.id ? entry.id : `${entry.name} (${entry.id})` }));
    if (row.model !== "" && model === undefined) modelOptions.unshift({ id: row.model, label: row.model });

    const onProvider = (id) => {
      const nextProvider = byProvider.get(id);
      const nextModel = nextProvider?.models.find((entry) => entry.id === row.model) ?? nextProvider?.models[0];
      onChange({ ...row, provider: id, model: nextModel?.id ?? "", effort: "" });
    };
    const onModel = (id) => {
      const nextModel = models.find((entry) => entry.id === id);
      const allowed = nextModel?.efforts;
      const keep = Array.isArray(allowed) && allowed.some((entry) => entry.id === row.effort);
      onChange({ ...row, model: id, effort: keep ? row.effort : "" });
    };

    return jsxs(
      "div",
      {
        className: "sinj-row",
        "data-dragging": drag?.dragging === true ? "true" : undefined,
        "data-over": drag?.over === true ? "true" : undefined,
        onDragOver: (event) => {
          event.preventDefault();
          onDragOver(index);
        },
        onDrop: (event) => {
          event.preventDefault();
          onDrop(index);
        },
        draggable: true,
        onDragStart: () => onDragStart(index),
        onDragEnd,
        children: [
          jsx("span", { className: "sinj-grip", title: drag?.handleTitle, "aria-hidden": "true", children: "⠿" }, "grip"),
          jsx("span", { className: "sinj-index", children: String(index + 1) }, "index"),
          jsx("div", { className: "sinj-field sinj-field-provider", children: jsx(Select, { label: "provider", value: row.provider, options: providers.map((entry) => ({ id: entry.id, label: entry.name === entry.id ? entry.id : `${entry.name} (${entry.id})` })), placeholder: "—", onChange: onProvider }) }, "provider"),
          jsx(
            "div",
            {
              className: "sinj-field sinj-field-model",
              children: jsx(Select, { label: "model", value: row.model, options: modelOptions, placeholder: "—", disabled: provider === undefined, onChange: onModel }),
            },
            "model",
          ),
          jsx(
            "div",
            {
              className: "sinj-field sinj-field-effort",
              children:
                efforts === null || model === undefined
                  ? jsx("span", { className: "sinj-none", children: "—" })
                  : jsx(Select, {
                      label: "reasoning effort",
                      value: row.effort,
                      options: efforts.map((entry) => ({ id: entry.id, label: entry.label === entry.id ? entry.id : `${entry.label} (${entry.id})` })),
                      placeholder: "",
                      onChange: (value) => onChange({ ...row, effort: value }),
                    }),
            },
            "effort",
          ),
          jsx(Button, { variant: "ghost", onClick: () => onChange(null), children: "✕" }, "remove"),
        ],
      },
      row.key,
    );
  }

  /**
   * Whether the editor holds edits that differ from the snapshot it was seeded
   * from. A missing snapshot (the first read of a session) is not an edit: the
   * stored document is authoritative then, so the editor adopts it.
   */
  function isDirty(draft, snapshot) {
    if (snapshot === undefined) return true;
    return !sameDraft(draft, snapshot);
  }

  /** Field-by-field comparison of two editor states. */
  function sameDraft(draft, snapshot) {
    if (draft.enabled !== snapshot.enabled || draft.fork !== snapshot.fork) return false;
    if (draft.rows.length !== snapshot.rows.length) return false;
    return draft.rows.every((row, at) => {
      const other = snapshot.rows[at];
      return row.provider === other.provider && row.model === other.model && (row.effort ?? "") === (other.effort ?? "");
    });
  }

  /**
   * The settings page contributed to the Plugins section.
   *
   * It is a page, not a popover: the shell's tab panel owns the placement,
   * scroll and dismissal, so this component only draws the form.
   * @param props - slot kit props plus this plugin's locale `t`.
   */
  function SubagentInjectionSettings({ t: translate, remote }) {
    // The slot owner hands the locale hook over as a prop; fall back to the
    // bound namespace hook so a page can never fail to draw its own copy.
    const t = typeof translate === "function" ? translate : boundT;
    // A page that cannot reach its remote is the one failure the first render
    // cannot recover from by reading again, so it is reported where it happens
    // instead of surfacing later as a read that never settles.
    const remoteOk = isRecord(remote) && isRecord(remote.settings) && typeof remote.settings.describe === "function";
    const [state, setState] = react.useState(
      remoteOk
        ? { status: "loading" }
        : { status: "ready", catalog: { providers: [], byProvider: new Map() }, writable: false, failure: t("noRemote") },
    );
    const [draft, setDraft] = react.useState({ enabled: true, fork: true, rows: [] });
    const [revision, setRevision] = react.useState(undefined);
    const [note, setNote] = react.useState(undefined);
    const [saving, setSaving] = react.useState(false);
    const [dragIndex, setDragIndex] = react.useState(undefined);
    const [overIndex, setOverIndex] = react.useState(undefined);
    // Latest draft, so a re-read can tell whether the editor holds edits that a
    // re-sync would silently discard.
    const draftRef = react.useRef(draft);
    draftRef.current = draft;
    // The snapshot the editor was last seeded from. A committed write makes the
    // draft the new baseline.
    const storedRef = react.useRef(undefined);
    // The remote is read through a ref so `load` keeps one identity: the slot
    // owner may hand a fresh props object on every render, and an effect keyed
    // on a changing `load` would re-read — and re-sync — the document each time.
    const remoteRef = react.useRef(remote);
    remoteRef.current = remote;
    // The revision a write must send is the latest one the document returned.
    // It is published at the read (below), never at render time, so a render
    // that still carries the previous state cannot overwrite a newer value with
    // a stale one.
    const revisionRef = react.useRef(undefined);
    const loadedForRef = react.useRef(undefined);
    // A timeline of the last read, reported while the page is not settled.
    const timelineRef = react.useRef([]);

    /**
     * Read the document. `resync` adopts what is stored in the editor; a refused
     * write re-reads with `resync: false` so the revision catches up without
     * discarding the edits the user is about to retry.
     */
    const load = react.useCallback(async (resync = true) => {
      setState({ status: "loading" });
      const started = Date.now();
      const timeline = [];
      timelineRef.current = timeline;
      const step = (label) => timeline.push(`${label}:${Date.now() - started}ms`);
      // The document is the page's own state and is read first: a registry that
      // cannot be projected must not hide the stored routes.
      let described;
      try {
        step("describe:start");
        described = unwrap(await withTimeout(remoteRef.current.settings.describe(), "settings.describe"), "settings.describe");
        step("describe:ok");
      } catch (error) {
        step(`describe:fail`);
        const message = error instanceof Error ? error.message : String(error);
        setState({
          status: "failed",
          message,
          failure: `${t("loadFailed")}: ${message}`,
        });
        return;
      }
      // The model catalog is a separate read, and a failure there is reported
      // beside a page that still works.
      let catalog;
      try {
        catalog = await loadCatalog(remoteRef.current.session);
        step(`catalog:${catalog.providers.length}`);
      } catch (error) {
        catalog = { providers: [], byProvider: new Map(), failed: error instanceof Error ? error.message : String(error) };
        step("catalog:fail");
      }
      const ownDescriptor = descriptorOf(described, SETTINGS_NS);
      const hasDocument = ownDescriptor !== undefined;
      // Settings refuses a write it cannot apply, so the page never pretends a
      // switch will be kept: without the document there is nothing to revise.
      const writable = described?.writable !== false && hasDocument;
      // What a row currently on screen cannot say: a blank row would be dropped
      // by the Host, and a model that advertises no effort cannot carry one.
      let readError;
      if (!hasDocument) readError = `${t("noDocument")} [ns: ${namespaceNames(described).join(", ")}]`;
      else if (typeof catalog.failed === "string") readError = `${t("catalogFailed")}: ${catalog.failed}`;
      else if (draftRef.current.rows.some((row) => row.provider === "" || row.model === "")) readError = t("incompleteRow");
      else if (draftRef.current.rows.some((row) => row.effort !== "" && !modelEfforts(catalog, row.provider, row.model).some((effort) => effort.id === row.effort))) readError = t("effortUnavailable");
      step(hasDocument ? "document:ok" : "document:missing");
      const value = isRecord(ownDescriptor?.value) ? ownDescriptor.value : {};
      const stored = { enabled: value.enabled !== false, fork: value.fork !== false, rows: rowsFromValue(value) };
      // With `resync` the document wins, but edits made before the first read
      // of a session are kept and reported instead of silently dropped.
      const lost = resync && isDirty(draftRef.current, storedRef.current) && !sameDraft(draftRef.current, stored);
      if (lost) setDraft(stored);
      if (resync || storedRef.current === undefined) storedRef.current = stored;
      // Publish the revision where it is received, not at the next render: a
      // click already queued in the browser would otherwise save against the
      // revision the previous read returned and be refused for no reason.
      revisionRef.current = ownDescriptor?.revision;
      setRevision(ownDescriptor?.revision);
      setState({
        status: "ready",
        catalog,
        writable,
        ...(readError === undefined ? {} : { failure: readError }),
        ...(lost ? { pending: true } : {}),
      });
    }, []);

    react.useEffect(() => {
      const changed = loadedForRef.current !== remote;
      loadedForRef.current = remote;
      if (changed || storedRef.current === undefined) void load();
    }, [load, remote]);

    const save = react.useCallback(async () => {
      const routes = routesFromRows(draft.rows, state.catalog);
      if (routes === null) {
        setNote({ kind: "error", text: t("incompleteRow") });
        return;
      }
      setSaving(true);
      setNote(undefined);
      let next;
      let committed = false;
      const patch = { enabled: draft.enabled, fork: draft.fork, routes };
      try {
        await unwrap(await remoteRef.current.settings.update(SETTINGS_NS, patch, revisionRef.current), "settings.update");
        next = { kind: "saved", text: t("saved") };
        committed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        next = { kind: "error", text: `${t("saveFailed")}: ${message}` };
      }
      if (committed) storedRef.current = { enabled: patch.enabled, fork: patch.fork, rows: draft.rows.map((row) => ({ ...row })) };
      // Re-read first so the next attempt carries the current revision, then
      // report: `load()` clears the note, so the outcome is set after it or the
      // confirmation would never be seen.
      try {
        await load(committed);
      } finally {
        setNote(next);
        setSaving(false);
      }
    }, [draft, load, state.catalog, t]);

    const catalog = state.catalog ?? { providers: [], byProvider: new Map() };
    const writable = state.status === "ready" && state.writable !== false;
    // A write or a re-read is in flight: editing now would race the revision the
    // next save sends, so every input is held until the page settles.
    const busy = saving || state.status === "loading";
    const readOnly = !writable || busy;

    const reorder = (from, to) => {
      if (from === undefined || to === undefined || from === to) return;
      setDraft((current) => {
        const rows = [...current.rows];
        const [moved] = rows.splice(from, 1);
        rows.splice(to, 0, moved);
        return { ...current, rows };
      });
    };

    const body = [];
    if (state.status === "loading") body.push(jsx("div", { className: "sinj-busy", children: t("loading") }, "loading"));
    // Whatever went wrong is said once, in the same place, so a page that cannot
    // read its document never looks merely quiet: an unread namespace, a
    // registry that cannot be projected, and a write that cannot land are all
    // one kind of fact for the reader.
    if (state.failure !== undefined) {
      body.push(jsx("div", { className: "sinj-note", "data-error": "true", children: state.failure }, "failure"));
    }
    if (state.status === "ready" && state.failure === undefined && catalog.providers.length === 0) {
      body.push(jsx("div", { className: "sinj-note", children: t("catalogEmpty") }, "catalog-empty"));
    }
    if (state.status === "ready" && state.pending === true) body.push(jsx("div", { className: "sinj-note", "data-pending": "true", children: t("pendingEdit") }, "pending"));
    if (state.status === "ready") {
      body.push(
        jsxs(
          "div",
          {
            className: "sinj-switches",
            children: [
              jsx(Checkbox, { label: t("enabled"), checked: draft.enabled, disabled: readOnly, onChange: (checked) => setDraft((current) => ({ ...current, enabled: checked })) }, "enabled"),
              jsx("div", { className: "sinj-switch-hint", children: t("enabledHint") }, "enabled-hint"),
              jsx(Checkbox, { label: t("fork"), checked: draft.fork, disabled: readOnly, onChange: (checked) => setDraft((current) => ({ ...current, fork: checked })) }, "fork"),
              jsx("div", { className: "sinj-switch-hint", children: t("forkHint") }, "fork-hint"),
            ],
          },
          "switches",
        ),
      );
      if (draft.rows.length === 0) {
        body.push(jsxs("div", { className: "sinj-empty", children: [jsx("div", { children: t("empty") }, "a"), jsx("div", { children: t("emptyHint") }, "b")] }, "empty"));
      } else {
        body.push(jsx("div", { className: "sinj-label", children: t("priority") }, "list-label"));
        body.push(
          jsx(
            "div",
            {
              className: "sinj-list",
              children: draft.rows.map((row, index) =>
                jsx(
                  RouteRow,
                  {
                    row,
                    index,
                    providers: catalog.providers,
                    byProvider: catalog.byProvider,
                    drag: { dragging: dragIndex === index, over: overIndex === index, handleTitle: t("dragHandle") },
                    onDragStart: setDragIndex,
                    onDragOver: setOverIndex,
                    onDrop: (to) => {
                      reorder(dragIndex, to);
                      setDragIndex(undefined);
                      setOverIndex(undefined);
                    },
                    onDragEnd: () => {
                      setDragIndex(undefined);
                      setOverIndex(undefined);
                    },
                    onChange: (next) =>
                      setDraft((current) => {
                        const rows = [...current.rows];
                        if (next === null) rows.splice(index, 1);
                        else rows[index] = { ...next, key: row.key };
                        return { ...current, rows };
                      }),
                  },
                  row.key,
                ),
              ),
            },
            "list",
          ),
        );
      }
    }
    // The controls stay reachable while a read has failed — a page that offers
    // nothing to click cannot be recovered from — but a write needs the revision
    // only a successful read can supply, so only the write is refused.
    body.push(
      jsxs(
        "div",
        {
          className: "sinj-actions",
          children: [
            jsx(Button, { variant: "outline", disabled: readOnly, onClick: () => setDraft((current) => ({ ...current, rows: [...current.rows, { key: `r${Date.now()}`, provider: catalog.providers[0]?.id ?? "", model: catalog.providers[0]?.models[0]?.id ?? "", effort: "" }] })), children: t("add") }, "add"),
            jsxs(
              "div",
              {
                className: "sinj-actions-right",
                children: [
                  note === undefined ? null : jsx("span", { className: "sinj-note", "data-error": note.kind === "error" ? "true" : undefined, children: note.text }, "note"),
                  jsx(Button, { variant: "ghost", disabled: state.status === "loading", onClick: () => void load(), children: t("reload") }, "reload"),
                  jsx(Button, { variant: "primary", disabled: busy || !writable, onClick: save, children: busy ? t("saving") : t("save") }, "save"),
                ],
              },
              "right",
            ),
          ],
        },
        "actions",
      ),
    );
    // The read timeline, shown only while a read is still in flight, so a read
    // that never settles can be told from one that was never attempted.
    if (state.status === "loading" && timelineRef.current.length > 0) {
      body.push(jsx("div", { className: "sinj-debug", "data-debug": "true", children: timelineRef.current.join(" · ") }, "timeline"));
    }

    return jsxs(
      "div",
      {
        className: "sinj-root",
        "data-dsh-subagent-injection": "page",
        children: [
          jsx("h2", { className: "sinj-head", children: t("title") }, "head"),
          jsx("p", { className: "sinj-sub", children: t("subtitle") }, "sub"),
          ...body,
        ],
      },
      "page",
    );
  }

  /** Required client services. */
  const inject = ["slots", "locale", "remote", "remote.settings", "remote.session"];

  /**
   * Client plugin body.
   *
   * The plugin contributes one page to the Plugins settings section and nothing
   * else: it renders no title-bar control, so there is exactly one 子智能体
   * surface in the shell and it lives where the user asked for it.
   * @param ctx - client root context.
   */
  function apply(ctx) {
    installStyles();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "subagent-injection: dictionaries");
    const remote = { settings: ctx.remote.settings, session: ctx.remote.session };
    // Read once, outside the injected props factory: the tab label is projected
    // on every render, and a thunk keeps following the active locale.
    const t = ctx.locale.bind(NS);
    boundT = t;
    ctx.slots.inject("settings.plugins.tab", () =>
      ctx.slots.register(
        {
          name: "settings.plugins.tab",
          id: "dsh-subagent-injection",
          // Between the shipped inventory page (10) and the market page (60):
          // a feature page belongs after "all", before storefront tabs.
          order: 40,
          label: () => t("title"),
          locale: NS,
          inject: () => ({ t, remote }),
        },
        SubagentInjectionSettings,
      ),
    );
  }

  exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
