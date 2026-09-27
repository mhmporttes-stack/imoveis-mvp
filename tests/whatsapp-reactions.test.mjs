import test from "node:test";
import assert from "node:assert/strict";
import { latestReactionsByTarget } from "../lib/whatsapp-reactions.mjs";

test("reação mais recente e remoção não reaparecem como mensagem antiga", () => {
  const reactions = [
    { direction: "inbound", body: "❤️", payload: { reaction: { message_id: "a" } }, message_at: "2026-09-27T20:00:00Z" },
    { direction: "inbound", body: "", payload: { reaction: { message_id: "a" } }, message_at: "2026-09-27T20:02:00Z" },
    { direction: "outbound", body: "👍", metadata: { replyToMessageId: "a" }, message_at: "2026-09-27T20:01:00Z" },
    { direction: "inbound", body: "😮", payload: { reaction: { message_id: "b" } }, message_at: "2026-09-27T20:03:00Z" }
  ];
  const result = latestReactionsByTarget(reactions, ["a"]);
  assert.equal(result.get("a:customer"), "");
  assert.equal(result.get("a:team"), "👍");
  assert.equal(result.has("b:customer"), false);
});
