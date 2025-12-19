import { Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import { runPipeline } from "./pipeline.js";
import { generateTastingCard } from "./tasting-card.js";

// Global error handler to prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("🤖 Robot is online");
});

// Prevent Discord client errors from crashing the bot
client.on('error', (error) => {
  console.error('Discord client error:', error);
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

  if (interaction.commandName === "tastingcard") {
    // Try to defer - if this fails, the interaction has expired (3s timeout)
    try {
      await interaction.deferReply();
    } catch (err) {
      console.error("Failed to defer reply (interaction expired or invalid):", err.message);
      return; // Exit early - we can't respond to an expired interaction
    }

    const adminUrl = interaction.options.getString("url");
    const force = interaction.options.getBoolean("force") || false;

    try {
      await interaction.editReply({ content: "🎴 Generating tasting card..." });

      const result = await generateTastingCard({ adminUrl });

      if (result.success) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/5a136f99-0f58-49f0-8eb8-c368792b2230',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.js:47',message:'pngBuffer type before AttachmentBuilder',data:{isBuffer:Buffer.isBuffer(result.pngBuffer),constructorName:result.pngBuffer?.constructor?.name,byteLength:result.pngBuffer?.length||result.pngBuffer?.byteLength||null},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion

        // FIX: Puppeteer returns Uint8Array in newer versions, Discord.js needs Buffer
        const pngAsBuffer = Buffer.isBuffer(result.pngBuffer) 
          ? result.pngBuffer 
          : Buffer.from(result.pngBuffer);

        // Create attachment from PNG buffer
        const attachment = new AttachmentBuilder(pngAsBuffer, {
          name: `tasting-card-${result.productHandle}.png`
        });

        await interaction.editReply({
          content: [
            `✅ Tasting card generated for **${result.productTitle}**`,
            result.cardImageUrl ? `📎 Uploaded to Shopify Files and attached to product` : "",
            result.cardImageUrl ? `🔗 ${result.cardImageUrl}` : ""
          ].filter(Boolean).join("\n"),
          files: [attachment]
        });
      } else {
        await interaction.editReply({
          content: `❌ Failed to generate tasting card: ${result.error}`
        });
      }
    } catch (err) {
      console.error("TASTINGCARD ERROR:", err);
      await interaction.editReply({
        content: `❌ Error: ${err.message || String(err)}`
      });
    }
    return;
  }

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
          content: `🧪 Started by ${interaction.user.username}. Logs for this run will be posted in this thread.`
        });
      }
    } catch (e) {
      console.warn("THREAD: failed to create log thread:", e?.message || String(e));
    }

    if (logThread) {
      await interaction.editReply({
        content: `🧪 Working on it… Logs will be posted in ${logThread}. I'll ping you in the thread when it's done.`
      });
    } else {
      await interaction.editReply({
        content: "🧪 Working on it… (I couldn't create a log thread; falling back to the webhook logger if configured.)"
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

    if (result?.ok) {
      const productTitle = String(result?.productTitle || "").trim();

      // If we have a thread and a title, try to rename the thread to the product name.
      if (logThread && productTitle) {
        try {
          await logThread.setName(safeThreadName(productTitle));
        } catch (e) {
          console.warn("THREAD: failed to rename thread:", e?.message || String(e));
        }
      }

      const lines = [
        `${mention} ✅ Product creation finished.`,
        productTitle ? `**Product:** ${productTitle}` : "",
        result.adminUrl ? `Draft: ${result.adminUrl}` : "",
        result.needsAbv ? "⚠️ ABV/proof wasn't found with confidence, so **Alcohol by Volume** was left blank." : ""
      ].filter(Boolean);

      if (logThread) {
        await logThread.send({ content: lines.join("\n") });
        await interaction.editReply({ content: "✅ Done. Check the thread for details." });
      } else {
        // Fallback: if no thread, post to main channel
        const channel = interaction.channel;
        if (channel?.send) await channel.send({ content: lines.join("\n") });
        await interaction.editReply({ content: "✅ Done. (I posted the result in the channel.)" });
      }
    } else {
      const errText = result?.error ? String(result.error) : "Unknown error";
      const lines = [
        `${mention} ❌ Product creation failed: ${errText}`
      ].filter(Boolean);

      if (logThread) {
        await logThread.send({ content: lines.join("\n") });
        await interaction.editReply({ content: "❌ Failed. Check the thread for details." });
      } else {
        // Fallback: if no thread, post to main channel
        const channel = interaction.channel;
        if (channel?.send) await channel.send({ content: lines.join("\n") });
        await interaction.editReply({ content: "❌ Failed. (I posted details in the channel.)" });
      }
    }
  }
});

console.log("DISCORD_TOKEN exists:", Boolean(process.env.DISCORD_TOKEN));
client.login(process.env.DISCORD_TOKEN);

