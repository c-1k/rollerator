import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRollController, rollFair } from "./roll-engine.js";

describe("rollFair", () => {
  it("returns every integer in [min, max] inclusive", () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(rollFair(1, 20));
    assert.equal(seen.size, 20);
    for (let n = 1; n <= 20; n++) assert.equal(seen.has(n), true);
  });

  it("never returns a constant 20 on a d20", () => {
    const rolls = Array.from({ length: 200 }, () => rollFair(1, 20));
    const twenties = rolls.filter((n) => n === 20).length;
    assert.equal(
      rolls.every((n) => n === 20),
      false,
    );
    assert.ok(twenties < 80, `too many 20s: ${twenties}/200`);
    assert.ok(
      rolls.every((n) => n >= 1 && n <= 20),
      "d20 left its face range",
    );
  });

  it("is close to uniform over 20k d20 rolls", () => {
    const N = 20000;
    const counts = Array(21).fill(0);
    for (let i = 0; i < N; i++) counts[rollFair(1, 20)]++;
    const expected = N / 20;
    let chi = 0;
    for (let v = 1; v <= 20; v++) {
      const d = counts[v] - expected;
      chi += (d * d) / expected;
    }
    assert.ok(chi < 45, `chi-square ${chi.toFixed(2)} (df=19)`);
    assert.ok(counts[20] / N < 0.07, `P(20)=${(counts[20] / N).toFixed(4)}`);
  });
});

describe("createRollController", () => {
  it("starting a new roll invalidates the in-flight one", () => {
    const control = createRollController();
    const first = control.start();
    const second = control.start();
    assert.equal(first.isLive(), false);
    assert.equal(second.isLive(), true);
  });

  it("cancel invalidates an in-flight roll so a later start can run", () => {
    const control = createRollController();
    const first = control.start();
    control.cancel();
    assert.equal(first.isLive(), false);
    const second = control.start();
    assert.equal(first.isLive(), false);
    assert.equal(second.isLive(), true);
  });
});
