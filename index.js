import { Client, GatewayIntentBits } from "discord.js";
import { runPipeline } from "./pipeline.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("🤖 Robot is online");
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "create-product") {
    await interaction.reply({ content: "🧪 Working on it…", ephemeral: true });

    const image = interaction.options.getAttachment("image");
    const cost = interaction.options.getNumber("cost");
    const price = interaction.options.getNumber("price");
    const abv = interaction.options.getNumber("abv");
    const proof = interaction.options.getNumber("proof");
    const notes = interaction.options.getString("notes") || "";

    await runPipeline({ image, cost, price, abv, proof, notes });
  }
});

console.log("DISCORD_TOKEN exists:", Boolean(process.env.DISCORD_TOKEN));
client.login(process.env.DISCORD_TOKEN);

