import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { getProductById, setProductMetafield, updateProductDescription } from "./shopify.js";
import { regenerateDescription } from "./ai.js";
import { searchWhiskeyInfo, searchTastingNotes } from "./search.js";
import { loadChoices, choicesPromptBlock } from "./shopify-choices.js";
import { extractProductIdFromAdminUrl } from "./tasting-card.js";

const PREVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function handleUpdateDescriptionCommand(interaction) {
  const adminUrl = interaction.options.getString("url");
  const userNotes = interaction.options.getString("notes") || "";
  const applyImmediately = interaction.options.getBoolean("apply") || false;

  await interaction.reply({ content: "📝 Fetching product…", ephemeral: true });

  let productId;
  try {
    productId = extractProductIdFromAdminUrl(adminUrl);
  } catch (err) {
    await interaction.editReply({ content: `❌ Invalid Shopify admin product URL: ${err.message}` });
    return;
  }

  let logThread = null;
  try {
    const channel = interaction.channel;
    if (channel?.threads?.create) {
      const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
      const threadName = `update-description • ${interaction.user.username} • ${stamp}`.slice(0, 100);
      logThread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 60,
        reason: `update-description by ${interaction.user.tag}`
      });
    }
  } catch (e) {
    console.warn("UPDATE-DESC: failed to create log thread:", e?.message || String(e));
  }

  const send = async (content) => {
    if (!logThread) return;
    const text = String(content ?? "").trim();
    if (!text) return;
    const MAX = 1900;
    for (let i = 0; i < text.length; i += MAX) {
      try { await logThread.send({ content: text.slice(i, i + MAX) }); } catch {}
    }
  };

  try {
    const product = await getProductById(productId);
    await send(`📝 Updating description for **${product.title}**\nCurrent description: ${product.descriptionHtml?.length || 0} chars`);
    await interaction.editReply({
      content: logThread ? `📝 Working in ${logThread}.` : `📝 Processing **${product.title}**…`
    });

    let choicesBlock = "";
    try {
      await loadChoices();
      choicesBlock = choicesPromptBlock();
    } catch (cErr) {
      console.warn("UPDATE-DESC: failed to load Shopify choices:", cErr?.message || String(cErr));
    }

    const factSheet = buildFactSheet(product);

    // Optional web research (best-effort) — gives the rewrite real grounding.
    let webResearch = null;
    try {
      const query = [product.title, factSheet.region].filter(Boolean).join(" ").slice(0, 160);
      if (query) {
        const [specs, tasting] = await Promise.all([
          searchWhiskeyInfo(query).catch(() => null),
          searchTastingNotes(query).catch(() => null)
        ]);
        webResearch = {
          query,
          summary: specs?.summary || "",
          tastingNotesSummary: tasting?.tastingNotesSummary || ""
        };
        if (specs?.status === "error") {
          await send(`⚠️ Web research error: ${specs?.errorMessage || "(no message)"}`);
        } else if (specs?.status === "disabled") {
          await send("ℹ️ Web research disabled (missing GOOGLE_API_KEY/GOOGLE_CX). Continuing with metafield facts only.");
        }
      }
    } catch (webErr) {
      console.warn("UPDATE-DESC: web research failed:", webErr?.message || String(webErr));
    }

    const { short_description, description } = await regenerateDescription({
      title: product.title,
      factSheet,
      webResearch,
      userNotes,
      choicesBlock
    });

    await send([
      `**New description (${description.length} chars)**`,
      "```html",
      description.slice(0, 1600),
      description.length > 1600 ? "... [truncated]" : "",
      "```",
      `**Short description:** ${short_description}`
    ].filter(Boolean).join("\n"));

    if (applyImmediately) {
      await writeDescription(product, description, short_description, send);
      return;
    }

    if (!logThread) {
      await interaction.editReply({ content: "⚠️ Couldn't create a log thread for preview/confirm. Re-run with `apply:true` to skip preview." });
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`upd-desc-confirm:${product.id}`).setStyle(ButtonStyle.Success).setLabel("Apply"),
      new ButtonBuilder().setCustomId(`upd-desc-cancel:${product.id}`).setStyle(ButtonStyle.Secondary).setLabel("Cancel")
    );

    const promptMsg = await logThread.send({
      content: `Apply this description to **${product.title}**?\nOld → New: ${product.descriptionHtml?.length || 0} → ${description.length} chars`,
      components: [confirmRow]
    });

    try {
      const click = await promptMsg.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: PREVIEW_TIMEOUT_MS
      });

      if (click.customId.startsWith("upd-desc-confirm")) {
        await click.update({ content: "⏳ Writing to Shopify…", components: [] });
        await writeDescription(product, description, short_description, send);
        await click.editReply({ content: `✅ Updated. https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/products/${stripGid(product.id)}` });
      } else {
        await click.update({ content: "❌ Cancelled. No changes written.", components: [] });
      }
    } catch (timeoutErr) {
      try {
        await promptMsg.edit({ content: "⌛ Preview expired (no confirm in 5 minutes). Re-run the command to try again.", components: [] });
      } catch {}
    }
  } catch (err) {
    console.error("UPDATE-DESC ERROR:", err);
    const msg = `❌ Update failed: ${err?.message || String(err)}`;
    await send(msg);
    try { await interaction.editReply({ content: msg }); } catch {}
  }
}

async function writeDescription(product, descriptionHtml, shortDescription, send) {
  await updateProductDescription(product.id, descriptionHtml);
  if (shortDescription) {
    try {
      await setProductMetafield(product.id, "custom", "short_description", shortDescription, "single_line_text_field");
    } catch (mfErr) {
      console.warn("UPDATE-DESC: short_description metafield write failed:", mfErr?.message || String(mfErr));
    }
  }
  await send(`✅ descriptionHtml updated (${descriptionHtml.length} chars).`);
}

function stripGid(gidOrId) {
  return String(gidOrId).replace(/^gid:\/\/shopify\/Product\//, "");
}

/**
 * Build a fact sheet from a product's existing metafields. The keys here match how
 * getProductById flattens them (`<namespace>.<key>`).
 */
function buildFactSheet(product) {
  const m = product.metafields || {};
  const parseList = (v) => {
    if (!v) return [];
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [String(p)];
    } catch {
      return String(v).split(",").map(s => s.trim()).filter(Boolean);
    }
  };

  return {
    vendor: product.vendor || "",
    title: product.title || "",
    sub_type: m["custom.sub_type"] || "",
    age_statement: m["custom.age_statement"] || "",
    abv: m["custom.alcohol_by_volume"] || "",
    region: m["custom.state"] || "",
    country: parseList(m["custom.location_"])[0] || "",
    cask_wood: parseList(m["custom.cask_wood"]),
    finish_type: parseList(m["custom.finish_type"]),
    mash_bill: parseList(m["custom.mash_bill"])[0] || "",
    distillery_name: m["custom.distillery_name"] || "",
    nose: m["custom.nose"] || "",
    palate: m["custom.palate"] || "",
    finish: m["custom.finish"] || "",
    awards: m["custom.awards"] || "",
    single_barrel: m["custom.single_barrel"] === "true",
    cask_strength: m["custom.cask_strength"] === "true",
    store_pick: m["custom.store_pick"] === "true",
    bottled_in_bond: m["custom.bottled_in_bond"] === "true",
    finished: m["custom.finished"] === "true",
    limited_time_offer: m["custom.limited_boolean"] === "true",
    gift_pack: m["custom.gift_pack"] === "true"
  };
}
