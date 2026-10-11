/**
 * Checks for the client half: does the bundle register itself the way the GUI
 * module loader expects, does it contribute one page to the Plugins settings
 * section, and does that page really produce the settings patch it claims to?
 *
 * The bundle runs in the same shape the browser gives it — a global
 * `__ModuleLoader__.load({id, factory})` call — with a small React stand-in that
 * re-renders synchronously, so no build step or browser is needed.
 *
 *   node tools/test-client.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ------------------------------------------------------------------ *
 * A tiny React stand-in: refs, state and effects, re-rendered by hand.
 * ------------------------------------------------------------------ */

/** Hook slots for the component currently being rendered. */
let slots = [];
let cursor = 0;
let renders = 0;
/**
 * Compiler-emitted component functions are plain functions, so a component that
 * renders another one (the page's own sub-components) would otherwise
 * consume the parent's hook slots. React keys storage to the component, so each
 * function gets its own slot array and a nested render saves and restores the
 * caller's.
 */
let storageId = 0;
const storageStack = [];
const storageByComponent = new Map();

/** Render one function component with its own hook storage. */
function renderInstance(Component, props) {
  let id = storageByComponent.get(Component);
  if (id === undefined) {
    storageId += 1;
    id = storageId;
    storageByComponent.set(Component, id);
  }
  storageStack.push([cursor, slots]);
  if (!storageByComponent.has(`slots:${id}`)) storageByComponent.set(`slots:${id}`, []);
  slots = storageByComponent.get(`slots:${id}`);
  cursor = 0;
  try {
    return Component(props);
  } finally {
    [cursor, slots] = storageStack.pop();
  }
}

const react = {
  useState(initial) {
    const index = cursor++;
    if (slots[index] === undefined) slots[index] = { value: typeof initial === "function" ? initial() : initial };
    const slot = slots[index];
    // Reading the slot consumes its pending update, exactly as React does: the
    // value just rendered is the one the caller sees, so the drain below can
    // trust the flag to mean "an update is still waiting for a render".
    slot.dirty = false;
    return [
      slot.value,
      (next) => {
        slot.value = typeof next === "function" ? next(slot.value) : next;
        slot.dirty = true;
      },
    ];
  },
  useRef(initial) {
    const index = cursor++;
    if (slots[index] === undefined) slots[index] = { value: { current: initial } };
    return slots[index].value;
  },
  useCallback(fn, deps) {
    const index = cursor++;
    const list = deps ?? [];
    const previous = slots[index];
    const changed = previous === undefined || list.length !== previous.deps.length || list.some((value, at) => !Object.is(value, previous.deps[at]));
    if (changed) slots[index] = { value: fn, deps: [...list] };
    return slots[index].value;
  },
  useEffect(fn, deps) {
    const index = cursor++;
    const list = deps ?? null;
    const previous = slots[index];
    const changed =
      previous === undefined ||
      list === null ||
      previous.deps === null ||
      list.length !== previous.deps.length ||
      list.some((value, at) => !Object.is(value, previous.deps[at]));
    if (!changed) return;
    slots[index] = { ran: true, deps: list === null ? null : [...list] };
    fn();
  },
  forwardRef(render) {
    // The stub atom's `render` already produces a finished element; the wrapper
    // only marks the component so `walk` expands it instead of stopping there.
    const wrapped = (props) => render(props, props.ref ?? null);
    wrapped.__forwardRef = true;
    return wrapped;
  },
};

/** Build a tree node the way `react/jsx-runtime` does. */
const element = (type, props, key) => ({ type, props: props ?? {}, key: key ?? null });

/** Flatten a rendered tree into the elements it contains. */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== "object" || node.type === undefined) return;
  // A component is transparent: render it and keep walking. The stub atoms are
  // forwardRef wrappers (they carry a `ref` prop when the bundle passes one, or
  // a `variant`), while the bundle's own `Panel` is a plain function.
  if (typeof node.type === "function") {
    const isAtom = node.props.ref !== undefined || node.props.variant !== undefined || node.props._atom !== undefined;
    if (isAtom || node.type.length <= 1) {
      walk(renderInstance(node.type, node.props), visit);
      return;
    }
  }
  visit(node);
  walk(node.props?.children, visit);
}

