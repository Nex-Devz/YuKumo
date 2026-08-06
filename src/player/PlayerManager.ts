import { Player } from "./Player.ts";
import type { PlayerOptions, PlayerStatus } from "./Player.ts";
import type { YuKumo } from "../Kumo.ts";

/** Criteria for PlayerManager.find/findOne — all fields optional, AND-combined */
export interface PlayerFindCriteria {
  /** Node ID/name the player runs on */
  node?: string;
  /** One status or a list of acceptable statuses */
  status?: PlayerStatus | PlayerStatus[];
  voiceChannelId?: string;
  textChannelId?: string;
  autoplay?: boolean;
  stayInVc?: boolean;
  /** Shorthand for status "playing" (true) / not playing (false) */
  playing?: boolean;
  /** Custom predicate applied after the other criteria */
  filter?: (player: Player) => boolean;
}

export class PlayerManager {
  private readonly players = new Map<string, Player>();
  private readonly kumo: YuKumo;

  public constructor(kumo: YuKumo) {
    this.kumo = kumo;
  }

  public create(options: Omit<PlayerOptions, "kumo">): Player {
    const existing = this.players.get(options.guildId);
    // A destroyed player is a dead husk — replace it instead of handing it back
    if (existing != null && !existing.destroyed) {
      return existing;
    }

    const playerOptions: PlayerOptions = { ...options, kumo: this.kumo };
    const PlayerCtor =
      (this.kumo as { playerClass?: new (options: PlayerOptions) => Player }).playerClass ?? Player;
    const player = new PlayerCtor(playerOptions);
    this.players.set(options.guildId, player);
    options.node.playerCount += 1;
    return player;
  }

  /**
   * Removes a player from the registry without destroying it. Called by
   * Player.destroy() so direct destroys (auto-disconnect, channel delete)
   * can't leak stale entries. The identity check guards against dropping a
   * newer player created for the same guild.
   */
  public uncache(guildId: string, player?: Player): void {
    const current = this.players.get(guildId);
    if (player === undefined || current === player) {
      this.players.delete(guildId);
    }
  }

  public get(guildId: string): Player | undefined {
    return this.players.get(guildId);
  }

  public has(guildId: string): boolean {
    return this.players.has(guildId);
  }

  public async destroy(guildId: string, reason?: string): Promise<boolean> {
    const player = this.players.get(guildId);
    if (player === undefined) return false;

    // Player.destroy() uncaches itself and adjusts node playerCount
    await player.destroy(reason);
    this.players.delete(guildId);
    return true;
  }

  public getAll(): Player[] {
    return Array.from(this.players.values());
  }

  public getByNode(nodeId: string): Player[] {
    return this.getAll().filter((p) => p.node.id === nodeId);
  }

  /**
   * Finds players matching the given criteria — replaces manual getAll()
   * filtering: `manager.players.find({ node: "india-01", status: "playing" })`.
   */
  public find(criteria: PlayerFindCriteria = {}): Player[] {
    const statuses =
      criteria.status == null
        ? null
        : Array.isArray(criteria.status)
          ? criteria.status
          : [criteria.status];

    return this.getAll().filter((p) => {
      if (criteria.node != null && p.node.id !== criteria.node) return false;
      if (statuses != null && !statuses.includes(p.status)) return false;
      if (criteria.voiceChannelId != null && p.voiceChannelId !== criteria.voiceChannelId) return false;
      if (criteria.textChannelId != null && p.textChannelId !== criteria.textChannelId) return false;
      if (criteria.autoplay != null && p.autoplay !== criteria.autoplay) return false;
      if (criteria.stayInVc != null && p.stayInVc !== criteria.stayInVc) return false;
      if (criteria.playing != null && (p.status === "playing") !== criteria.playing) return false;
      if (criteria.filter != null && !criteria.filter(p)) return false;
      return true;
    });
  }

  /** First player matching the criteria, or undefined */
  public findOne(criteria: PlayerFindCriteria = {}): Player | undefined {
    return this.find(criteria)[0];
  }

  public async destroyAll(reason?: string): Promise<void> {
    const promises = Array.from(this.players.entries()).map(async ([guildId]) => {
      await this.destroy(guildId, reason);
    });
    await Promise.all(promises);
  }

  public size(): number {
    return this.players.size;
  }
}
