import { YuKumo } from "../Kumo.ts";

/**
 * Exporter generating standard Prometheus metrics string for Yukumo nodes and players.
 */
export class PrometheusExporter {
  private kumo: YuKumo;

  constructor(kumo: YuKumo) {
    this.kumo = kumo;
  }

  /**
   * Renders openmetrics / prometheus text format statistics.
   */
  public renderMetrics(): string {
    const lines: string[] = [];

    lines.push("# HELP yukumo_connected_nodes Total connected Lavalink nodes");
    lines.push("# TYPE yukumo_connected_nodes gauge");
    lines.push(`yukumo_connected_nodes ${this.kumo.nodes.size()}`);

    lines.push("# HELP yukumo_active_players Total active audio players");
    lines.push("# TYPE yukumo_active_players gauge");
    lines.push(`yukumo_active_players ${this.kumo.getPlayers().length}`);

    for (const node of this.kumo.getNodes()) {
      const stats = node.stats;
      if (!stats) continue;

      const nodeLabel = `node="${node.name}"`;
      lines.push(`yukumo_node_players{${nodeLabel}} ${stats.players}`);
      lines.push(`yukumo_node_playing_players{${nodeLabel}} ${stats.playingPlayers}`);
      lines.push(`yukumo_node_uptime_seconds{${nodeLabel}} ${Math.floor(stats.uptime / 1000)}`);
      lines.push(
        `yukumo_node_cpu_lavalink_load{${nodeLabel}} ${stats.cpu.lavalinkLoad ?? stats.cpu.nodelinkLoad ?? 0}`,
      );
      lines.push(`yukumo_node_cpu_system_load{${nodeLabel}} ${stats.cpu.systemLoad}`);
      lines.push(`yukumo_node_memory_used_bytes{${nodeLabel}} ${stats.memory.used}`);
      lines.push(`yukumo_node_memory_allocated_bytes{${nodeLabel}} ${stats.memory.allocated}`);

      if (stats.frameStats) {
        lines.push(`yukumo_node_frames_sent{${nodeLabel}} ${stats.frameStats.sent}`);
        lines.push(`yukumo_node_frames_nulled{${nodeLabel}} ${stats.frameStats.nulled}`);
        lines.push(`yukumo_node_frames_deficit{${nodeLabel}} ${stats.frameStats.deficit}`);
      }
    }

    return lines.join("\n") + "\n";
  }
}
