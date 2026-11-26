const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

// Load the actual route without starting a Next.js server or Python backend.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  const resolved = name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : name;
  return resolve.call(this, resolved, ...args);
};
require.extensions[".ts"] = (file, name) => {
  const { outputText } = ts.transpileModule(readFileSync(name, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  file._compile(outputText, name);
};
const routePath = "../app/api/visit-summary/translate/route.ts";
let route = require(routePath);
const syntheticSummary = {
  complaint: "Synthetic encounter K-76: heel discomfort.",
  observations: "Mock pulse 71 bpm.",
  notes: "Training example mentioning Metformin 250 mg.",
  instructions: "Mock follow-up scheduled for 2030-02-15.",
};
const access = "mock-development-translation-token";

function send(authorization, extraHeaders = {}, body = JSON.stringify({ targetLanguage: "hi", fields: syntheticSummary })) {
  const headers = { Host: "localhost", "Content-Type": "application/json", ...extraHeaders };
  if (authorization) headers.Authorization = authorization;
  return route.POST(new Request("http://localhost/api/visit-summary/translate", {
    method: "POST",
    headers,
    body,
  }));
}

async function run() {
  process.env.NODE_ENV = "development";
  process.env.SARVAM_TRANSLATION_ENABLED = "true";
  process.env.CLINIQ_TRANSLATION_ACCESS_TOKEN = access;
  process.env.ML_SERVICE_API_KEY = "mock-internal-key";
  const calls = [];
  const logs = [];
  const incomingId = "synthetic-header-secret";
  console.warn = entry => logs.push(entry);
  async function diagnostic(response, status, code) {
    assert.equal(response.status, status);
    const value = (await response.json()).diagnostic;
    assert.equal(value.code, code);
    assert.equal(value.requestId, response.headers.get("X-Request-ID"));
    assert.deepEqual(Object.keys(logs.at(-1)).sort(), ["code", "requestId", "retryable", "stage", "status"]);
    assert.equal(logs.at(-1).requestId, value.requestId);
    assert.equal(logs.at(-1).code, code);
    return value.requestId;
  }
  let forwardedId;
  global.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers["X-API-Key"], "mock-internal-key");
    assert.equal(options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(options.body), { targetLanguage: "hi", fields: syntheticSummary });
    forwardedId = options.headers["X-Request-ID"];
    assert.match(forwardedId, /^[0-9a-f-]{36}$/);
    assert.notEqual(forwardedId, incomingId);
    const upstreamHeaders = { "X-Request-ID": forwardedId };
    if (calls.length === 1) return Response.json({
      error: { code: "translation_rate_limited", retryable: true },
      diagnostic: { requestId: forwardedId, code: "SARVAM_HTTP_TRANSLATION_RATE_LIMITED" },
    }, { status: 429, headers: { ...upstreamHeaders, "Retry-After": "999" } });
    if (calls.length === 5) return Response.json({
      error: { code: "unauthorized", retryable: false },
      diagnostic: { requestId: forwardedId, code: "FASTAPI_AUTH_UNAUTHORIZED" },
    }, { status: 401, headers: upstreamHeaders });
    if (calls.length === 6) return new Response("synthetic-provider-response-body");
    if (calls.length === 7) return Response.json({ notes: "synthetic-translated-text" });
    if (calls.length === 8) return Response.json({
      error: { code: "invalid_translation_request", retryable: false },
      diagnostic: { requestId: incomingId, code: "FASTAPI_VALIDATION_INVALID_TRANSLATION_REQUEST" },
    }, { status: 400, headers: upstreamHeaders });
    return Response.json(syntheticSummary, { headers: upstreamHeaders });
  };
  const bearer = `Bearer ${access}`;
  for (const url of ["http://remote.example", "http://127.0.0.2", "http://127.1", "http://localhost.example"]) {
    process.env.ML_SERVICE_URL = url;
    await diagnostic(await send(bearer), 503, "PX_CONFIG");
  }
  process.env.ML_SERVICE_URL = "http://localhost:8000";
  assert.equal((await send()).status, 401);
  await diagnostic(await send("Bearer synthetic-invalid-token"), 401, "PX_AUTH");
  await diagnostic(await send(bearer, { Origin: "https://other.example" }), 403, "PX_ORIGIN");
  process.env.NODE_ENV = "production";
  const logCount = logs.length;
  const production = await send(bearer);
  assert.equal(production.status, 503);
  assert.equal(production.headers.get("X-Request-ID"), null);
  assert.deepEqual(await production.json(), { error: { code: "translation_disabled", retryable: false } });
  assert.equal(logs.length, logCount);
  process.env.NODE_ENV = "development";
  assert.equal(calls.length, 0);
  for (const url of ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "https://remote.example"]) {
    process.env.ML_SERVICE_URL = url;
    const response = await send(bearer, { "X-Request-ID": incomingId });
    assert.equal(calls.at(-1), `${url}/visit-summary/translate`);
    if (calls.length === 1) {
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "60");
      assert.equal(await diagnostic(response, 429, "SARVAM_HTTP_TRANSLATION_RATE_LIMITED"), forwardedId);
    } else {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-Request-ID"), forwardedId);
    }
  }
  await diagnostic(await send(bearer), 502, "FASTAPI_AUTH_UNAUTHORIZED");
  await diagnostic(await send(bearer), 502, "PX_RESPONSE_JSON");
  await diagnostic(await send(bearer), 502, "PX_RESPONSE_SCHEMA");
  await diagnostic(await send(bearer), 400, "PX_UPSTREAM");
  await diagnostic(await send(bearer, {}, "{synthetic-input-body"), 400, "PX_JSON");
  await diagnostic(await send(bearer, {}, JSON.stringify({ notes: "synthetic-input-body" })), 400, "PX_SCHEMA");
  while (calls.length < 10) assert.equal((await send(bearer)).status, 200);
  const response = await send(bearer);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  await diagnostic(response, 429, "PX_RATE_LIMIT");
  assert.equal(calls.length, 10);
  // Use a fresh process-local request window for the content-type and body cases.
  delete require.cache[require.resolve(routePath)];
  route = require(routePath);
  for (const contentType of ["application/json", "application/json; charset=utf-8", "Application/JSON ; charset=utf-8"]) {
    assert.equal((await send(bearer, { "Content-Type": contentType })).status, 200);
  }
  const countAfterValidRequests = calls.length;
  await diagnostic(await send(bearer, { "Content-Type": "text/plain" }), 400, "PX_CONTENT_TYPE");
  await diagnostic(await send(bearer, { "Content-Type": "application/jsonx" }), 400, "PX_CONTENT_TYPE");
  await diagnostic(await send(bearer, {}, null), 400, "PX_BODY_MISSING");
  await diagnostic(await send(bearer, {}, ""), 400, "PX_BODY_MISSING");
  await diagnostic(await send(bearer, {}, "x".repeat(32769)), 413, "PX_BODY_SIZE");
  assert.equal(calls.length, countAfterValidRequests);
  for (const secret of [access, "mock-internal-key", "synthetic-invalid-token", incomingId,
    "synthetic-input-body", "synthetic-provider-response-body", "synthetic-translated-text",
    ...Object.values(syntheticSummary)]) assert.ok(!JSON.stringify(logs).includes(secret));
  console.log("PASS: proxy authentication, JSON media types, body validation, correlation, response parsing, redaction, production gating, transport rules, rate limiting, and bounded Retry-After");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
