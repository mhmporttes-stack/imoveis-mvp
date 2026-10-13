// Painel Online (components/OnlinePresenceBoard.jsx) — dados fictícios para a vitrine (somente `next dev`).
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const office = (active, source = "wifi") => ({ ruleEnabled: true, active, eligible: active, validUntil: active ? new Date(now + 20 * 3600000).toISOString() : null, source: active ? source : null, firstSeenAt: active ? ago(8) : null });
const wa = (states) => states.map((state, i) => ({ slot: i + 1, connected: state !== "off", state }));

export const presence = {
  online: 1, away: 2, offline: 3, officeRuleEnabled: true,
  members: [
    { id: "u1", name: "Eduardo Demo", photoUrl: "", status: "away", lastActivityAt: ago(9), device: "mobile", whatsapp: wa(["off"]), office: office(false) },
    { id: "u2", name: "Jennyfer Demo", photoUrl: "", status: "away", lastActivityAt: ago(12), device: "mobile", whatsapp: wa(["active", "active"]), office: office(true, "manual") },
    { id: "u3", name: "Bruna Demo", photoUrl: "", status: "online", lastActivityAt: ago(1), device: "desktop", whatsapp: wa(["idle"]), office: office(true) },
    { id: "u4", name: "Bencke Demo", photoUrl: "", status: "offline", lastActivityAt: ago(660), device: "mobile", whatsapp: wa(["off"]), office: office(false) },
    { id: "u5", name: "Caroline Demo", photoUrl: "", status: "offline", lastActivityAt: ago(960), device: "mobile", whatsapp: wa(["off"]), office: office(false) }
  ]
};

export const routes = [
  { match: /^\/api\/admin\/presence(\?|$)/, response: () => presence },
  { match: /^\/api\/admin\/office-presence/, response: () => ({ enabled: true, canToggle: true, networks: [{ key: "177.10.20.30" }], currentKey: "177.10.20.30", currentMatches: true }) },
  { match: /^\/api\/daily-goal\/team-overview/, response: () => ({ brokers: [{ brokerId: "u2", meta: { percent: 60 } }, { brokerId: "u3", meta: { percent: 100 } }] }) },
  { match: /^\/api\/admin\/presence\/report/, response: () => ({ members: [], range: null }) }
];
