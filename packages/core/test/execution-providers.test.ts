import { describe, expect, it } from "vitest";
import {
  ZipformerRunner,
  defaultExecutionProviders,
  prepareOrtWasm,
  type OrtLike,
  type ZipformerIo,
} from "../src/recitation/zipformerRunner";

const MIN_IO: ZipformerIo = {
  T: 1,
  hop: 1,
  featureDim: 1,
  vocabSize: 1,
  inputs: [{ name: "x", dims: [1, 1, 1], dtype: "float32" }],
};

function fakeOrt(env?: OrtLike["env"]) {
  const captured: { executionProviders?: string[] } = {};
  const ort: OrtLike = {
    env,
    InferenceSession: {
      create: async (_model, options) => {
        captured.executionProviders = options?.executionProviders;
        return { run: async () => ({}) };
      },
    },
    Tensor: class {
      data;
      dims;
      type;
      constructor(type: string, data: Float32Array | BigInt64Array | Int32Array, dims: readonly number[]) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    },
  };
  return { ort, captured };
}

describe("defaultExecutionProviders", () => {
  it("picks wasm when ort.env.wasm exists and no backend list (onnxruntime-web)", () => {
    expect(defaultExecutionProviders({ env: { wasm: {} } })).toEqual(["wasm"]);
  });

  it("picks cpu when wasm is absent", () => {
    expect(defaultExecutionProviders({})).toEqual(["cpu"]);
    expect(defaultExecutionProviders({ env: {} })).toEqual(["cpu"]);
    expect(defaultExecutionProviders(null)).toEqual(["cpu"]);
  });

  it("picks cpu when listSupportedBackends has cpu but not wasm (onnxruntime-node)", () => {
    expect(
      defaultExecutionProviders({
        env: { wasm: {} },
        listSupportedBackends: () => [{ name: "cpu" }, { name: "coreml" }],
      }),
    ).toEqual(["cpu"]);
  });

  it("picks wasm when listSupportedBackends includes wasm", () => {
    expect(
      defaultExecutionProviders({
        env: { wasm: {} },
        listSupportedBackends: () => [{ name: "wasm" }, { name: "webgpu" }],
      }),
    ).toEqual(["wasm"]);
  });
});

describe("prepareOrtWasm", () => {
  it("sets numThreads=1 when the caller has not set it", () => {
    const wasm = {};
    prepareOrtWasm({ env: { wasm } });
    expect((wasm as { numThreads: number }).numThreads).toBe(1);
  });

  it("does not overwrite a caller-set thread count", () => {
    const wasm = { numThreads: 4 };
    prepareOrtWasm({ env: { wasm } });
    expect(wasm.numThreads).toBe(4);
  });

  it("is a no-op without wasm", () => {
    const ort = { env: {} };
    prepareOrtWasm(ort);
    expect(ort.env).toEqual({});
  });
});

describe("ZipformerRunner.create provider selection", () => {
  it("uses wasm + numThreads=1 under a web-like ort", async () => {
    const { ort, captured } = fakeOrt({ wasm: {} });
    await ZipformerRunner.create(ort, new Uint8Array([1]), MIN_IO);
    expect(captured.executionProviders).toEqual(["wasm"]);
    expect(ort.env?.wasm?.numThreads).toBe(1);
  });

  it("uses cpu under a node-like ort", async () => {
    const { ort, captured } = fakeOrt();
    await ZipformerRunner.create(ort, new Uint8Array([1]), MIN_IO);
    expect(captured.executionProviders).toEqual(["cpu"]);
  });

  it("uses cpu when node lists cpu even though env.wasm exists", async () => {
    const { ort, captured } = fakeOrt({ wasm: {} });
    ort.listSupportedBackends = () => [{ name: "cpu" }, { name: "coreml" }];
    await ZipformerRunner.create(ort, new Uint8Array([1]), MIN_IO);
    expect(captured.executionProviders).toEqual(["cpu"]);
  });

  it("honours an explicit executionProviders override", async () => {
    const { ort, captured } = fakeOrt({ wasm: {} });
    await ZipformerRunner.create(ort, new Uint8Array([1]), MIN_IO, ["webgpu"]);
    expect(captured.executionProviders).toEqual(["webgpu"]);
  });
});
