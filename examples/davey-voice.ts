import { YuKumo, DaveyAdapter } from "../src/index.ts";

async function main() {
  const yukumo = new YuKumo({
    nodes: [
      {
        host: "localhost",
        port: 2333,
        password: "youshallnotpass",
      },
    ],
  });

  const davey = new DaveyAdapter(yukumo);

  const mockGatewayPacket = {
    t: "VOICE_SERVER_UPDATE",
    d: {
      guild_id: "123456789012345678",
      token: "sample_voice_token",
      endpoint: "voice.discord.media:443",
    },
  };

  davey.handleRawPacket(mockGatewayPacket);

  console.log("Davey Voice Adapter initialized and processing gateway events successfully!");
}

main().catch(console.error);