/* ------------------------------------------------------------------ *
 * Browser stand-ins.
 * ------------------------------------------------------------------ */

const moduleLoaderRegistrations = [];
const styleTags = [];
globalThis.window = {
  innerWidth: 1280,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: { load: (registration) => moduleLoaderRegistrations.push(registration) },
};
globalThis.innerWidth = 1280;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
  querySelector: (selector) => (styleTags.some((tag) => tag.selector === selector) ? styleTags[0] : null),
  createElement: (tag) => ({ tagName: tag, dataset: {}, textContent: "" }),
  head: {
    append(node) {
      styleTags.push({ selector: "style[data-dsh-subagent-injection]", node });
    },
  },
  addEventListener() {},
  removeEventListener() {},
};

/* ------------------------------------------------------------------ *
 * Load the bundle exactly as the browser does.
 * ------------------------------------------------------------------ */

const source = readFileSync(new URL("../plugin/lib/client.js", import.meta.url), "utf8");
/** The stub atom table, shared by every `require` call the bundle makes. */
const atomStubs = {
  // The real atoms render a `<button>`; the stand-in keeps a stable tag and an
  // `_atom` marker so the assertions can find them by element type.
  Button: (props, ref) => element("button", { ...props, ref, _atom: "Button" }, props._key),
  Checkbox: (props) => element("checkbox", { ...props, _atom: "Checkbox" }, props._key),
};

