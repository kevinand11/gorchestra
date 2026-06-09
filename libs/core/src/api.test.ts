import { describe, expect, it } from "vitest";

import {
  importSnapshot,
  openCore,
  type CorePorts,
  type CoreStorage,
  type CoreStorageTransaction,
  type OperationContext,
  type Result,
} from "./api";

const context: OperationContext = {
  actor: { type: "local-user", id: "actor-1" },
  correlationId: null,
};

const storage: CoreStorage = {
  transaction: <T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T> => fn({} as CoreStorageTransaction),
};

function createPorts(): CorePorts {
  return {
    sourceControl: {
      preflightRepository: () =>
        Promise.resolve({
          type: "validation",
          operation: { type: "delivery-preflight" },
          passed: true,
          summary: "ok",
        }),
      createDeliveryBranch: () => Promise.resolve({ type: "failed", evidence: externalOperationEvidence() }),
      createSliceBranch: () => Promise.resolve({ type: "failed", evidence: externalOperationEvidence() }),
      pushBranch: () => Promise.resolve(externalOperationEvidence()),
      validateBranch: () =>
        Promise.resolve({
          type: "validation",
          operation: { type: "delivery-branch-validation" },
          passed: true,
          summary: "ok",
        }),
      observeBranchIntegration: () => Promise.resolve({ type: "not-integrated" }),
      createReviewSurface: () =>
        Promise.resolve({
          provider: "github",
          pullRequestNumber: 1,
          repositoryId: "repository-1" as never,
          sourceBranch: "delivery/1",
          targetBranch: "main",
        }),
      fetchReviewSurface: (input) => Promise.resolve(input.reviewSurface),
      fetchFeedback: () => Promise.resolve([]),
      mergeReviewSurface: () =>
        Promise.resolve({
          type: "merged",
          merged: { origin: "local", at: "2026-06-09T00:00:00.000Z", actor: context.actor, correlationId: null },
          config: {
            type: "source-control",
            repositoryId: "repository-1" as never,
            sourceBranch: "delivery/1",
            targetBranch: "main",
          },
        }),
      closeReviewSurface: () => Promise.resolve(externalOperationEvidence()),
    },
    modelAgentRuntime: {
      preflightModel: () =>
        Promise.resolve({
          type: "validation",
          operation: { type: "model-preflight" },
          passed: true,
          summary: "ok",
        }),
      runModelAgent: () => Promise.resolve(),
    },
    secrets: {
      resolveSecrets: () => Promise.resolve([]),
      resolveSecretValues: () => Promise.resolve([]),
    },
    snapshotEncryption: {
      encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
      decrypt: () => Promise.resolve({ bytes: new TextEncoder().encode("{}") }),
    },
    events: null,
    logger: null,
  };
}

function externalOperationEvidence() {
  return {
    type: "external-operation" as const,
    operation: { type: "create-artifact" as const },
    passed: false,
    summary: "stub",
  };
}

function openTestCore() {
  return openCore({
    storage,
    ports: createPorts(),
    clock: { now: () => "2026-06-09T00:00:00.000Z" },
    idGenerator: { nextId: (brand) => `${brand}-1` },
  });
}

