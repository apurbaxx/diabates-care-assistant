const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const ts = require("typescript");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
}

const { withEvidenceCitations } = require("../lib/knowledge/evidence-citations.ts");
const { PassageExcerpt } = require("../components/knowledge/PassageExcerpt.tsx");
const passages = require("../ml-service/data/passages.json");

function render(passage) {
  const response = { query: "HbA1c", results: [passage] };
  const formatted = withEvidenceCitations(response);
  assert.equal(formatted.query, response.query);
  assert.equal(formatted.results[0].text, passage.text);
  assert.equal(formatted.results[0].page_number, passage.page_number);
  assert.equal(formatted.results[0].doc_title, passage.doc_title);
  return renderToStaticMarkup(createElement(PassageExcerpt, { passage: formatted.results[0] }));
}

test("renders RSSDI numeric references, including a citation group, with semantic superscripts", () => {
  const html = render(passages.find(passage => passage.passage_id === "rssdi-2024-glucose-monitoring-p1-008"));
  assert.match(html, /months\.<sup>7<\/sup> HbA1c/);
  assert.match(html, /stability\.<sup>16<\/sup> HbA1c/);
  assert.match(html, /Rs 266 to Rs 476 per test\) is another constraint\.<sup>21,22<\/sup>/);
});

test("renders ADA figure references while preserving ordinary measurements", () => {
  const html = render(passages.find(passage => passage.passage_id === "ada-2026-diagnosis-classification-p4-028"));
  assert.match(html, /European populations\. <sup>1<\/sup>No single clinical/);
  assert.match(html, /25 kg\/m2/);
  assert.match(html, /5–10%/);
});

test("unmapped and changed passages render as escaped plain text with existing paragraph breaks", () => {
  const text = "HbA1c 7.2% in 2026.\n\n<em>Rs 266</em>";
  const expected = "<p>HbA1c 7.2% in 2026.</p><p>&lt;em&gt;Rs 266&lt;/em&gt;</p>";
  assert.equal(render({ passage_id: "legacy", text }), expected);
  assert.equal(render({ passage_id: "rssdi-2024-glucose-monitoring-p1-008", text }), expected);
});
