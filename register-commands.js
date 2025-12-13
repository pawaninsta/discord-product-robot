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
    .addStringOption(option =>
      option
        .setName("notes")
        .setDescription("Optional notes (store pick, proof, etc.)")
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
