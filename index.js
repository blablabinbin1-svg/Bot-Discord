const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    REST,
    Routes
} = require('discord.js');

// ================= CONFIGURARE =================
const http = require("http");

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running");
  })
  .listen(process.env.PORT || 10000);

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;


const STAFF_WARN_CHANNEL_ID = 'ID_CANAL_STAFF_WARNS';
const PLAYER_WARN_CHANNEL_ID = 'ID_CANAL_PLAYER_WARNS';
// ===============================================

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder()
        .setName('staffwarn')
        .setDescription('Acordă un avertisment unui membru staff')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('utilizator')
                .setDescription('Membrul staff sancționat')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('motiv')
                .setDescription('Motivul avertismentului')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('numar_warn')
                .setDescription('Ex: 1/3, 2/3')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('playerwarn')
        .setDescription('Acordă un avertisment unui jucător')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption(option =>
            option.setName('nume')
                .setDescription('Numele sau @mention jucătorului')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('motiv')
                .setDescription('Motivul avertismentului')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('numar_warn')
                .setDescription('Ex: 1/3, 2/3')
                .setRequired(false)),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Se înregistrează comenzile slash...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands },
        );
        console.log('Comenzile au fost înregistrate cu succes!');
    } catch (error) {
        console.error(error);
    }
})();

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'staffwarn') {
        const target = interaction.options.getUser('utilizator');
        const reason = interaction.options.getString('motiv');
        const warnCount = interaction.options.getString('numar_warn') || 'Nespecificat';

        const channel = client.channels.cache.get(STAFF_WARN_CHANNEL_ID);
        if (!channel) return interaction.reply({ content: 'Canalul de Staff Warns nu a fost găsit!', ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('⚠️ STAFF WARN')
            .setColor(0xFF0000)
            .setThumbnail(target.displayAvatarURL())
            .addFields(
                { name: '👤 Membru Staff', value: `${target} (${target.tag})`, inline: true },
                { name: '🛡️ Sancționat de', value: `${interaction.user}`, inline: true },
                { name: '📊 Warn', value: warnCount, inline: true },
                { name: '📝 Motiv', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: interaction.guild.name });

        await channel.send({ content: `${target}`, embeds: [embed] });
        await interaction.reply({ content: `✅ Avertismentul pentru ${target} a fost postat în ${channel}!`, ephemeral: true });
    }

    if (interaction.commandName === 'playerwarn') {
        const playerName = interaction.options.getString('nume');
        const reason = interaction.options.getString('motiv');
        const warnCount = interaction.options.getString('numar_warn') || 'Nespecificat';

        const channel = client.channels.cache.get(PLAYER_WARN_CHANNEL_ID);
        if (!channel) return interaction.reply({ content: 'Canalul de Player Warns nu a fost găsit!', ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle('🚨 PLAYER WARN')
            .setColor(0xFFA500)
            .addFields(
                { name: '🎮 Jucător', value: playerName, inline: true },
                { name: '🛡️ Admin / Staff', value: `${interaction.user}`, inline: true },
                { name: '📊 Warn', value: warnCount, inline: true },
                { name: '📝 Motiv', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: interaction.guild.name });

        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: `✅ Avertismentul pentru **${playerName}** a fost postat în ${channel}!`, ephemeral: true });
    }
});

client.once('ready', () => {
    console.log(`Botul este online ca ${client.user.tag}!`);
});

client.login(TOKEN);
