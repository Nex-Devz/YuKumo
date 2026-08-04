import { describe, it, expect } from "vitest";
import { Queue } from "./Queue.ts";

describe("Queue Aliases", () => {
  it("should return current as currentTrack", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-1");
    queue.start();
    expect(queue.current).toBe(queue.currentTrack);
    expect(queue.current).toBe("track-1");
  });

  it("should return length as the number of tracks", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    expect(queue.length).toBe(queue.size);
    expect(queue.length).toBe(2);
  });

  it("should add track same as enqueue", () => {
    const queue = new Queue<string>();
    queue.add("track-1");
    expect(queue.tracksList).toContain("track-1");
    expect(queue.length).toBe(1);
  });

  it("should unshift track same as priorityEnqueue", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-1");
    queue.start(); // current index 0
    queue.unshift("track-2");
    expect(queue.tracksList[1]).toBe("track-2");
  });

  it("should splice same as remove", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    queue.enqueue("track-3");
    
    const removed = queue.splice(1, 1);
    expect(removed).toEqual(["track-2"]);
    expect(queue.length).toBe(2);
  });
});
