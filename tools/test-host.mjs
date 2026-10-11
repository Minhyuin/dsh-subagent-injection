/**
 * Focused checks for the Host half's pure logic and its `tools/execute`
 * behaviour, run against a fake context so no DSH runtime is needed.
 *
 *   node tools/test-host.mjs
 */
import assert from "node:assert/strict";
import { Config, SubagentRouteError, apply, inject, name } from "../plugin/lib/index.js";

/** Build a context that records what the plugin did, and a `next` stub. */
function harness({ routes = [], fork = true, enabled = true, spawnTool = true } = {}) {
  const listeners = [];
  const logs = [];
  const spawnParameters = { type: "object", properties: { description: { type: "string" }, prompt: { type: "string" }, provider: { type: "string" } } };
  const ctx = {
    logger: {
      info: (...args) => logs.push(["info", args]),
      warn: (...args) => logs.push(["warn", args]),
    },
    on(event, listener) {
      assert.equal(event, "tools/execute");
      listeners.push(listener);
    },
    // The business listener is registered straight on the context and depends on
    // no service: the rewritten fork call is re-dispatched through the host's own
    // tool table, not through an injected one.
    inject() {
      assert.fail("the host half must not resolve any service");
    },
    tools: {
      get(toolName, scope) {
        assert.equal(scope.id, "agent");
        if (toolName !== "subagent" || !spawnTool) return undefined;
        return { name: "subagent", description: "Delegate a self-contained task to a subagent.", parameters: spawnParameters };
      },
    },
  };
  apply(ctx, { enabled, fork, routes });
  assert.equal(listeners.length, 1);
  const run = (exec, next) => listeners[0](exec, next);
  return { run, logs };
}

/** A `tools/execute` execution for a delegation tool. */
function execution(argumentsValue, toolName = "subagent") {
  const exec = { name: toolName, arguments: argumentsValue, agent: { id: "agent" }, signal: { aborted: false } };
  return exec;
}

/** A successful tool result. */
const ok = (text) => ({ content: [{ type: "text", text }], isError: false });

/** A failed tool result. */
const bad = (text) => ({ content: [{ type: "text", text }], isError: true, error: { message: text } });

/**
 * A volatile field on a Schema instance is an accessor pair, not a plain value,
 * so a case that feeds one to the plugin has to publish it the way the loader
 * does: `field.get()` reads, and the `cosmokit.volatile.write` symbol writes.
 * The plugin only ever reads, so the writer here satisfies the shape alone.
 */
const volatileField = (value) => {
  let current = value;
  const field = { get: () => current };
  field[Symbol.for("cosmokit.volatile.write")] = (next) => { current = next; };
  field[Symbol("cosmokit.volatile.write")] = (next) => { current = next; };
  return field;
};
/** Read a plain value out of either a plain field or a volatile accessor. */
const plain = (value) => {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.get === "function") return value.get();
  return value;
};
/** A plain snapshot of a whole Config object. */
const plainConfig = (config) => Object.fromEntries(Object.entries(config).map(([key, value]) => [key, plain(value)]));

// The published surface.
assert.equal(name, "subagent-injection");
assert.deepEqual(inject, ["tools"]);
assert.equal(plain(Config({}).enabled), true);
assert.equal(plain(Config({}).fork), true);
assert.deepEqual(plain(Config({}).routes), []);
assert.deepEqual(plainConfig(Config({ routes: [{ provider: "p", model: "m", effort: "high" }] })).routes, [{ provider: "p", model: "m", effort: "high" }]);

// 1. No routes configured: the call passes through untouched.
{
  const { run } = harness();
  const exec = execution({ description: "d", prompt: "p" });
  let seen;
  const result = await run(exec, () => {
    seen = exec.arguments;
    return ok("plain");
  });
  assert.deepEqual(seen, { description: "d", prompt: "p" });
  assert.deepEqual(result, ok("plain"));
}

