import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest가 빌드 없이 TypeScript 테스트를 돌린다", () => {
    const sum: number = 1 + 1;
    expect(sum).toBe(2);
  });
});
