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

  it("duas chaves diferentes para a mesma missão creditam uma vez só", async () => {
    expect((await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", "pay_a")).status).toBe(201);
    expect((await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", "pay_b")).status).toBe(200);
    expect(await ledger(app, "msn_1900")).toHaveLength(1);
  });

  it("aprovações concorrentes da mesma missão com chaves diferentes geram um crédito", async () => {
    const results = await Promise.all(
      ["c1", "c2", "c3", "c4", "c5"].map((k) => approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", k)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await ledger(app, "msn_1900")).toHaveLength(1);
  });

  it("retry de missão já creditada devolve o crédito mesmo depois do prazo", async () => {
    await approve(app, "msn_1842", "2026-03-13T01:02:00.000Z", "pay_9f3");
    expect((await approve(app, "msn_1842", "2026-03-14T12:00:00.000Z", "pay_9f3")).status).toBe(200);
    expect(await ledger(app, "msn_1842")).toHaveLength(1);
  });

  it("chave já usada em outra missão é recusada sem creditar nenhuma das duas de novo", async () => {
    await approve(app, "msn_1900", "2026-03-12T18:11:00.000Z", "pay_x");
    expect((await approve(app, "msn_2044", "2026-03-20T15:00:00.000Z", "pay_x")).status).toBe(409);
    expect(await ledger(app, "msn_1900")).toHaveLength(1);
    expect(await ledger(app, "msn_2044")).toHaveLength(0);
  });

  it.each(["2026-03-12", "2026-03-13T00:30:00", "2026-03-13T00:30:00.000"])(
    "approved_at sem fuso (%s) é recusado, porque o dia dependeria do servidor",
    async (approvedAt) => {
      expect((await approve(app, "msn_1842", approvedAt, "pay_tz")).status).toBe(400);
    },
  );

  it("aceita approved_at com offset explícito de São Paulo", async () => {
    expect((await approve(app, "msn_1842", "2026-03-12T23:59:59.999-03:00", "pay_off")).status).toBe(201);
  });

  it("PENDING ou FAILED atrasado do provedor não desfaz um repasse pago", async () => {
    const res = await approve(app, "msn_2044", "2026-03-20T15:00:00.000Z", "pay_paid");
    const { payout } = (await res.json()) as { payout: { id: string } };
    const send = (provider_status: string) =>
      app.request(`/payouts/${payout.id}/provider`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider_status }),
      });
    expect(((await (await send("CONFIRMED")).json()) as { status: string }).status).toBe("paid");
    expect(((await (await send("PENDING")).json()) as { status: string }).status).toBe("paid");
    expect(((await (await send("FAILED")).json()) as { status: string }).status).toBe("paid");
  });
});
