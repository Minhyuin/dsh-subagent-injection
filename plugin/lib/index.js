/**
 * dsh-subagent-injection — Host half.
 *
 * Adds a priority list of child LLM routes (provider / model / reasoning effort)
 * for the delegation tools, and a switch that can disable `subagent_fork`.
 *
 * Both features live on the `tools/execute` waterfall: it is the only extension
 * point that observes a delegation call before its arguments reach the tool
 * body, and the only one that can retry the call against the next candidate
 * route without the caller (the main agent) knowing anything about it.
 *
 * @module dsh-subagent-injection
 */
import z from "@deepseek-ai/schemastery";

/** Namespace of this plugin's own profile entry, and the id Settings writes through. */
export const SETTINGS_NS = "subagent-injection";

/** Delegation tool that carries the optional child-route arguments. */
const SPAWN_TOOLS = new Set(["subagent"]);

/** Delegation tools that copy the parent conversation and cannot pick a route. */
const FORK_TOOLS = new Set(["subagent_fork"]);

/** Delegation tool a blocked fork call is re-dispatched as. */
const SPAWN_TOOL = "subagent";

/** Marks a delegation call that this plugin refused to run at all. */
export class SubagentRouteError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = "SubagentRouteError";
    this.attempts = attempts;
  }
}

const routeSchema = z.object({
  provider: z.string().description("LLM provider id, as declared under llm-pi-ai providers"),
  model: z.string().description("Model id inside that provider"),
  effort: z.string().description("Reasoning effort id; empty means the model default"),
});

export const Config = z.object({
  enabled: z
    .boolean()
    .default(true)
    .volatile()
    .description("Inject a child LLM route into every subagent call"),
  fork: z
    .boolean()
    .default(true)
    .volatile()
    .description("Allow subagent_fork; when off the fork tool is denied"),
  routes: z
    .array(routeSchema)
    .default([])
    .volatile()
    .description("Child LLM routes, highest priority first"),
});

/** Read the live plugin configuration, tolerating both plain and Schema values. */
function readConfig(config) {
  const read = (key, fallback) => {
    const field = config?.[key];
    if (field === undefined) return fallback;
    if (typeof field === "object" && field !== null && typeof field.get === "function") {
      const value = field.get();
      return value === undefined ? fallback : value;
    }
    return field;
  };
  const raw = read("routes", []);
  const routes = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const provider = typeof entry.provider === "string" ? entry.provider.trim() : "";
      const model = typeof entry.model === "string" ? entry.model.trim() : "";
      if (provider === "" || model === "") continue;
      const effort = typeof entry.effort === "string" ? entry.effort.trim() : "";
      routes.push(effort === "" ? { provider, model } : { provider, model, effort });
    }
  }
  return {
    enabled: read("enabled", true) !== false,
    fork: read("fork", true) !== false,
    routes,
  };
}

/** One route's title, for logs and diagnostics. */
function routeLabel(route) {
  return route.effort === undefined ? `${route.provider}/${route.model}` : `${route.provider}/${route.model}@${route.effort}`;
}

/** Whether the caller explicitly asked for a child route on this call. */
function hasRouteRequest(args) {
  return args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined;
}

/** Overlay one candidate route on a copy of the delegation arguments. */
function withRoute(args, route) {
  const next = { ...args, provider: route.provider, model: route.model };
  if (route.effort === undefined) delete next.reasoning_effort;
  else next.reasoning_effort = route.effort;
  return next;
}

/** An abort is the user's decision, never a route failure. */
function isAbort(exec, error) {
  if (exec.signal?.aborted === true) return true;
  const name = error?.name;
  return name === "AbortError" || name === "ToolAbortError" || name === "ToolTimeoutError";
}

/** Collect the HTTP status carried by a provider failure, when it has one. */
function statusOf(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status, error?.info?.status];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 100) return parsed;
  }
  return undefined;
}

/**
 * Decide whether the next candidate is worth trying.
 *
 * A failure that blames the route itself — an unreachable provider, a rejected
 * credential, a model the provider does not serve, a malformed request for that
 * model — moves down the priority list. Anything else (a bug in the tool, a
 * cancelled run) is reported as is, because another route cannot fix it and a
 * retry would only duplicate side effects.
 */
