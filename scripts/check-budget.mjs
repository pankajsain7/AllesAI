// Verifies the multi-answer context budgeter: answers must fit the budget,
// short answers must survive intact, and long answers must keep their head AND
// tail. A silent regression here degrades every consensus and council run
// without producing any visible error.
//
// Usage: node --import tsx scripts/check-budget.mjs
import { fitAnswers, excerpt, contextBudgetFor, DEFAULT_CONTEXT_BUDGET } from "../src/lib/answer-budget.ts";

let failures = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const answers = (...lengths) => lengths.map((n, i) => ({ model: `m${i}`, content: "x".repeat(n) }));
const total = (list) => list.reduce((sum, a) => sum + a.content.length, 0);

console.log("\nfitAnswers — budget is respected");
{
  const budget = 10_000;
  const out = fitAnswers(answers(50_000, 50_000, 50_000, 50_000), budget);
  check("total stays within budget", total(out) <= budget, `${total(out)} > ${budget}`);
  check("every answer is present", out.length === 4);
}

console.log("\nfitAnswers — short answers are never truncated");
{
  const out = fitAnswers(answers(100, 100, 100_000), 10_000);
  check("short answer 1 kept whole", out[0].content.length === 100, `${out[0].content.length}`);
  check("short answer 2 kept whole", out[1].content.length === 100, `${out[1].content.length}`);
}

console.log("\nfitAnswers — slack is redistributed to the long answer");
{
  const budget = 12_000;
  const out = fitAnswers(answers(100, 100, 100_000), budget);
  const long = out[2].content.length;
  // A flat budget/n split would have given the long answer only 4000.
  check("long answer gets more than an equal split", long > budget / 3, `${long} <= ${budget / 3}`);
  check("long answer uses the freed slack", long >= budget - 400, `${long} < ${budget - 400}`);
}

console.log("\nfitAnswers — nothing to do");
{
  const out = fitAnswers(answers(10, 20, 30), 10_000);
  check("all answers untouched", total(out) === 60);
  check("empty input is safe", fitAnswers([], 10_000).length === 0);
}

console.log("\nexcerpt — head and tail survive");
{
  const content = `${"H".repeat(5_000)}${"M".repeat(50_000)}${"T".repeat(5_000)}`;
  const out = excerpt(content, 6_000);
  check("result fits the limit", out.length <= 6_000, `${out.length}`);
  check("opening is preserved", out.startsWith("HHHH"));
  check("closing is preserved", out.endsWith("TTTT"), `ends with ${JSON.stringify(out.slice(-8))}`);
  check("omission is marked", out.includes("characters omitted"));
}

console.log("\nexcerpt — degenerate limits");
{
  check("shorter than limit is returned as-is", excerpt("abc", 100) === "abc");
  const tiny = excerpt("y".repeat(1_000), 60);
  check("tiny limit still produces output", tiny.length > 0 && tiny.length < 120, `${tiny.length}`);
}

console.log("\ncontextBudgetFor — sized from the model window");
{
  const unknown = contextBudgetFor("not/a-real-model", 1_000_000);
  check("unknown model falls back to the default", unknown === DEFAULT_CONTEXT_BUDGET, `${unknown}`);
  check("cap is always honoured", contextBudgetFor("not/a-real-model", 50_000) === 50_000);

  const big = contextBudgetFor("bedrock/zai.glm-5", 1_000_000);
  const small = contextBudgetFor("groq/llama-3.1-8b-instant", 1_000_000);
  check("a known model yields a positive budget", big > 0, `${big}`);
  check("a larger window yields at least as much budget", big >= small, `${big} < ${small}`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