// 2. Routes configured: the first candidate is injected before the body sees it.
{
  const { run } = harness({ routes: [{ provider: "pioneer", model: "gpt-6-luna", effort: "high" }, { provider: "deepseek", model: "deepseek-flash" }] });
  const exec = execution({ description: "d", prompt: "p" });
  const calls = [];
  const result = await run(exec, () => {
    calls.push({ ...exec.arguments });
    return ok("done");
  });
  assert.deepEqual(calls, [{ description: "d", prompt: "p", provider: "pioneer", model: "gpt-6-luna", reasoning_effort: "high" }]);
  assert.deepEqual(result, ok("done"));
  // The caller's own arguments are restored after the call.
  assert.deepEqual(exec.arguments, { description: "d", prompt: "p" });
}

// 3. A route failure falls through to the next candidate, in order.
{
  const { run, logs } = harness({ routes: [{ provider: "a", model: "m1", effort: "high" }, { provider: "b", model: "m2" }, { provider: "c", model: "m3" }] });
  const exec = execution({ description: "d", prompt: "p" });
  const attempts = [];
  const result = await run(exec, () => {
    attempts.push({ ...exec.arguments });
    if (attempts.length < 3) throw new Error("Provider a is not available: 503 upstream unavailable");
    return ok("third time lucky");
  });
  assert.deepEqual(
    attempts.map((entry) => `${entry.provider}/${entry.model}`),
    ["a/m1", "b/m2", "c/m3"],
  );
  assert.equal(attempts[0].reasoning_effort, "high");
  assert.equal(attempts[1].reasoning_effort, undefined);
  assert.deepEqual(result, ok("third time lucky"));
  assert.equal(logs.filter(([level]) => level === "warn").length, 2);
}

// 4. A failed *result* (not a throw) also advances the list.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p" });
  let calls = 0;
  const result = await run(exec, () => {
    calls += 1;
    return calls === 1 ? bad("Error: model m1 does not exist for provider a") : ok("recovered");
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, ok("recovered"));
}

// 5. A non-route failure is reported as is, after one attempt.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p" });
  let calls = 0;
  await assert.rejects(
    () =>
      run(exec, () => {
        calls += 1;
        throw new TypeError("cannot read properties of undefined (reading 'id')");
      }),
    /cannot read properties of undefined/,
  );
  assert.equal(calls, 1);
}

// 6. A structured failure result that is not route-related is returned untouched.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p" });
  let calls = 0;
  const result = await run(exec, () => {
    calls += 1;
    return bad("Error: description must not be empty");
  });
  assert.equal(calls, 1);
  assert.equal(result.isError, true);
}

// 7. Exhausting every route raises a diagnostic that lists each failure.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p" });
  await assert.rejects(
    () => run(exec, () => bad("Error: provider a is not available (503)")),
    (error) => {
      assert.ok(error instanceof SubagentRouteError);
      assert.equal(error.attempts.length, 2);
      assert.match(error.message, /a\/m1/);
      assert.match(error.message, /b\/m2/);
      return true;
    },
  );
}

