import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { seedIncident } from "../src/seed.ts";

// Casos tirados de logs/ que os testes originais não nomeiam.

type App = ReturnType<typeof createApp>;

function setup(): App {
  const db = openDatabase(":memory:");
  seedIncident(db);
  return createApp(db);
}

async function approve(app: App, mission_id: string, approved_at: string, idempotency_key: string) {
  return app.request("/approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mission_id, approved_at, idempotency_key }),
  });
}

async function ledger(app: App, missionId: string) {
  const res = await app.request(`/missions/${missionId}`);
  return ((await res.json()) as { ledger: { amount_brl: number }[] }).ledger;
}

describe("regressão do incidente", () => {
  let app: App;

  beforeEach(() => {
    app = setup();
  });

  it("retry de msn_2044 com zero-width space no fim da chave não credita de novo", async () => {
    expect((await approve(app, "msn_2044", "2026-03-20T15:00:00.000Z", "pay_7c1")).status).toBe(201);
    const retry = await approve(app, "msn_2044", "2026-03-20T15:00:00.000Z", "pay_7c1​");
    expect(retry.status).toBe(200);
    const entries = await ledger(app, "msn_2044");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount_brl).toBe(80);
  });

  it.each([
    ["word joiner", "⁠"],
    ["soft hyphen", "­"],
    ["marca de direção", "‎"],
    ["BOM", "﻿"],
  ])("retry com %s na chave não credita de novo", async (_nome, invisivel) => {
    await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", "pay_22a");
    expect((await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", `pay_22a${invisivel}`)).status).toBe(200);
    expect(await ledger(app, "msn_1900")).toHaveLength(1);
  });

  it("último instante do dia do prazo em São Paulo ainda credita", async () => {
    expect((await approve(app, "msn_1842", "2026-03-13T02:59:59.999Z", "pay_limite")).status).toBe(201);
  });

  it("primeiro instante do dia seguinte em São Paulo já está fora do prazo", async () => {
    expect((await approve(app, "msn_1842", "2026-03-13T03:00:00.000Z", "pay_limite")).status).toBe(409);
  });

  it.each([
    ["só espaços", "   "],
    ["só zero-width space", "​"],
  ])("chave %s é recusada em vez de virar chave vazia", async (_nome, chave) => {
    expect((await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", chave)).status).toBe(400);
    expect(await ledger(app, "msn_1900")).toHaveLength(0);
  });
});
