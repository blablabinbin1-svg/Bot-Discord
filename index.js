const http = require('http');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const { TOKEN, CLIENT_ID, GUILD_ID, PORT } = process.env;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Botul ruleaza.');
}).listen(PORT || 10000, () => {
  console.log(`Server HTTP pornit pe portul ${PORT || 10000}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName('staffwarn')
    .setDescription('Avertizează un membru staff')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt => opt.setName('utilizator').setDescription('Membrul staff').setRequired(true))
    .addStringOption(opt => opt.setName('motiv').setDescription('Motivul avertismentului').setRequired(true)),
  new SlashCommandBuilder()
    .setName('playerwarn')
    .setDescription('Avertizează un jucător')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(opt => opt.setName('utilizator').setDescription('Jucătorul').setRequired(true))
    .addStringOption(opt => opt.setName('motiv').setDescription('Motivul avertismentului').setRequired(true)),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`Botul este online ca ${client.user.tag}`);
  try {
    console.log('Încep înregistrarea comenzilor pe server...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Comenzile au fost înregistrate cu succes!');
  } catch (error) {
    console.error('Eroare la înregistrarea comenzilor:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'staffwarn' || interaction.commandName === 'playerwarn') {
    const target = interaction.options.getUser('utilizator');
    const reason = interaction.options.getString('motiv');
    await interaction.reply({
      content: `Avertisment (${interaction.commandName}) pentru ${target}: **${reason}**`,
    });
  }
});

client.login(TOKEN);