describe("core runtime stub", () => {
  it("opens synchronously with valid dependencies", () => {
    const result = openTestCore();

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(typeof result.value.commands.createProject).toBe("function");
      expect(typeof result.value.queries.listProjects).toBe("function");
    }
  });

  it("rejects invalid construction input with a narrow invalid-input error", () => {
    const result = openCore(null as unknown as Parameters<typeof openCore>[0]);

    expect(result).toEqual({
      ok: false,
      error: { type: "invalid-input", issues: [{ path: "options", message: "Expected an object." }] },
    });
  });

  it("exposes every documented command and returns not-implemented for valid calls", async () => {
    const result = openTestCore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const commands = result.value.commands as unknown as Record<
      string,
      (input: Record<string, unknown>, operationContext: OperationContext) => Promise<Result<unknown>>
    >;
    const commandNames = [
      "setPortfolioConfig",
      "createModelProvider",
      "updateModelProvider",
      "archiveModelProvider",
      "unarchiveModelProvider",
      "createModel",
      "updateModel",
      "archiveModel",
      "unarchiveModel",
      "preflightModel",
      "createPlan",
      "acceptPlanOutput",
      "rejectPlanOutput",
      "configureDelivery",
      "queueDelivery",
      "runDeliveryWork",
      "retryDeliveryPreflight",
      "openRevisionGate",
      "acceptRevisionOutput",
      "closeRevisionGate",
      "shipDelivery",
      "abandonDelivery",
      "createProject",
      "setProjectConfig",
      "createRepository",
      "updateRepositoryConfig",
      "createSecret",
      "replaceSecret",
      "bindSecret",
      "archiveSecretBinding",
      "exportSnapshot",
    ];

    await Promise.all(
      commandNames.map(async (name) => {
        expect(typeof commands[name]).toBe("function");
        await expect(commands[name]?.({}, context)).resolves.toEqual({
          ok: false,
          error: { type: "not-implemented", operation: name },
        });
      }),
    );
  });

  it("exposes every documented query and returns Result not-implemented for valid calls", async () => {
    const result = openTestCore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const id = "id-1" as never;
    const scope = { type: "delivery", deliveryId: id, deliveryArtifactId: id } as never;
    const queryCalls: Array<[string, () => Promise<Result<unknown>>]> = [
      ["getPortfolioConfig", () => result.value.queries.getPortfolioConfig()],
      ["getProject", () => result.value.queries.getProject(id)],
      ["listProjects", () => result.value.queries.listProjects()],
      ["getRepository", () => result.value.queries.getRepository(id)],
      ["listRepositories", () => result.value.queries.listRepositories(null)],
      ["getModelProvider", () => result.value.queries.getModelProvider(id)],
      ["listModelProviders", () => result.value.queries.listModelProviders(null)],
      ["getModel", () => result.value.queries.getModel(id)],
      ["listModels", () => result.value.queries.listModels(null)],
      ["getPlan", () => result.value.queries.getPlan(id)],
      ["listPlans", () => result.value.queries.listPlans(null)],
      ["getDelivery", () => result.value.queries.getDelivery(id)],
      ["listDeliveries", () => result.value.queries.listDeliveries(null)],
      ["getSlice", () => result.value.queries.getSlice(id)],
      ["listSlices", () => result.value.queries.listSlices(id)],
      ["getReviewSurface", () => result.value.queries.getReviewSurface(id)],
      ["listReviewSurfaces", () => result.value.queries.listReviewSurfaces(scope)],
      ["getCurrentReviewSurface", () => result.value.queries.getCurrentReviewSurface(scope)],
      ["getRevision", () => result.value.queries.getRevision(id)],
      ["listRevisions", () => result.value.queries.listRevisions(scope)],
      ["getTimeline", () => result.value.queries.getTimeline(null)],
    ];

    await Promise.all(
      queryCalls.map(async ([name, call]) => {
        await expect(call()).resolves.toEqual({ ok: false, error: { type: "not-implemented", operation: name } });
      }),
    );
  });

  it("returns import-specific errors before the import stub not-implemented result", async () => {
    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage,
          snapshotEncryption: {
            encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
            decrypt: () => Promise.reject(new Error("bad passphrase")),
          },
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { type: "snapshot-decryption-failed" } });

    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage,
          snapshotEncryption: {
            encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
            decrypt: () => Promise.resolve({ bytes: new TextEncoder().encode("not json") }),
          },
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { type: "invalid-snapshot" } });

    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage: {
            transaction: () => Promise.reject(new Error("disk full")),
          },
          snapshotEncryption: createPorts().snapshotEncryption,
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, error: { type: "storage-operation-failed" } });

    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage,
          snapshotEncryption: createPorts().snapshotEncryption,
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { type: "not-implemented", operation: "importSnapshot" } });
  });
});
