export * from "./api";
export * from "./model";

export const gorchestraCorePackageName = "@gorchestra/core";

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("@gorchestra/core source tests", () => {
    it("exports the internal package name from source", () => {
      expect(gorchestraCorePackageName).toBe("@gorchestra/core");
    });
  });
}
