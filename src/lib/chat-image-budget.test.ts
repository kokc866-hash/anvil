import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundChatImages, CHAT_IMAGE_BYTES, CHAT_IMAGE_COUNT } from "./chat-image-budget.ts";

describe("chat screenshot retention", () => {
  it("bounds hundreds of multi-megabyte frames while retaining every tool and its text", () => {
    const frame = "data:image/png;base64," + "A".repeat(2 * 1024 * 1024);
    let chat = [{ id: "long-run", content: "Work continues", steps: [] as { id: string; status: string; detail: string; image?: string; code: string }[] }];
    for (let i = 0; i < 200; i++) {
      chat = boundChatImages([{ ...chat[0], steps: [...chat[0].steps, { id: `step-${i}`, status: i % 3 ? "ok" : "err", detail: `Tool ${i}`, code: `edit ${i}`, image: frame + i }] }]);
      const images = chat.flatMap(m => m.steps.flatMap(s => s.image ? [s.image] : []));
      assert.ok(images.length <= CHAT_IMAGE_COUNT);
      assert.ok(images.reduce((sum, image) => sum + image.length, 0) <= CHAT_IMAGE_BYTES);
    }
    assert.equal(chat[0].steps.length, 200);
    for (const [i, step] of chat[0].steps.entries()) {
      assert.equal(step.id, `step-${i}`);
      assert.equal(step.detail, `Tool ${i}`);
      assert.equal(step.code, `edit ${i}`);
      assert.equal(step.status, i % 3 ? "ok" : "err");
    }
    assert.equal(chat[0].steps[0].image, undefined);
    assert.equal(chat[0].steps.at(-1)?.image, frame + 199);
  });

  it("shares the count limit across messages and retains newest previews", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ id: String(i), content: `Answer ${i}`, steps: [{ id: String(i), status: "ok", image: `data:image/png;base64,${i}` }] }));
    const next = boundChatImages(history);
    assert.equal(next.filter(m => m.steps[0].image).length, CHAT_IMAGE_COUNT);
    assert.equal(next.length, history.length);
    assert.deepEqual(next.map(m => m.content), history.map(m => m.content));
    assert.ok(history[0].steps[0].image, "input must stay immutable");
    assert.equal(next[0].steps[0].image, undefined);
    assert.equal(next.at(-1), history.at(-1));
    assert.equal(boundChatImages(next), next, "already bounded snapshots retain reference identity");
  });

  it("normalizes restored legacy data and never lets one oversized image defeat the budget", () => {
    const history = [{ content: "All history retained", images: ["user attachment"], steps: [
      { name: "see_run", status: "err", image: "data:image/png;base64,small" },
      { name: "see_run", status: "ok", image: "A".repeat(CHAT_IMAGE_BYTES + 1) },
    ] }];
    const saved = JSON.stringify(history);
    const next = boundChatImages(JSON.parse(saved) as typeof history);
    assert.equal(next[0].steps[1].image, undefined);
    assert.equal(next[0].steps[1].status, "ok");
    assert.equal(next[0].steps[0].image, "data:image/png;base64,small");
    assert.deepEqual(next[0].images, ["user attachment"]);
    assert.deepEqual(boundChatImages(JSON.parse(JSON.stringify(next))), next);
  });
});