// 8. An explicit model request from the agent is honoured first, then superseded.
{
  const { run } = harness({ routes: [{ provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p", provider: "a", model: "m1", reasoning_effort: "low" });
  const attempts = [];
  const result = await run(exec, () => {
    attempts.push({ ...exec.arguments });
    if (attempts.length === 1) throw new Error("ECONNREFUSED provider a");
    return ok("fell back");
  });
  assert.deepEqual(
    attempts.map((entry) => `${entry.provider}/${entry.model}/${entry.reasoning_effort ?? "-"}`),
    ["a/m1/low", "b/m2/-"],
  );
  assert.deepEqual(result, ok("fell back"));
}

// 9. An aborted call is never retried.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }] });
  const exec = execution({ description: "d", prompt: "p" });
  let calls = 0;
  await assert.rejects(() =>
    run(exec, () => {
      calls += 1;
      exec.signal.aborted = true;
      throw new Error("provider a unavailable");
    }),
  );
  assert.equal(calls, 1);
}

// 10. A disabled fork is re-dispatched as the spawn tool, not refused.
{
  const { run, logs } = harness({ fork: false });
  const exec = execution({ description: "d", prompt: "p" }, "subagent_fork");
  const seen = [];
  const result = await run(exec, () => {
    seen.push({ name: exec.name, args: { ...exec.arguments }, schema: exec.schema.name, params: Object.keys(exec.schema.parameters.properties) });
    return ok("spawned");
  });
  assert.deepEqual(seen, [{ name: "subagent", args: { description: "d", prompt: "p" }, schema: "subagent", params: ["description", "prompt", "provider"] }]);
  assert.deepEqual(result, ok("spawned"));
  assert.equal(logs.some(([level, args]) => level === "info" && args[0].includes("re-dispatched") && args[1] === "subagent_fork" && args[2] === "subagent"), true);
}

// 10b. A call the registry cannot re-dispatch as spawn still reports a refusal.
{
  const { run } = harness({ fork: false, spawnTool: false });
  const exec = execution({ description: "d", prompt: "p" }, "subagent_fork");
  let called = false;
  const result = await run(exec, () => {
    called = true;
    return ok("forked");
  });
  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.equal(result.error.info.code, "SUBAGENT_FORK_DISABLED");
  assert.match(result.content[0].text, /subagent_fork is disabled/);
}

// 10c. A re-dispatched fork still gets the configured child route.
{
  const { run } = harness({ fork: false, routes: [{ provider: "a", model: "m1", effort: "high" }] });
  const exec = execution({ description: "d", prompt: "p" }, "subagent_fork");
  const seen = [];
  await run(exec, () => {
    seen.push({ name: exec.name, args: { ...exec.arguments } });
    return ok("spawned");
  });
  assert.deepEqual(seen, [{ name: "subagent", args: { description: "d", prompt: "p", provider: "a", model: "m1", reasoning_effort: "high" } }]);
}

// 11. Fork passes through when the switch is on.
{
  const { run } = harness({ fork: true, routes: [{ provider: "a", model: "m1" }] });
  const exec = execution({ description: "d", prompt: "p" }, "subagent_fork");
  const seen = [];
  const result = await run(exec, () => {
    seen.push({ name: exec.name, args: { ...exec.arguments } });
    return ok("forked");
  });
  assert.deepEqual(seen, [{ name: "subagent_fork", args: { description: "d", prompt: "p" } }]);
  assert.deepEqual(result, ok("forked"));
}

// 12. The master switch turns everything off.
{
  const { run } = harness({ enabled: false, fork: false, routes: [{ provider: "a", model: "m1" }] });
  const exec = execution({ description: "d", prompt: "p" }, "subagent_fork");
  const result = await run(exec, () => ok("untouched"));
  assert.deepEqual(result, ok("untouched"));
}

// 13. Unrelated tools are never rewritten.
{
  const { run } = harness({ fork: false, routes: [{ provider: "a", model: "m1" }] });
  const exec = execution({ command: "ls" }, "bash");
  const result = await run(exec, () => ok("ls output"));
  assert.deepEqual(result, ok("ls output"));
}

// 14. Calls without an owning agent (framework-internal dispatch) pass through.
{
  const { run } = harness({ fork: false, routes: [{ provider: "a", model: "m1" }] });
  const exec = { name: "subagent", arguments: { description: "d", prompt: "p" } };
  const result = await run(exec, () => ok("internal"));
  assert.deepEqual(result, ok("internal"));
}

// 15. Malformed stored routes are dropped instead of producing a broken call.
{
  const { run } = harness({ routes: [{ provider: "a", model: "m1" }, { provider: "", model: "m2" }, { model: "m3" }, null] });
  const exec = execution({ description: "d", prompt: "p" });
  const attempts = [];
  await run(exec, () => {
    attempts.push({ ...exec.arguments });
    return ok("done");
  });
  assert.deepEqual(attempts, [{ description: "d", prompt: "p", provider: "a", model: "m1" }]);
}

console.log("host: 18 checks passed");
