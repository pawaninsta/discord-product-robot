import { Client, GatewayIntentBits } from "discord.js";
import { runPipeline } from "./pipeline.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("🤖 Robot is online");
});

function safeThreadName(base) {
  // Discord thread names must be 1-100 chars.
  const cleaned = String(base || "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 100) || "create-product";
}

function makeDiscordSender(channelLike) {
  return async (message) => {
    const content = String(message ?? "").trim();
    if (!content) return;

    // Discord message hard limit is 2000 chars. Split conservatively.
    const MAX = 1900;
    for (let i = 0; i < content.length; i += MAX) {
      const chunk = content.slice(i, i + MAX);
      await channelLike.send({ content: chunk });
    }
  };
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "create-product") {
    await interaction.reply({ content: "🧪 Starting… creating a log thread…", ephemeral: true });

    const image = interaction.options.getAttachment("image");
    const cost = interaction.options.getNumber("cost");
    const price = interaction.options.getNumber("price");
    const abv = interaction.options.getNumber("abv");
    const proof = interaction.options.getNumber("proof");
    const quantity = interaction.options.getInteger("quantity");
    const barcode = interaction.options.getString("barcode");
    const referenceLink = interaction.options.getString("reference_link");
    const notes = interaction.options.getString("notes") || "";

    let logThread = null;
    try {
      const channel = interaction.channel;
      if (channel && typeof channel === "object" && "threads" in channel && channel.threads?.create) {
        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        const name = safeThreadName(`create-product • ${interaction.user.username} • ${stamp}`);
        logThread = await channel.threads.create({
          name,
          autoArchiveDuration: 60,
          reason: `create-product run by ${interaction.user.tag}`
        });

        await logThread.send({
          content: `🧪 Started by <@${interaction.user.id}>. Logs for this run will be posted in this thread.`
        });
      }
    } catch (e) {
      console.warn("THREAD: failed to create log thread:", e?.message || String(e));
    }

    if (logThread) {
      await interaction.editReply({
        content: `🧪 Working on it… Logs will be posted in ${logThread}. I’ll ping you in the channel when it’s done.`
      });
    } else {
      await interaction.editReply({
        content: "🧪 Working on it… (I couldn’t create a log thread; falling back to the webhook logger if configured.)"
      });
    }

    const result = await runPipeline({
      image,
      cost,
      price,
      abv,
      proof,
      quantity,
      barcode,
      referenceLink,
      notes,
      send: logThread ? makeDiscordSender(logThread) : undefined
    });

    const mention = `<@${interaction.user.id}>`;
    const channel = interaction.channel;

    if (result?.ok) {
      const lines = [
        `${mention} ✅ Product creation finished.`,
        result.adminUrl ? `Draft: ${result.adminUrl}` : "",
        result.needsAbv ? "⚠️ ABV/proof wasn’t found with confidence, so **Alcohol by Volume** was left blank." : "",
        logThread?.url ? `Logs: ${logThread.url}` : ""
      ].filter(Boolean);

      if (channel?.send) await channel.send({ content: lines.join("\n") });
      await interaction.editReply({ content: "✅ Done. (I posted the final result in the channel.)" });
    } else {
      const errText = result?.error ? String(result.error) : "Unknown error";
      const lines = [
        `${mention} ❌ Product creation failed: ${errText}`,
        logThread?.url ? `Logs: ${logThread.url}` : ""
      ].filter(Boolean);

      if (channel?.send) await channel.send({ content: lines.join("\n") });
      await interaction.editReply({ content: "❌ Failed. (I posted details in the channel.)" });
    }
  }
});

console.log("DISCORD_TOKEN exists:", Boolean(process.env.DISCORD_TOKEN));
client.login(process.env.DISCORD_TOKEN);