function isRouteFailure(exec, error) {
  if (isAbort(exec, error)) return false;
  const status = statusOf(error);
  if (status !== undefined) {
    return status === 400 || status === 401 || status === 403 || status === 404 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^(?:E(?:AI|CONN|NET|HOST|NOENT|ACCES|CERT)|UND_ERR|LLM_|PROVIDER_|ROUTE_|MODEL_|AUTH_|API_)/.test(code)) return true;
  if (typeof error?.info?.code === "string") return true;
  const message = typeof error?.message === "string" ? error.message : "";
  return /route|provider|model|api key|apiKey|credential|unauthor|forbidden|rate.?limit|quota|balance|ECONN|ENOTFOUND|ETIMEDOUT|socket hang up|fetch failed|upstream|overload|(?:not|un)available|does not (?:exist|support)|unsupported|no such/i.test(
    message,
  );
}

/** Read the structured message out of a tool's failed result. */
function resultMessage(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter((value) => value !== "")
    .join("\n")
    .trim();
  if (text !== "") return text;
  const message = result?.error?.message;
  return typeof message === "string" && message !== "" ? message : "the delegation tool failed without a message";
}

/** The denial result the tools service expects from a rejecting guard. */
function denied(reason) {
  const message = `Error: ${reason}`;
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    error: { message, info: { name: "SubagentInjectionRefusal", code: "SUBAGENT_FORK_DISABLED" } },
  };
}

/**
 * Rewrite a fork call to run the spawn tool instead.
 *
 * The two delegation tools accept the same request fields, so the call's
 * arguments survive the swap unchanged: only the tool name and its parameter
 * schema have to be replaced with the spawn tool's.
 *
 * @param exec - the live execution the waterfall handed over.
 * @param tools - the tools service bound to this Host.
 * @returns whether the spawn tool is visible to this caller.
 */
function asSpawnCall(exec, tools) {
  const definition = tools.get(SPAWN_TOOL, exec.agent);
  if (definition === undefined) return false;
  exec.name = SPAWN_TOOL;
  exec.schema = { name: SPAWN_TOOL, description: definition.description ?? "", parameters: definition.parameters };
  return true;
}

export const name = "subagent-injection";
export const inject = ["tools"];

/**
 * Install the orchestration rules for one Host context.
 * @param ctx - Host context that owns the delegation tools.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config = {}) {
  const current = () => readConfig(config);

  ctx.on("tools/execute", async (exec, next) => {
    if (typeof exec.name !== "string" || exec.agent === undefined) return next();
    const settings = current();
    if (!settings.enabled) return next();

    if (FORK_TOOLS.has(exec.name)) {
      if (settings.fork) return next();
      const original = exec.name;
      if (!asSpawnCall(exec, ctx.tools)) {
        return denied(`${original} is disabled by the 子智能体 (Subagents) settings page, and the subagent tool is not available in this session.`);
      }
      ctx.logger?.info?.("[subagent-injection] %s re-dispatched as %s: fork is disabled", original, SPAWN_TOOL);
      // Falls through on purpose: the rewritten call still gets the configured
      // child route, so a disabled fork never loses the route preference.
    }

    if (SPAWN_TOOLS.has(exec.name)) {
      const routes = settings.routes;
      if (routes.length === 0) return next();

      const base = exec.arguments;
      const attempts = hasRouteRequest(base) ? [{ label: `${base.provider ?? "?"}/${base.model ?? "?"} (agent choice)`, args: base }, ...routes.map((route) => ({ label: routeLabel(route), args: withRoute(base, route) }))] : routes.map((route) => ({ label: routeLabel(route), args: withRoute(base, route) }));

      /** Run one candidate; `undefined` means "this route failed, try the next". */
      const dispatch = async (attempt, index) => {
        const previous = exec.arguments;
        exec.arguments = attempt.args;
        try {
          const result = await next();
          if (result?.isError !== true) {
            if (index > 0) ctx.logger?.info?.("[subagent-injection] %s fell back to %s after %d failure(s)", exec.name, attempt.label, index);
            return result;
          }
          const message = resultMessage(result);
          if (!isRouteFailure(exec, { message })) return result;
          ctx.logger?.warn?.("[subagent-injection] route %s failed, trying the next candidate: %s", attempt.label, message);
          return { failed: `${attempt.label}: ${message}` };
        } catch (error) {
          if (!isRouteFailure(exec, error)) throw error;
          ctx.logger?.warn?.("[subagent-injection] route %s failed, trying the next candidate", attempt.label);
          return { failed: `${attempt.label}: ${error instanceof Error ? error.message : String(error)}` };
        } finally {
          exec.arguments = previous;
        }
      };

      const failures = [];
      for (let index = 0; index < attempts.length; index += 1) {
        const outcome = await dispatch(attempts[index], index);
        if (outcome === undefined || outcome.failed === undefined) return outcome;
        failures.push(outcome.failed);
      }

      throw new SubagentRouteError(`every configured child LLM route failed:\n${failures.map((line) => `  - ${line}`).join("\n")}`, failures);
    }

    return next();
  });
}
