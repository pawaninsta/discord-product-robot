import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Create a Shopify draft product from an image")
    .addAttachmentOption(option =>
      option
        .setName("image")
        .setDescription("Upload a bottle image")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option
        .setName("cost")
        .setDescription("Product cost")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option
        .setName("price")
        .setDescription("Selling price")
        .setRequired(true)
    )
    .addNumberOption(option =>
      option
        .setName("abv")
        .setDescription("Optional ABV % (e.g., 53.5)")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(false)
    )
    .addNumberOption(option =>
      option
        .setName("proof")
        .setDescription("Optional proof (e.g., 107). If provided, ABV will be computed as proof/2.")
        .setMinValue(0)
        .setMaxValue(200)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("notes")
        .setDescription("Optional notes (store pick, barrel #, etc.)")
        .setRequired(false)
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function register() {
  try {
    console.log("📡 Registering slash command...");
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_APP_ID),
      { body: commands }
    );
    console.log("✅ Slash command registered!");
  } catch (error) {
    console.error(error);
  }
}

register();
