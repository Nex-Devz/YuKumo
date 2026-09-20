import { describe, it, expect } from "vitest";
import { Queue } from "./Queue.ts";
import { QueueFullError } from "../errors/index.ts";

describe("Queue", () => {
  describe("basic operations", () => {
    it("should start empty", () => {
      const queue = new Queue<string>();
      expect(queue.isEmpty).toBe(true);
      expect(queue.size).toBe(0);
      expect(queue.currentTrack).toBeNull();
    });

    it("should enqueue tracks", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");

      expect(queue.size).toBe(2);
      expect(queue.isEmpty).toBe(false);
    });

    it("should start playback with start()", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");

      expect(queue.start()).toBe("track-1");
      expect(queue.currentTrack).toBe("track-1");
    });

    it("should return null from start() when empty", () => {
      const queue = new Queue<string>();
      expect(queue.start()).toBeNull();
    });
  });

  describe("next/previous", () => {
    it("should advance to next track", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();

      expect(queue.next()).toBe("track-2");
      expect(queue.currentTrack).toBe("track-2");
      expect(queue.next()).toBe("track-3");
    });

    it("should return null when at end of queue", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.start();

      expect(queue.next()).toBeNull();
      expect(queue.currentTrack).toBeNull();
    });

    it("should return null when queue is empty", () => {
      const queue = new Queue<string>();
      expect(queue.next()).toBeNull();
    });

    it("should go to previous track", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();
      queue.next();
      queue.next();

      expect(queue.previous()).toBe("track-2");
    });

    it("should return null when at start with no history", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.start();

      expect(queue.previous()).toBeNull();
    });
  });

  describe("repeat modes", () => {
    it("should repeat single track", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();
      queue.setRepeatMode("track");

      expect(queue.next()).toBe("track-1");
      expect(queue.currentTrack).toBe("track-1");
    });

    it("should repeat entire queue", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();
      queue.setRepeatMode("queue");

      expect(queue.next()).toBe("track-2");
      expect(queue.next()).toBe("track-1");
      expect(queue.next()).toBe("track-2");
    });

    it("previous() in queue-repeat steps back without duplicating tracks", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();
      queue.setRepeatMode("queue");
      queue.next(); // -> track-2
      queue.next(); // -> track-3
      queue.next(); // wraps -> track-1

      expect(queue.previous()).toBe("track-3");
      expect(queue.previous()).toBe("track-2");
      // the array is untouched — no duplicated copies were re-inserted
      expect(queue.tracksList).toEqual(["track-1", "track-2", "track-3"]);
      expect(queue.size).toBe(3);
    });

    it("should not repeat when mode is none", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();

      expect(queue.next()).toBe("track-2");
      expect(queue.next()).toBeNull();
    });
  });

  describe("enqueue at index", () => {
    it("should insert at specific index", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-3");
      queue.enqueue("track-2", 1);

      expect(queue.tracksList).toEqual(["track-1", "track-2", "track-3"]);
    });

    it("should throw for out of bounds index", () => {
      const queue = new Queue<string>();
      expect(() => queue.enqueue("track", 5)).toThrow();
    });
  });

  describe("dequeue", () => {
    it("should remove and return track at index", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");

      expect(queue.dequeue(1)).toBe("track-2");
      expect(queue.size).toBe(2);
    });

    it("should remove from front by default", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");

      expect(queue.dequeue()).toBe("track-1");
      expect(queue.size).toBe(1);
    });

    it("should return null when empty", () => {
      const queue = new Queue<string>();
      expect(queue.dequeue()).toBeNull();
    });

    it("should return null for invalid index", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      expect(queue.dequeue(5)).toBeNull();
    });
  });

  describe("remove", () => {
    it("should remove tracks at index", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.enqueue("track-4");

      const removed = queue.remove(1, 2);
      expect(removed).toEqual(["track-2", "track-3"]);
      expect(queue.size).toBe(2);
      expect(queue.tracksList).toEqual(["track-1", "track-4"]);
    });
  });

  describe("move", () => {
    it("should move track from one index to another", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");

      queue.move(0, 2);
      expect(queue.tracksList).toEqual(["track-2", "track-3", "track-1"]);
    });

    it("should do nothing when indices are equal", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");

      queue.move(0, 0);
      expect(queue.tracksList).toEqual(["track-1", "track-2"]);
    });

    it("should throw for invalid indices", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");

      expect(() => queue.move(0, 5)).toThrow();
      expect(() => queue.move(5, 0)).toThrow();
    });
  });

  describe("shuffle", () => {
    it("should reorder tracks randomly", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.enqueue("track-4");
      queue.enqueue("track-5");

      const before = [...queue.tracksList];
      queue.shuffle();
      const after = queue.tracksList;

      expect(after).toHaveLength(5);
      expect([...after].sort()).toEqual([...before].sort());
    });
  });

  describe("clear", () => {
    it("should remove all tracks", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.clear();

      expect(queue.size).toBe(0);
      expect(queue.currentTrack).toBeNull();
    });
  });

  describe("setRepeatMode", () => {
    it("should set repeat mode", () => {
      const queue = new Queue<string>();
      expect(queue.repeatMode).toBe("none");

      queue.setRepeatMode("track");
      expect(queue.repeatMode).toBe("track");

      queue.setRepeatMode("queue");
      expect(queue.repeatMode).toBe("queue");
    });

    it("should be chainable", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.setRepeatMode("queue");
      expect(queue.repeatMode).toBe("queue");
    });
  });

  describe("setTracks", () => {
    it("should replace all tracks", () => {
      const queue = new Queue<string>();
      queue.enqueue("old-1");
      queue.setTracks(["new-1", "new-2", "new-3"]);

      expect(queue.size).toBe(3);
      expect(queue.tracksList).toEqual(["new-1", "new-2", "new-3"]);
      expect(queue.currentTrack).toBe("new-1");
    });
  });

  describe("history", () => {
    it("should track history when advancing", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();
      queue.next();
      queue.next();

      expect(queue.historyList).toEqual(["track-1", "track-2"]);
    });

    it("should cap history size", () => {
      const queue = new Queue<string>({ maxHistorySize: 2 });
      for (let i = 0; i < 10; i++) {
        queue.enqueue(`track-${i}`);
      }

      queue.start();
      for (let i = 0; i < 9; i++) {
        queue.next();
      }

      expect(queue.historyList.length).toBeLessThanOrEqual(2);
    });

    it("should not add current to history when next returns null", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.start();
      queue.next();

      expect(queue.historyList).toHaveLength(1);
    });
  });

  describe("max size", () => {
    it("should throw when exceeding max size", () => {
      const queue = new Queue<string>({ maxSize: 2 });
      queue.enqueue("track-1");
      queue.enqueue("track-2");

      expect(() => queue.enqueue("track-3")).toThrow(QueueFullError);
    });

    it("should allow adding when under max size", () => {
      const queue = new Queue<string>({ maxSize: 3 });
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");

      expect(queue.size).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle large queue", () => {
      const queue = new Queue<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        queue.enqueue(`track-${i}`);
      }

      expect(queue.size).toBe(count);

      queue.start();
      let advanced = 0;
      let next = queue.next();
      while (next != null) {
        advanced++;
        next = queue.next();
      }

      expect(advanced).toBe(count - 1);
    });

    it("should maintain correct currentIndex after remove from middle", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();
      queue.next();

      // after next(), consumed tracks are dropped: queue is [track-2, track-3], current track-2
      queue.remove(1, 1);
      expect(queue.currentTrack).toBe("track-2");
      expect(queue.tracksList).toEqual(["track-2"]);
    });

    it("should keep the removed current track as current until its natural end", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();

      // The node is still playing track-1; removing it must not silently shift
      // the cursor onto the not-yet-played track-2
      queue.remove(0, 1);
      expect(queue.currentTrack).toBe("track-1");
      expect(queue.tracksList).toEqual(["track-2"]);

      // When the removed track ends, the next queued track takes its place
      expect(queue.next()).toBe("track-2");
      expect(queue.currentTrack).toBe("track-2");
    });

    it("records the removed current track in history once and skips nothing", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.enqueue("track-3");
      queue.start();

      queue.remove(0, 1); // playing track-1 removed while it still plays
      expect(queue.next()).toBe("track-2");
      expect(queue.historyList).toEqual(["track-1"]);
      expect(queue.next()).toBe("track-3");
      expect(queue.historyList).toEqual(["track-1", "track-2"]);
    });
  });

  describe("priorityEnqueue and serialization", () => {
    it("should insert track next with priorityEnqueue", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start(); // current is track-1 at index 0

      queue.priorityEnqueue("priority-track");
      expect(queue.tracksList).toEqual(["track-1", "priority-track", "track-2"]);
    });

    it("should export and import queue state", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();
      queue.setRepeatMode("queue");

      const exported = queue.export();
      expect(exported.tracks).toEqual(["track-1", "track-2"]);
      expect(exported.currentIndex).toBe(0);
      expect(exported.repeatMode).toBe("queue");

      const newQueue = new Queue<string>();
      newQueue.import(exported);
      expect(newQueue.tracksList).toEqual(["track-1", "track-2"]);
      expect(newQueue.currentTrack).toBe("track-1");
      expect(newQueue.repeatMode).toBe("queue");
    });

    it("should clear history", () => {
      const queue = new Queue<string>();
      queue.enqueue("track-1");
      queue.enqueue("track-2");
      queue.start();
      queue.next();
      expect(queue.historyList.length).toBeGreaterThan(0);

      queue.clearHistory();
      expect(queue.historyList.length).toBe(0);
    });
  });
});
