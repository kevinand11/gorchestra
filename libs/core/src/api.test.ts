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

function validCommandInputs(): Record<string, Record<string, unknown>> {
  const id = "id-1";
  const work = { maxActiveSliceSlots: 1, maxCorrectionRetriesPerFailure: 0, modelTimeoutMs: 1 };
  const projectModel = {
    planningModelId: null,
    revisionPlanningModelId: null,
    executionModelId: null,
    revisionExecutionModelId: null,
  };
  const portfolioConfig = { model: { defaultModelId: id, ...projectModel }, work: null };
  const projectConfig = { model: null, work: null };
  const planConfig = { model: { planningModelId: null } };
  const deliveryConfig = {
    model: { revisionPlanningModelId: null, executionModelId: null, revisionExecutionModelId: null },
    work,
  };
  const planOutput = { proposedDeliveries: [], proposedMemories: [], proposedLinks: [] };
  const revisionOutput = { instruction: { body: "  " }, disposition: { body: " handled " } };
  const repositoryConfig = { provider: "github", owner: " octo ", name: " repo " };

  return {
    setPortfolioConfig: { config: portfolioConfig },
    createModelProvider: {
      name: " provider ",
      protocol: "anthropic-messages",
      baseUrl: "https://api.example.com/",
      auth: null,
      headers: [],
    },
    updateModelProvider: {
      modelProviderId: id,
      name: "provider",
      baseUrl: "http://localhost:3000/",
      auth: { type: "apiKey", secretId: id },
      headers: [{ name: "X-API-Key", valueSecretId: id }],
    },
    archiveModelProvider: { modelProviderId: id },
    unarchiveModelProvider: { modelProviderId: id },
    createModel: { providerId: id, name: "model", providerModelId: " claude " },
    updateModel: { modelId: id, name: "model" },
    archiveModel: { modelId: id },
    unarchiveModel: { modelId: id },
    preflightModel: { modelId: id },
    createPlan: { projectId: id, title: " title ", config: planConfig },
    acceptPlanOutput: { planId: id, output: planOutput },
    rejectPlanOutput: { planId: id },
    configureDelivery: { deliveryId: id, config: deliveryConfig },
    queueDelivery: { deliveryId: id },
    runDeliveryWork: { deliveryId: id },
    retryDeliveryPreflight: { deliveryId: id },
    openRevisionGate: { reviewSurfaceId: id },
    acceptRevisionOutput: { revisionGateId: id, output: revisionOutput },
    closeRevisionGate: { revisionGateId: id },
    shipDelivery: { deliveryId: id },
    abandonDelivery: { deliveryId: id, reason: "  " },
    createProject: { title: "project", source: { type: "source-control" }, config: projectConfig },
    setProjectConfig: { projectId: id, config: projectConfig },
    createRepository: { projectId: id, config: repositoryConfig },
    updateRepositoryConfig: { repositoryId: id, config: repositoryConfig },
    createSecret: { type: "generic", name: "secret", valueRef: " ref " },
    replaceSecret: { secretId: id, valueRef: " ref " },
    bindSecret: { secretId: id, scope: { type: "portfolio" }, envName: "TOKEN" },
    archiveSecretBinding: { secretBindingId: id },
    exportSnapshot: { passphrase: "passphrase" },
  };
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

    expect(result).toMatchObject({
      ok: false,
      error: {
        type: "invalid-input",
        boundary: "construction",
        operation: "openCore",
        pipeError: { messages: [{ message: "is not an object", value: null }] },
      },
    });
  });

  it("validates dependency adapter shape without probing adapter behavior", () => {
    const options = {
      storage: {
        transaction: () => {
          throw new Error("storage transaction was probed");
        },
      },
      ports: createPorts(),
      clock: {
        now: () => {
          throw new Error("clock was probed");
        },
      },
      idGenerator: {
        nextId: () => {
          throw new Error("id generator was probed");
        },
      },
    };

    expect(openCore(options)).toMatchObject({ ok: true });

    const invalidPorts = createPorts() as unknown as { sourceControl: { preflightRepository?: unknown } };
    delete invalidPorts.sourceControl.preflightRepository;

    expect(openCore({ ...options, ports: invalidPorts as never })).toMatchObject({
      ok: false,
      error: {
        type: "invalid-input",
        boundary: "construction",
        operation: "openCore",
        pipeError: { messages: [expect.objectContaining({ path: "ports.sourceControl.preflightRepository" })] },
      },
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

    const inputs = validCommandInputs();

    await Promise.all(
      commandNames.map(async (name) => {
        expect(typeof commands[name]).toBe("function");
        await expect(commands[name]?.(inputs[name] ?? {}, context)).resolves.toEqual({
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
    const reviewScope = { type: "delivery", deliveryId: id, deliveryArtifactId: id } as never;
    const revisionScope = { type: "delivery-artifact", deliveryId: id, deliveryArtifactId: id } as never;
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
      ["listReviewSurfaces", () => result.value.queries.listReviewSurfaces(reviewScope)],
      ["getCurrentReviewSurface", () => result.value.queries.getCurrentReviewSurface(reviewScope)],
      ["getRevision", () => result.value.queries.getRevision(id)],
      ["listRevisions", () => result.value.queries.listRevisions(revisionScope)],
      ["getTimeline", () => result.value.queries.getTimeline(null)],
    ];

    await Promise.all(
      queryCalls.map(async ([name, call]) => {
        await expect(call()).resolves.toEqual({ ok: false, error: { type: "not-implemented", operation: name } });
      }),
    );
  });

  it("validates command inputs and contexts before returning not-implemented", async () => {
    const result = openTestCore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(result.value.commands.queueDelivery({ deliveryId: "   " } as never, context)).resolves.toMatchObject({
      ok: false,
      error: {
        type: "invalid-input",
        boundary: "command",
        operation: "queueDelivery",
        pipeError: { messages: [expect.objectContaining({ path: "input.deliveryId" })] },
      },
    });

    await expect(
      result.value.commands.queueDelivery({ deliveryId: " delivery-1 ", unknown: "stripped" } as never, {
        actor: { type: "", id: "" },
        correlationId: " keep exact ",
      }),
    ).resolves.toEqual({ ok: false, error: { type: "not-implemented", operation: "queueDelivery" } });

    await expect(
      result.value.commands.createSecret({ type: "generic", name: "secret", valueRef: "   " } as never, context),
    ).resolves.toMatchObject({
      ok: false,
      error: { type: "invalid-input", boundary: "command", operation: "createSecret" },
    });
  });

  it("validates query arguments before returning not-implemented", async () => {
    const result = openTestCore();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(result.value.queries.getProject("   " as never)).resolves.toMatchObject({
      ok: false,
      error: {
        type: "invalid-input",
        boundary: "query",
        operation: "getProject",
        pipeError: { messages: [expect.objectContaining({ path: "args.0" })] },
      },
    });
  });

  it("validates snapshot import input and context before import behavior", async () => {
    let decryptCalled = false;

    await expect(
      importSnapshot(
        {
          passphrase: "",
          encryptedPayload: new Uint8Array([1]),
          storage,
          snapshotEncryption: {
            encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
            decrypt: () => {
              decryptCalled = true;
              return Promise.resolve({ bytes: new TextEncoder().encode("{}") });
            },
          },
        },
        context,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { type: "invalid-input", boundary: "snapshot-import", operation: "importSnapshot" },
    });
    expect(decryptCalled).toBe(false);

    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage,
          snapshotEncryption: {
            encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
            decrypt: () => {
              decryptCalled = true;
              return Promise.resolve({ bytes: new TextEncoder().encode("{}") });
            },
          },
        },
        { actor: { type: 123, id: "actor-1" }, correlationId: null } as never,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        type: "invalid-input",
        boundary: "snapshot-import",
        operation: "importSnapshot",
        pipeError: { messages: [expect.objectContaining({ path: "context.actor.type" })] },
      },
    });
    expect(decryptCalled).toBe(false);
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

    const statefulSnapshotEncryption = {
      payload: new TextEncoder().encode("{}"),
      encrypt: () => Promise.resolve({ bytes: new Uint8Array() }),
      decrypt() {
        return Promise.resolve({ bytes: this.payload });
      },
    };
    const statefulStorage = {
      called: false,
      transaction<T>(fn: (tx: CoreStorageTransaction) => Promise<T>): Promise<T> {
        this.called = true;
        return fn({} as CoreStorageTransaction);
      },
    };

    await expect(
      importSnapshot(
        {
          passphrase: "passphrase",
          encryptedPayload: new Uint8Array([1]),
          storage: statefulStorage,
          snapshotEncryption: statefulSnapshotEncryption,
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { type: "not-implemented", operation: "importSnapshot" } });
    expect(statefulStorage.called).toBe(true);
  });
});