const requireShim = (specifier) => {
  if (specifier === "react") return react;
  if (specifier === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
  if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return atomStubs;
  throw new Error(`unexpected require("${specifier}")`);
};
new Function("window", "document", "require", source)(globalThis.window, globalThis.document, requireShim);

assert.equal(moduleLoaderRegistrations.length, 1, "the bundle must register exactly one module");
const registration = moduleLoaderRegistrations[0];
assert.equal(registration.id, "dsh-subagent-injection", "the module id is the package name");
assert.equal(typeof registration.factory, "function");
const bundle = registration.factory(requireShim);
assert.equal(typeof bundle.apply, "function", "the factory must export apply");
assert.deepEqual(bundle.inject, ["slots", "locale", "remote", "remote.settings", "remote.session"]);
assert.equal(styleTags.length, 0, "styles must not be installed before apply()");

/* ------------------------------------------------------------------ *
 * Mount it into a fake client context.
 * ------------------------------------------------------------------ */

const registrations = [];
const localeRegistrations = [];
const remoteCalls = [];
/** When set, the next `settings.update` call rejects with this message. */
let updateFailure = undefined;
const settingsDocument = {
  writable: true,
  namespaces: [
    {
      ns: "subagent-injection",
      revision: 7,
      value: { enabled: true, fork: false, routes: [{ provider: "pioneer", model: "gpt-6-luna", effort: "high" }] },
    },
  ],
};
// The browser model catalog: the shipped `session/modelCatalog` projection of the
// Host's LLM registry. The effort levels a model offers come from here and only
// from here, so the page can never offer an effort its adapter rejects.
const catalogPayload = {
  default: { provider: "pioneer", model: "gpt-6-luna" },
  routableProviders: ["pioneer", "anthropic", "legacy"],
  groups: [
    {
      id: "pioneer",
      name: "Pioneer",
      models: [
        {
          id: "gpt-6-luna",
          name: "Luna",
          reasoning: {
            efforts: [
              { id: "minimal", name: "Minimal" },
              { id: "low", name: "Low" },
              { id: "medium", name: "Medium" },
              { id: "high", name: "High" },
            ],
            defaultEffort: "medium",
          },
        },
        { id: "deepseek-v4.1-flash", name: "Flash" },
      ],
    },
    // No `reasoning` at all: the adapter advertises no effort for this model, so
    // the row must not show an effort selector.
    { id: "anthropic", name: "Anthropic", models: [{ id: "claude-sonnet-5-5", name: "Sonnet" }] },
    {
      id: "legacy",
      name: "Legacy",
      models: [{ id: "mystery", name: "Mystery", reasoning: { efforts: [{ id: "low", name: "Low" }] } }],
    },
  ],
  failures: [],
};
// The slot kit hands a fresh props object on every render, so the test's
// `inject` must do the same for its own props to model a real re-render; the
// `remote` it carries is the service and keeps its identity.
// The remote layer answers every call with an outcome envelope — `{ok, value}`
// or `{ok: false, error}` — so the stand-in must too: reading an envelope as if
// it were the payload is exactly the bug these stubs exist to catch.
const settingsRemote = {
  describe: async () => {
    remoteCalls.push({ method: "describe" });
    return { ok: true, value: settingsDocument };
  },
  update: async (ns, patch, revision) => {
    if (updateFailure !== undefined) {
      const message = updateFailure;
      updateFailure = undefined;
      remoteCalls.push({ method: "update", ns, patch, revision, failed: true });
      return { ok: false, error: { message } };
    }
    remoteCalls.push({ method: "update", ns, patch, revision });
    // A committed write advances the document, like the real controller does.
    const target = settingsDocument.namespaces.find((entry) => entry.ns === ns);
    if (target !== undefined) {
      target.value = patch;
      target.revision += 1;
      return { ok: true, value: { ns, revision: target.revision } };
    }
    return { ok: false, error: { message: `No configurable plugin entry "${ns}"` } };
  },
};
/** When set, the next `session.modelCatalog` call rejects with this message. */
let catalogFailure = undefined;
const sessionRemote = {
  modelCatalog: async () => {
    remoteCalls.push({ method: "modelCatalog" });
    if (catalogFailure !== undefined) {
      const message = catalogFailure;
      catalogFailure = undefined;
      throw new Error(message);
    }
    return { ok: true, value: catalogPayload };
  },
};
const ctx = {
  effect: (fn) => fn(),
  locale: {
    register: (ns, dictionaries) => localeRegistrations.push({ ns, dictionaries }),
    // The real `bind(ns)` returns a copy function for that namespace; the stub
    // resolves against whatever the plugin registered, and `t` below reuses it.
    bind: (ns) => (key) => localeRegistrations.find((entry) => entry.ns === ns)?.dictionaries.zh[key] ?? key,
  },
  remote: { settings: settingsRemote, session: sessionRemote },
  slots: {
    inject: (name, install) => registrations.push({ name, install }),
    register: (spec, Component) => registrations.push({ name: spec.name, spec, Component }),
  },
};

bundle.apply(ctx);

assert.equal(registrations.length, 1, "the page is offered to exactly one settings slot");
assert.deepEqual(
  registrations.map((entry) => entry.name),
  ["settings.plugins.tab"],
  "the page lives in the Plugins settings section, beside the shipped inventory page",
);
assert.equal(styleTags.length, 1, "apply() installs the stylesheet once");
const dictionaries = localeRegistrations.find((entry) => entry?.ns === "subagent-injection");
assert.ok(dictionaries, "the plugin registers its dictionaries");
// The tab label must not read as the shipped Subagent settings page: both live
// in the same Plugins section, so an identical label makes this page look absent.
assert.equal(dictionaries.dictionaries.zh.title, "子智能体注入");
assert.equal(dictionaries.dictionaries.en.title, "Subagent injection");

// `slots.inject` defers registration until the slot is rendered; doing that is
// what produces the settings-page row.
for (const entry of [...registrations]) {
  assert.equal(typeof entry.install, "function", "the page is registered through slots.inject");
  entry.install();
}
assert.equal(registrations.length, 2, "one injection registers one page");
const row = registrations[1];
assert.equal(row.name, "settings.plugins.tab");

// The slot contract: `inject` is a factory that hands the component its
// services, and `label` is re-read on every projection so the tab follows the
// active locale.
const spec = row.spec;
assert.equal(typeof spec.inject, "function");
assert.equal(typeof spec.label, "function", "the tab label is a thunk, so localization follows the locale");
assert.equal(spec.id, "dsh-subagent-injection");
assert.equal(spec.order, 40, "the page sorts after the shipped inventory tab (10) and before the market tab (60)");
assert.equal(spec.locale, "subagent-injection");
const shared = spec.inject("session-1");
assert.ok(shared.remote, "the slot inject must hand the component the settings remote");
const Component = row.Component;
assert.equal(typeof Component, "function");

/* ------------------------------------------------------------------ *
 * Render the page and let it load.
 * ------------------------------------------------------------------ */

const t = (key) => dictionaries.dictionaries.zh[key] ?? key;
/** Render the mounted page again; hook slots persist, like a real re-render. */
const renderOnce = () => {
  renders += 1;
  const nodes = [];

  walk(renderInstance(Component, { t, ...shared }), (node) => nodes.push(node));
  return nodes;
};
const find = (nodes, type, predicate) => nodes.find((node) => node.type === type && (predicate === undefined || predicate(node)));
const findAll = (nodes, type) => nodes.filter((node) => node.type === type);

let tree = renderOnce();
assert.ok(
  find(tree, "div", (node) => node.props.className === "sinj-root"),
  "the page renders its own root, with no anchoring, floating layer or dismissal of its own",
);
assert.equal(find(tree, "div", (node) => node.props.role === "dialog"), undefined, "the page is a page: the slot owner's tab panel owns dismissal");
assert.equal(findAll(tree, "button").length, 3, "the page draws no title-bar control: its only buttons are add, reload and save");
const installedCss = styleTags[0].node.textContent;
assert.equal(installedCss.includes("position:fixed"), false, "the page does not float: the settings panel places it");
assert.equal(
  installedCss.includes(".sinj-root{") && installedCss.includes("max-width:760px"),
  true,
  "the page borrows the shell's own settings-section width",
);
assert.equal(
  installedCss.includes("--dsw-alias-label-tertiary"),
  true,
  "the page borrows the shell's own label tokens so it matches the surrounding settings UI",
);

/** Let queued promise callbacks run and re-render until no state slot is dirty. */
/** True while a resolved promise still has continuations waiting to run. */
function storageDirty() {
  for (const list of storageByComponent.values()) {
    if (!Array.isArray(list)) continue;
    if (list.some((slot) => slot?.dirty === true)) return true;
  }
  return false;
}

/**
 * Nothing to clear between rounds: `useState` clears each slot's flag as it
 * reads it, so a flag that is still set means a render has not caught up with
 * that update yet. Clearing them here instead would let the drain below declare
 * the page settled while its own async tail was still running.
 */
function clearDirty() {}

/**
 * Let queued promise callbacks run until the page has nothing left to do, then
 * render its settled state. A `save()` has an async tail (a write, then a
 * re-read, then the note), so draining has to continue until a whole round adds
 * neither state nor remote work — and the returned tree must come from a final
 * render, not from the round that happened to observe the queue going quiet.
 */
/**
 * Let queued promise callbacks run until the page has nothing left to do, then
 * render its settled state. A `save()` has an async tail (a write, then a
 * re-read, then the note), so the drain keeps its own promise chain alive until
 * a whole round adds neither state nor remote work, and the returned tree comes
 * from a render of that settled state rather than from the observation round.
 */
async function settle(label) {
  let stable = 0;
  for (let round = 0; round < 400; round += 1) {
    renderOnce();
    clearDirty();
    const before = remoteCalls.length;
    // Eight `await`s drain the microtask queue; the macrotask hop makes sure a
    // promise resolved by that drain (including the remote stubs' own callbacks)
    // gets its continuation run before the next observation.
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    stable = remoteCalls.length === before && !storageDirty() ? stable + 1 : 0;
    if (stable >= 3) return renderOnce();
  }
  throw new Error(`settle("${label}") did not quiesce`);
}

tree = await settle("load");
assert.ok(remoteCalls.some((call) => call.method === "describe"), "rendering the page reads the settings document");

const checkbox = findAll(tree, "checkbox");
assert.equal(checkbox.length, 2, "the page renders the two switches");
assert.equal(checkbox[0].props.checked, true, "启用调度 reflects the stored value");
assert.equal(checkbox[1].props.checked, false, "允许 subagent_fork reflects the stored value");
assert.equal(checkbox[1].props.label, "允许 subagent_fork");

let selects = findAll(tree, "select");
assert.equal(selects.length, 3, "one stored route renders provider, model and effort selectors");
assert.deepEqual(selects[0].props.value, "pioneer");
assert.deepEqual(selects[1].props.value, "gpt-6-luna");
assert.deepEqual(selects[2].props.value, "high");

// Provider options come from the catalog; the useless "legacy" provider is
// still listed (it is a real provider), while a model whose adapter advertises
// no reasoning metadata offers no effort list at all.
const providerOptions = selects[0].props.children.filter((node) => node.type === "option").map((node) => node.props.value);
assert.deepEqual(providerOptions, ["", "pioneer", "anthropic", "legacy"]);
const effortOptions = selects[2].props.children.filter((node) => node.type === "option").map((node) => node.props.value);
assert.deepEqual(effortOptions, ["", "minimal", "low", "medium", "high"], "only the efforts the live registry advertises are offered");

/* ------------------------------------------------------------------ *
 * Edit, reorder, and save.
 * ------------------------------------------------------------------ */

// Add a second route, then point it at the anthropic provider whose model has no
// advertised reasoning metadata: the effort selector must disappear.
const addButton = findAll(tree, "button").find((node) => node.props.children === "添加路由");
assert.ok(addButton, "the page offers 添加路由");
cursor = 0;
addButton.props.onClick();
tree = await settle("add");
selects = findAll(tree, "select");
assert.equal(selects.length, 6, "the added route renders its own three selectors");
assert.equal(selects[3].props.value, "pioneer", "a new route starts on the first catalog provider");

cursor = 0;
selects[3].props.onChange({ target: { value: "anthropic" } });
tree = await settle("provider");
selects = findAll(tree, "select");
assert.equal(selects[3].props.value, "anthropic");
assert.equal(selects[4].props.value, "claude-sonnet-5-5", "picking a provider picks its first model");
assert.equal(selects.length, 5, "a model with no advertised reasoning metadata shows no effort selector");

// Drag the second route above the first: dragstart on row 2, dragover on row 1,
// drop on row 1.
const event = { preventDefault() {} };
const rowsOf = (nodes) => nodes.filter((node) => node.type === "div" && node.props.className === "sinj-row");
let rows = rowsOf(tree);
assert.equal(rows.length, 2);
cursor = 0;
rows[1].props.onDragStart();
tree = await settle("dragstart");
rows = rowsOf(tree);
assert.equal(rows[1].props["data-dragging"], "true", "the dragged row is marked");
cursor = 0;
rows[0].props.onDragOver(event);
tree = await settle("dragover");
rows = rowsOf(tree);
assert.equal(rows[0].props["data-over"], "true", "the hovered row is marked");
cursor = 0;
rows[0].props.onDrop(event);
tree = await settle("drop");
/** The select values of each route row, in document order. */
const rowSelects = (nodes) => {
  const list = [];
  let current = -1;
  for (const node of nodes) {
    if (node.type === "div" && node.props.className === "sinj-row") {
      list.push([]);
      current += 1;
    } else if (node.type === "select" && current >= 0) {
      list[current].push(node.props.value);
    }
  }
  return list;
};
assert.deepEqual(
  rowSelects(tree),
  [["anthropic", "claude-sonnet-5-5"], ["pioneer", "gpt-6-luna", "high"]],
  "the dropped route now has the higher priority",
);

// Flip the fork switch off -> on, then save.
const switches = findAll(tree, "checkbox");
cursor = 0;
switches[1].props.onChange(true);
tree = await settle("fork");
assert.equal(findAll(tree, "checkbox")[1].props.checked, true);

const saveButton = findAll(tree, "button").find((node) => node.props.children === "保存");
assert.ok(saveButton, "the page offers 保存");

// A stale revision must surface as an error note instead of a silent loss, and
// the very next save must go through with the revision it just re-read.
const expectedPatch = {
  enabled: true,
  fork: true,
  routes: [
    { provider: "anthropic", model: "claude-sonnet-5-5" },
    { provider: "pioneer", model: "gpt-6-luna", effort: "high" },
  ],
};
updateFailure = 'settings namespace "subagent-injection" changed since it was read (expected revision 7, now 9)';
cursor = 0;
saveButton.props.onClick();
tree = await settle("save");

const rejected = remoteCalls.find((call) => call.method === "update");
assert.ok(rejected, "saving writes through the settings remote");
assert.equal(rejected.failed, true);
assert.equal(rejected.ns, "subagent-injection");
assert.equal(rejected.revision, 7, "the write carries the revision it read");
assert.deepEqual(rejected.patch, expectedPatch);
const errorNote = findAll(tree, "span").find((node) => node.props["data-error"] !== undefined);
assert.ok(errorNote, "a refused write is reported on the page");
assert.equal(errorNote.props.children.startsWith("保存失败: "), true);
assert.equal(errorNote.props.children.includes("changed since it was read"), true);
assert.deepEqual(
  settingsDocument.namespaces.find((entry) => entry.ns === "subagent-injection").value,
  { enabled: true, fork: false, routes: [{ provider: "pioneer", model: "gpt-6-luna", effort: "high" }] },
  "a refused write leaves the stored document untouched",
);
assert.equal(remoteCalls.filter((call) => call.method === "describe").length >= 2, true, "saving re-reads the document");

// A user clicks the button the page is showing now, not the one it showed
// before the refused write re-rendered it.
tree = renderOnce();
const retryButton = findAll(tree, "button").find((node) => node.props.children === "保存");
assert.equal(retryButton.props.disabled, false, "the page re-enables saving after a refusal");
const before = remoteCalls.length;
cursor = 0;
retryButton.props.onClick();
tree = await settle("retry");
const accepted = remoteCalls.slice(before).find((call) => call.method === "update");
assert.ok(accepted, "the retry writes again");
assert.equal(accepted.failed, undefined, "the retry is not refused");
assert.deepEqual(accepted.patch, expectedPatch, "the retry keeps the edits the refused write carried");
// The refused write's re-read reported revision 7, so the retry sends 7 — the
// revision the page last read — and the stub accepts it and advances to 8.
assert.equal(accepted.revision, 7, "the retry sends the revision its re-read returned");
const savedNote = findAll(tree, "span").find((node) => node.props.className === "sinj-note");
assert.ok(savedNote, "the page reports the accepted write");
assert.equal(savedNote.props.children, "已保存");
assert.equal(savedNote.props["data-error"], undefined, "the error styling is gone once the write succeeds");

/* ------------------------------------------------------------------ *
 * An effort the chosen model does not advertise.
 * ------------------------------------------------------------------ */

// A row keeps the effort picked for the model before it, and a stored document
// written by an older version can carry one too. The Host forwards whatever it
// is given, so an unadvertised effort fails that route's preflight on every
// call; the write drops it and lets the model's own default apply.
settingsDocument.namespaces.push({
  ns: "subagent-injection",
  revision: 11,
  value: {
    enabled: true,
    fork: true,
    routes: [
      { provider: "anthropic", model: "claude-sonnet-5-5", effort: "max" },
      { provider: "pioneer", model: "gpt-6-luna", effort: "high" },
    ],
  },
});
tree = await settle("effort normalization");
const saveStale = findAll(tree, "button").find((node) => node.props.children === "保存");
assert.equal(saveStale.props.disabled, false, "a stale effort does not block saving");
const staleBefore = remoteCalls.length;
cursor = 0;
saveStale.props.onClick();
tree = await settle("effort normalization save");
const staleWrite = remoteCalls.slice(staleBefore).find((call) => call.method === "update");
assert.ok(staleWrite, "the normalized routes are written");
assert.deepEqual(
  staleWrite.patch.routes,
  [{ provider: "anthropic", model: "claude-sonnet-5-5" }, { provider: "pioneer", model: "gpt-6-luna", effort: "high" }],
  "an effort the model does not advertise is dropped, a supported one is kept",
);
settingsDocument.namespaces = settingsDocument.namespaces.filter((entry) => entry.revision !== 11 && entry.revision !== 12);
settingsDocument.namespaces[0].value = { enabled: true, fork: false, routes: [{ provider: "pioneer", model: "gpt-6-luna", effort: "high" }] };
settingsDocument.namespaces[0].revision = 7;

/* ------------------------------------------------------------------ *
 * A catalog the Host cannot project.
 * ------------------------------------------------------------------ */

// The model catalog is owned by the Host's LLM registry, so it can fail while
// the settings document is fine. The stored routes must survive that: the page
// reports why the pickers are empty instead of pretending nothing is configured.
catalogFailure = "llm registry unavailable";
// Re-render first: the button a user clicks is the one the page is showing now.
tree = renderOnce();
const reloadButton = findAll(tree, "button").find((node) => node.props.children === "刷新");
assert.ok(reloadButton, "the page offers 刷新");
cursor = 0;
reloadButton.props.onClick();
tree = await settle("catalog failure");
const catalogNote = findAll(tree, "div").find((node) => typeof node.props.children === "string" && node.props.children.startsWith("读取模型目录失败: "));
assert.ok(catalogNote, "a failed catalog read is reported on the page");
assert.equal(catalogNote.props["data-error"], "true");
assert.equal(catalogNote.props.children.includes("llm registry unavailable"), true);
assert.equal(findAll(tree, "checkbox").length, 2, "the switches still render without a catalog");
assert.equal(rowSelects(tree).length, 2, "the stored routes still render without a catalog");
assert.equal(findAll(tree, "select").length, 4, "provider and model remain selectable, the unknown effort does not");
// A route still carrying a provider the empty catalog does not know keeps its
// stored value rather than being silently rewritten.
assert.deepEqual(rowSelects(tree), [["anthropic", "claude-sonnet-5-5"], ["pioneer", "gpt-6-luna"]]);

/* ------------------------------------------------------------------ *
 * The client never received the settings service.
 * ------------------------------------------------------------------ */

// This was a live defect: without `remote.settings` the page drew its heading,
// then held every control while a read that could never start stayed pending, so
// it looked greyed out and unclickable instead of saying what was wrong.
const orphaned = [];
// A fresh instance name is a fresh mount: the hook slots are keyed by component,
// so reusing the mounted one would resume the loaded page instead of starting
// this page from its first render.
const OrphanPage = (props) => Component(props);
cursor = 0;
walk(
  renderInstance(OrphanPage, {
    t,
    remote: { settings: undefined, session: sessionRemote },
  }),
  (node) => orphaned.push(node),
);
const orphanNote = findAll(orphaned, "div").find((node) => node.props["data-error"] === "true");
assert.ok(orphanNote, "a page without the settings service says so instead of waiting");
assert.equal(orphanNote.props.children.includes("remote.settings"), true);
const orphanSave = findAll(orphaned, "button").find((node) => node.props.children === "保存");
assert.ok(orphanSave, "the page still offers its controls, so it can be recovered from");
assert.equal(orphanSave.props.disabled, true, "a write needs a revision only a successful read can supply");
assert.equal(remoteCalls.filter((call) => call.method === "describe").length >= 1, true, "no read is attempted without the service");

console.log("client: bundle shape, slot contract, render and save checks passed");
