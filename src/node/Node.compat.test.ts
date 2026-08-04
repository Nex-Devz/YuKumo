import { describe, it, expect } from "vitest";
import { Node } from "./Node.ts";
import { NodeStateCode } from "../types/constants.ts";

describe("Node Compat", () => {
  it("should return true for connected when state is connected", () => {
    const node = new Node({ host: "localhost", port: 2333, password: "pass" }, "client-id");
    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    expect(node.connected).toBe(true);
  });

  it("should return false for connected when state is not connected", () => {
    const node = new Node({ host: "localhost", port: 2333, password: "pass" }, "client-id");
    Object.defineProperty(node.ws, "state", { value: "disconnected", configurable: true });
    expect(node.connected).toBe(false);
  });

  it("should return correct stateCode for each state", () => {
    const node = new Node({ host: "localhost", port: 2333, password: "pass" }, "client-id");

    Object.defineProperty(node.ws, "state", { value: "disconnected", configurable: true });
    expect(node.stateCode).toBe(NodeStateCode.DISCONNECTED);

    Object.defineProperty(node.ws, "state", { value: "connecting", configurable: true });
    expect(node.stateCode).toBe(NodeStateCode.CONNECTING);

    Object.defineProperty(node.ws, "state", { value: "connected", configurable: true });
    expect(node.stateCode).toBe(NodeStateCode.CONNECTED);

    Object.defineProperty(node.ws, "state", { value: "destroyed", configurable: true });
    expect(node.stateCode).toBe(NodeStateCode.DESTROYED);
  });

  it("should verify NodeStateCode enum values", () => {
    expect(NodeStateCode.DISCONNECTED).toBe(0);
    expect(NodeStateCode.CONNECTING).toBe(1);
    expect(NodeStateCode.CONNECTED).toBe(2);
    expect(NodeStateCode.DESTROYED).toBe(3);
  });
});
