import { describe, it, expect } from "vitest";
import { Queue } from "./Queue.ts";

describe("Queue Extensions", () => {
  it("should swap tracks and update currentIndex correctly", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-0");
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    queue.start(); // currentIndex = 0 ("track-0")

    expect(queue.swap(0, 2)).toBe(true);
    expect(queue.tracksList).toEqual(["track-2", "track-1", "track-0"]);
    expect(queue.currentIndexInQueue).toBe(2);
    expect(queue.currentTrack).toBe("track-0");

    expect(queue.swap(0, 10)).toBe(false);
  });

  it("should skipTo a specific index in non-repeat mode", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-0");
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    queue.enqueue("track-3");
    queue.start();

    const target = queue.skipTo(2);
    expect(target).toBe("track-2");
    expect(queue.currentTrack).toBe("track-2");
    expect(queue.historyList).toEqual(["track-0", "track-1"]);
  });

  it("should removeRange of tracks", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-0");
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    queue.enqueue("track-3");

    const removed = queue.removeRange(1, 2);
    expect(removed).toEqual(["track-1", "track-2"]);
    expect(queue.tracksList).toEqual(["track-0", "track-3"]);
  });

  it("should clearExceptCurrent track", () => {
    const queue = new Queue<string>();
    queue.enqueue("track-0");
    queue.enqueue("track-1");
    queue.enqueue("track-2");
    queue.start(); // current is track-0

    queue.clearExceptCurrent();
    expect(queue.tracksList).toEqual(["track-0"]);
    expect(queue.currentTrack).toBe("track-0");
    expect(queue.size).toBe(1);
  });
});
