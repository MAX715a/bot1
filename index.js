/* =========================================================
 *  MAX - All-in-One Discord System & Security & Music Bot
 *  discord.js v14 | Node.js | كامل بالعربية
 * ========================================================= */

require('dotenv').config();
try { process.env.FFMPEG_PATH = require('ffmpeg-static'); } catch (_) {}

const {
  Client, GatewayIntentBits, Partials, Collection,
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, PermissionsBitField,
  ActivityType, Events
} = require('discord.js');

const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, entersState,
  getVoiceConnection
} = require('@discordjs/voice');

const playdl = require('play-dl');
const fs = require('fs');
const path = require('path');

/* =========================================================
 * 1) الإعدادات العامة (CONFIG)
 * ========================================================= */
const CONFIG = {
  token: process.env.TOKEN || 'ضع_توكن_البوت_هنا',
  colors: {
    main: 0x5865f2,
    success: 0x57f287,
    error: 0xed4245,
    warn: 0xfee75c,
    dark: 0x2b2d31
  },
  verification: {
    roleName: 'موثق',
    unverifiedRoleName: 'غير موثق',
    channelName: 'التحقق'
  },
  tempVoice: {
    channelName: 'أنشئ رومك | Join to Create',
    categoryName: 'رومات مؤقتة'
  },
  tickets: {
    categoryName: 'التذاكر',
    logChannelName: 'سجلات-التذاكر'
  },
  logs: {
    channelName: 'سجلات'
  },
  antiNuke: {
    enabled: true,
    timeWindow: 60_000,     // 60 ثانية
    limits: { channelDelete: 3, roleDelete: 3, ban: 3, kick: 5, channelCreate: 5 }
  },
  antiSpam: {
    enabled: true,
    maxMessages: 5,
    timeWindow: 5_000,
    muteDuration: 60_000
  },
  automod: {
    antiLinks: true,
    antiInvites: true,
    blockedWords: []
  }
};

/* =========================================================
 * 2) قاعدة بيانات مبسطة (JSON)
 * ========================================================= */
const DB_FILE = path.join(__dirname, 'data.json');
const DB = {
  data: {},
  load() {
    try { this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
    catch { this.data = {}; }
  },
  save() {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2)); }
    catch (e) { console.error('[DB] فشل الحفظ:', e.message); }
  },
  g(guildId) { this.data[guildId] ??= {}; return this.data[guildId]; },
  get(guildId, key, def = null) { const g = this.g(guildId); return g[key] ?? def; },
  set(guildId, key, val) { this.g(guildId)[key] = val; this.save(); }
};
DB.load();

/* =========================================================
 * 3) عميل البوت
 * ========================================================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

client.commands = new Collection();
client.musicQueues = new Map();   // guildId -> { player, connection, queue[], current, volume }
client.tempVoice = new Map();     // channelId -> ownerId
client.antiNuke = new Map();      // guildId:userId -> { channelDelete:[], roleDelete:[], ban:[], kick:[], channelCreate:[] }
client.spamMap = new Map();       // guildId:userId -> [timestamps]

/* =========================================================
 * 4) دوال مساعدة
 * ========================================================= */
const embed = (color, title, desc) => new EmbedBuilder()
  .setColor(color).setTitle(title).setDescription(desc || null);

const okEmbed = (t, d) => embed(CONFIG.colors.success, `✅ ${t}`, d);
const errEmbed = (t, d) => embed(CONFIG.colors.error, `❌ ${t}`, d);
const warnEmbed = (t, d) => embed(CONFIG.colors.warn, `⚠️ ${t}`, d);
const infoEmbed = (t, d) => embed(CONFIG.colors.main, t, d);

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied)
      return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (e) { console.error('[Reply]', e.message); }
}

async function sendLog(guild, embeds) {
  try {
    const logName = CONFIG.logs.channelName;
    const ch = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildText && c.name === logName
    );
    if (!ch) return;
    await ch.send({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  } catch (e) { console.error('[Log]', e.message); }
}

function isHigherRole(member, target) {
  if (member.id === member.guild.ownerId) return true;
  return member.roles.highest.position > target.roles.highest.position;
}

function canModerate(member, target) {
  if (!member || !target) return false;
  if (member.id === member.guild.ownerId) return true;
  return member.roles.highest.position > target.roles.highest.position;
}

function secondsToTime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [d && `${d}ي`, h && `${h}س`, m && `${m}د`, sec && `${sec}ث`]
    .filter(Boolean).join(' ') || '0ث';
}

/* =========================================================
 * 5) تعريف أوامر السلاش
 * ========================================================= */
const commands = [
  // ---------- التوثيق ----------
  new SlashCommandBuilder().setName('توثيق')
    .setDescription('إنشاء لوحة التوثيق في السيرفر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ---------- الموسيقى ----------
  new SlashCommandBuilder().setName('تشغيل').setDescription('تشغيل أغنية من يوتيوب')
    .addStringOption(o => o.setName('بحث').setDescription('اسم الأغنية أو الرابط').setRequired(true)),
  new SlashCommandBuilder().setName('إيقاف_مؤقت').setDescription('إيقاف الأغنية مؤقتاً'),
  new SlashCommandBuilder().setName('استئناف').setDescription('استئناف التشغيل'),
  new SlashCommandBuilder().setName('تخطي').setDescription('تخطي الأغنية الحالية'),
  new SlashCommandBuilder().setName('إيقاف').setDescription('إيقاف التشغيل ومغادرة الروم'),
  new SlashCommandBuilder().setName('قائمة_التشغيل').setDescription('عرض قائمة التشغيل'),
  new SlashCommandBuilder().setName('مستوى_الصوت').setDescription('تغيير مستوى الصوت (1-100)')
    .addIntegerOption(o => o.setName('قيمة').setDescription('1 - 100').setRequired(true).setMinValue(1).setMaxValue(100)),

  // ---------- الفعاليات ----------
  new SlashCommandBuilder().setName('فعالية').setDescription('إنشاء فعالية / جيف أواي')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addStringOption(o => o.setName('جائزة').setDescription('الجائزة').setRequired(true))
    .addIntegerOption(o => o.setName('دقائق').setDescription('المدة بالدقائق').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('فائزين').setDescription('عدد الفائزين').setRequired(true).setMinValue(1).setMaxValue(20))
    .addChannelOption(o => o.setName('روم').setDescription('روم إرسال الفعالية').addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder().setName('إعادة_سحب').setDescription('إعادة سحب فائز في فعالية')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addStringOption(o => o.setName('معرف_الرسالة').setDescription('ID رسالة الفعالية').setRequired(true)),

  // ---------- الإدارة ----------
  new SlashCommandBuilder().setName('حظر').setDescription('حظر عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('سبب').setDescription('السبب')),
  new SlashCommandBuilder().setName('طرد').setDescription('طرد عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('سبب').setDescription('السبب')),
  new SlashCommandBuilder().setName('إسكات').setDescription('إسكات عضو (Timeout)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('دقائق').setDescription('المدة بالدقائق').setRequired(true).setMinValue(1).setMaxValue(10080))
    .addStringOption(o => o.setName('سبب').setDescription('السبب')),
  new SlashCommandBuilder().setName('فك_الإسكات').setDescription('إزالة الإسكات')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder().setName('مسح').setDescription('حذف رسائل')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('عدد').setDescription('1 - 100').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('قفل').setDescription('قفل الروم الحالي')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('فتح').setDescription('فتح الروم الحالي')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('إعطاء_رتبة').setDescription('إعطاء رتبة لعضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true))
    .addRoleOption(o => o.setName('رتبة').setDescription('الرتبة').setRequired(true)),
  new SlashCommandBuilder().setName('سحب_رتبة').setDescription('سحب رتبة من عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('عضو').setDescription('العضو').setRequired(true))
    .addRoleOption(o => o.setName('رتبة').setDescription('الرتبة').setRequired(true)),

  // ---------- الإذاعة ----------
  new SlashCommandBuilder().setName('إذاعة').setDescription('إرسال رسالة خاصة لجميع الأعضاء')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('رسالة').setDescription('نص الرسالة').setRequired(true)),

  // ---------- لوحة التذاكر ----------
  new SlashCommandBuilder().setName('تذاكر').setDescription('إنشاء لوحة التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ---------- الروم الصوتي المؤقت ----------
  new SlashCommandBuilder().setName('روم_مؤقت').setDescription('إنشاء روم "أنشئ رومك"')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ---------- الرد التلقائي ----------
  new SlashCommandBuilder().setName('رد_تلقائي').setDescription('إدارة الردود التلقائية')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('إضافة').setDescription('إضافة رد تلقائي')
      .addStringOption(o => o.setName('كلمة').setDescription('الكلمة المفتاحية').setRequired(true))
      .addStringOption(o => o.setName('رد').setDescription('الرد').setRequired(true)))
    .addSubcommand(s => s.setName('حذف').setDescription('حذف رد تلقائي')
      .addStringOption(o => o.setName('كلمة').setDescription('الكلمة').setRequired(true)))
    .addSubcommand(s => s.setName('قائمة').setDescription('عرض كل الردود'))
].map(c => c.toJSON());

/* =========================================================
 * 6) تسجيل الأوامر عند الجاهزية
 * ========================================================= */
client.once(Events.ClientReady, async () => {
  console.log(`\n🟢 MAX متصل: ${client.user.tag}`);
  console.log(`📡 السيرفرات: ${client.guilds.cache.size}`);
  client.user.setPresence({
    activities: [{ name: 'MAX | حماية وموسيقى', type: ActivityType.Watching }],
    status: 'online'
  });
  try {
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ تم تسجيل أوامر السلاش عالمياً');
  } catch (e) { console.error('❌ فشل تسجيل الأوامر:', e); }
});

/* =========================================================
 * 7) التوثيق التلقائي للعضو الجديد
 * ========================================================= */
client.on(Events.GuildMemberAdd, async member => {
  try {
    const guild = member.guild;
    const unverifiedName = CONFIG.verification.unverifiedRoleName;
    let role = guild.roles.cache.find(r => r.name === unverifiedName);
    if (!role) {
      role = await guild.roles.create({
        name: unverifiedName,
        color: 0x2b2d31,
        permissions: []
      }).catch(() => null);
    }
    if (role) await member.roles.add(role).catch(() => {});

    const logEmbed = infoEmbed('عضو جديد', `${member.user.tag} انضم إلى السيرفر\nالعدد: **${guild.memberCount}**`);
    await sendLog(guild, logEmbed);
  } catch (e) { console.error('[GuildMemberAdd]', e.message); }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    const logEmbed = warnEmbed('عضو غادر', `${member.user?.tag || 'غير معروف'} غادر السيرفر`);
    await sendLog(member.guild, logEmbed);
  } catch (e) { console.error('[GuildMemberRemove]', e.message); }
});

/* =========================================================
 * 8) معالج التفاعلات (أزرار + قوائم + أوامر)
 * ========================================================= */
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) return await handleSlash(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
  } catch (e) {
    console.error('[InteractionCreate]', e);
    try {
      await safeReply(interaction, {
        embeds: [errEmbed('حدث خطأ', 'تعذّر تنفيذ العملية.')], ephemeral: true
      });
    } catch (_) {}
  }
});

/* =========================================================
 * 9) معالج الأوامر
 * ========================================================= */
async function handleSlash(interaction) {
  const { commandName, guild, member, channel } = interaction;
  if (!guild) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'الأوامر داخل السيرفر فقط.')], ephemeral: true });

  /* -------- التوثيق -------- */
  if (commandName === 'توثيق') {
    await interaction.deferReply({ ephemeral: true });
    const g = guild;

    // كريت رتب التوثيق
    let verified = g.roles.cache.find(r => r.name === CONFIG.verification.roleName);
    if (!verified) verified = await g.roles.create({ name: CONFIG.verification.roleName, color: 0x57f287 }).catch(() => null);

    let unverified = g.roles.cache.find(r => r.name === CONFIG.verification.unverifiedRoleName);
    if (!unverified) unverified = await g.roles.create({ name: CONFIG.verification.unverifiedRoleName, color: 0x2b2d31 }).catch(() => null);

    // كريت روم التحقق
    let vChannel = g.channels.cache.find(c => c.name === CONFIG.verification.channelName && c.type === ChannelType.GuildText);
    if (!vChannel) {
      vChannel = await g.channels.create({
        name: CONFIG.verification.channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: g.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          unverified ? { id: unverified.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } : null,
          verified ? { id: verified.id, deny: [PermissionsBitField.Flags.ViewChannel] } : null
        ].filter(Boolean)
      }).catch(() => null);
    }

    // اخفاء كل الرومات عن غير الموثق
    if (unverified) {
      for (const [, ch] of g.channels.cache) {
        if (ch.id === vChannel?.id) continue;
        if (!ch.permissionOverwrites) continue;
        await ch.permissionOverwrites.edit(unverified, { ViewChannel: false }).catch(() => {});
      }
    }

    // إرسال لوحة التوثيق
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify_btn').setLabel('تحقق ✅').setStyle(ButtonStyle.Success)
    );
    await vChannel?.send({
      embeds: [infoEmbed('نظام التوثيق', 'اضغط على زر **تحقق** أدناه للحصول على رتبة التوثيق والوصول إلى السيرفر.')],
      components: [row]
    }).catch(() => {});

    return safeReply(interaction, { embeds: [okEmbed('تم', 'تم إعداد نظام التوثيق بنجاح.')] });
  }

  /* -------- الموسيقى -------- */
  if (commandName === 'تشغيل') return await musicPlay(interaction);
  if (commandName === 'إيقاف_مؤقت') return await musicPause(interaction);
  if (commandName === 'استئناف') return await musicResume(interaction);
  if (commandName === 'تخطي') return await musicSkip(interaction);
  if (commandName === 'إيقاف') return await musicStop(interaction);
  if (commandName === 'قائمة_التشغيل') return await musicQueue(interaction);
  if (commandName === 'مستوى_الصوت') return await musicVolume(interaction);

  /* -------- الفعاليات -------- */
  if (commandName === 'فعالية') return await createGiveaway(interaction);
  if (commandName === 'إعادة_سحب') return await rerollGiveaway(interaction);

  /* -------- الإدارة -------- */
  if (commandName === 'حظر') return await modBan(interaction);
  if (commandName === 'طرد') return await modKick(interaction);
  if (commandName === 'إسكات') return await modMute(interaction);
  if (commandName === 'فك_الإسكات') return await modUnmute(interaction);
  if (commandName === 'مسح') return await modClear(interaction);
  if (commandName === 'قفل') return await modLock(interaction);
  if (commandName === 'فتح') return await modUnlock(interaction);
  if (commandName === 'إعطاء_رتبة') return await modAddRole(interaction);
  if (commandName === 'سحب_رتبة') return await modRemoveRole(interaction);

  /* -------- الإذاعة -------- */
  if (commandName === 'إذاعة') return await broadcastDM(interaction);

  /* -------- التذاكر -------- */
  if (commandName === 'تذاكر') return await setupTickets(interaction);

  /* -------- الروم المؤقت -------- */
  if (commandName === 'روم_مؤقت') return await setupTempVoice(interaction);

  /* -------- الرد التلقائي -------- */
  if (commandName === 'رد_تلقائي') return await autoResponderManage(interaction);
}

/* =========================================================
 * 10) الأزرار والقوائم
 * ========================================================= */
async function handleButton(interaction) {
  const id = interaction.customId;

  // تحقق
  if (id === 'verify_btn') {
    const guild = interaction.guild;
    const verified = guild.roles.cache.find(r => r.name === CONFIG.verification.roleName);
    const unverified = guild.roles.cache.find(r => r.name === CONFIG.verification.unverifiedRoleName);
    if (!verified) return interaction.reply({ embeds: [errEmbed('خطأ', 'رتبة التوثيق غير موجودة.')], ephemeral: true });

    if (interaction.member.roles.cache.has(verified.id))
      return interaction.reply({ embeds: [warnEmbed('مسبقاً', 'أنت موثق بالفعل.')], ephemeral: true });

    try {
      await interaction.member.roles.add(verified);
      if (unverified) await interaction.member.roles.remove(unverified).catch(() => {});
      return interaction.reply({ embeds: [okEmbed('تم التوثيق', 'مرحباً بك في السيرفر! 🎉')], ephemeral: true });
    } catch {
      return interaction.reply({ embeds: [errEmbed('فشل', 'تعذّر إعطاء الرتبة. تأكد من صلاحيات البوت.')], ephemeral: true });
    }
  }

  // فعالية - مشاركة
  if (id.startsWith('giveaway_join_')) {
    const msgId = id.replace('giveaway_join_', '');
    const gw = DB.get(interaction.guildId, 'giveaways', {})[msgId];
    if (!gw || gw.ended)
      return interaction.reply({ embeds: [errEmbed('انتهت', 'هذه الفعالية انتهت.')], ephemeral: true });
    if (gw.participants.includes(interaction.user.id))
      return interaction.reply({ embeds: [warnEmbed('مسبقاً', 'أنت مشارك بالفعل.')], ephemeral: true });
    gw.participants.push(interaction.user.id);
    DB.set(interaction.guildId, 'giveaways', DB.get(interaction.guildId, 'giveaways', {}));
    return interaction.reply({ embeds: [okEmbed('تمت المشاركة', `تم تسجيلك في فعالية **${gw.prize}** 🎉`)], ephemeral: true });
  }

  // تذاكر - فتح
  if (id.startsWith('ticket_open_')) {
    const type = id.replace('ticket_open_', '');
    const guild = interaction.guild;
    const catName = CONFIG.tickets.categoryName;
    let category = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory }).catch(() => null);
    }
    const tCh = await guild.channels.create({
      name: `تذكرة-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    }).catch(() => null);
    if (!tCh) return interaction.reply({ embeds: [errEmbed('فشل', 'تعذّر إنشاء التذكرة.')], ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('إغلاق التذكرة 🔒').setStyle(ButtonStyle.Danger)
    );
    await tCh.send({
      content: `<@${interaction.user.id}>`,
      embeds: [infoEmbed(`تذكرة: ${type}`, 'يرجى وصف مشكلتك بالتفصيل وسيرد عليك الفريق قريباً.')],
      components: [row]
    });
    return interaction.reply({ embeds: [okEmbed('تم', `تم إنشاء تذكرتك: <#${tCh.id}>`)], ephemeral: true });
  }

  // إغلاق تذكرة
  if (id === 'ticket_close') {
    if (!interaction.channel.name.startsWith('تذكرة-'))
      return interaction.reply({ embeds: [errEmbed('خطأ', 'هذه ليست تذكرة.')], ephemeral: true });
    await interaction.reply({ embeds: [infoEmbed('إغلاق', 'سيتم إغلاق التذكرة خلال 5 ثوانٍ...')] });

    // Transcript
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const sorted = [...messages.values()].reverse();
      const text = sorted.map(m => `[${new Date(m.createdTimestamp).toLocaleString('ar')}] ${m.author.tag}: ${m.content}`).join('\n');
      const logCh = interaction.guild.channels.cache.find(c => c.name === CONFIG.tickets.logChannelName);
      if (logCh) {
        const buf = Buffer.from(text || 'لا يوجد محتوى', 'utf8');
        await logCh.send({ embeds: [infoEmbed('سجل تذكرة', `تذكرة: ${interaction.channel.name}`)], files: [{ attachment: buf, name: `${interaction.channel.name}.txt` }] }).catch(() => {});
      }
    } catch (e) { console.error('[Transcript]', e.message); }

    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
}

async function handleSelect(interaction) {
  if (interaction.customId === 'ticket_select') {
    const type = interaction.values[0];
    // نعيد استخدام زر الفتح
    const fake = { ...interaction, customId: `ticket_open_${type}` };
    // نبني يدوياً
    const guild = interaction.guild;
    const catName = CONFIG.tickets.categoryName;
    let category = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
    if (!category) category = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory }).catch(() => null);
    const tCh = await guild.channels.create({
      name: `تذكرة-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ]
    }).catch(() => null);
    if (!tCh) return interaction.reply({ embeds: [errEmbed('فشل', 'تعذّر إنشاء التذكرة.')], ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('إغلاق التذكرة 🔒').setStyle(ButtonStyle.Danger)
    );
    await tCh.send({
      content: `<@${interaction.user.id}>`,
      embeds: [infoEmbed(`تذكرة: ${type}`, 'يرجى وصف مشكلتك بالتفصيل.')],
      components: [row]
    });
    return interaction.reply({ embeds: [okEmbed('تم', `تم إنشاء تذكرتك: <#${tCh.id}>`)], ephemeral: true });
  }
}

/* =========================================================
 * 11) نظام الموسيقى
 * ========================================================= */
async function ensureVoice(interaction) {
  const vc = interaction.member.voice.channel;
  if (!vc) {
    await safeReply(interaction, { embeds: [errEmbed('خطأ', 'يجب أن تكون في روم صوتي.')], ephemeral: true });
    return null;
  }
  return vc;
}

function getQueue(guildId) {
  if (!client.musicQueues.has(guildId)) {
    client.musicQueues.set(guildId, {
      queue: [], current: null, player: null, connection: null, volume: 50
    });
  }
  return client.musicQueues.get(guildId);
}

async function musicPlay(interaction) {
  const vc = await ensureVoice(interaction);
  if (!vc) return;
  await interaction.deferReply();
  const query = interaction.options.getString('بحث');

  try {
    let url = query;
    let title = query;
    if (!playdl.yt_validate(query)) {
      const results = await playdl.search(query, { limit: 1 });
      if (!results.length) return safeReply(interaction, { embeds: [errEmbed('لا نتائج', 'لم يتم العثور على الأغنية.')] });
      url = results[0].url;
      title = results[0].title;
    } else {
      const info = await playdl.video_info(url).catch(() => null);
      if (info) title = info.video_details.title;
    }

    const st = getQueue(interaction.guildId);
    st.queue.push({ url, title, requester: interaction.user.id });

    if (!st.connection) {
      st.connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      st.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(st.connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(st.connection, VoiceConnectionStatus.Connecting, 5_000)
          ]);
        } catch {
          try { st.connection.destroy(); } catch {}
          st.connection = null;
          st.queue = []; st.current = null;
        }
      });

      st.player = createAudioPlayer();
      st.connection.subscribe(st.player);

      st.player.on(AudioPlayerStatus.Idle, () => playNext(interaction.guildId));
      st.player.on('error', err => { console.error('[Player]', err.message); playNext(interaction.guildId); });
    }

    if (!st.current) await playNext(interaction.guildId, true);

    return safeReply(interaction, { embeds: [okEmbed('تمت الإضافة', `**${title}** أُضيفت لقائمة التشغيل.`)] });
  } catch (e) {
    console.error('[musicPlay]', e);
    return safeReply(interaction, { embeds: [errEmbed('فشل التشغيل', e.message)] });
  }
}

async function playNext(guildId, silent = false) {
  const st = client.musicQueues.get(guildId);
  if (!st) return;
  if (!st.queue.length) {
    st.current = null;
    try { st.connection?.destroy(); } catch {}
    st.connection = null;
    return;
  }
  const next = st.queue.shift();
  st.current = next;
  try {
    const stream = await playdl.stream(next.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });
    resource.volume?.setVolume(st.volume / 100);
    st.player.play(resource);
  } catch (e) {
    console.error('[playNext]', e.message);
    return playNext(guildId, silent);
  }
}

async function musicPause(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st?.player) return safeReply(i, { embeds: [errEmbed('خطأ', 'لا يوجد تشغيل حالي.')], ephemeral: true });
  st.player.pause();
  return safeReply(i, { embeds: [okEmbed('تم', 'تم الإيقاف المؤقت.')] });
}
async function musicResume(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st?.player) return safeReply(i, { embeds: [errEmbed('خطأ', 'لا يوجد تشغيل حالي.')], ephemeral: true });
  st.player.unpause();
  return safeReply(i, { embeds: [okEmbed('تم', 'تم الاستئناف.')] });
}
async function musicSkip(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st?.player) return safeReply(i, { embeds: [errEmbed('خطأ', 'لا يوجد تشغيل حالي.')], ephemeral: true });
  st.player.stop();
  return safeReply(i, { embeds: [okEmbed('تم', 'تم التخطي.')] });
}
async function musicStop(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st) return safeReply(i, { embeds: [errEmbed('خطأ', 'لا يوجد تشغيل حالي.')], ephemeral: true });
  st.queue = []; st.current = null;
  try { st.player?.stop(); st.connection?.destroy(); } catch {}
  client.musicQueues.delete(i.guildId);
  return safeReply(i, { embeds: [okEmbed('تم', 'تم إيقاف التشغيل.')] });
}
async function musicQueue(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st || (!st.current && !st.queue.length))
    return safeReply(i, { embeds: [infoEmbed('قائمة التشغيل', 'القائمة فارغة.')] });
  const lines = [];
  if (st.current) lines.push(`▶️ **الآن:** ${st.current.title}`);
  st.queue.forEach((t, idx) => lines.push(`**${idx + 1}.** ${t.title}`));
  return safeReply(i, { embeds: [infoEmbed('قائمة التشغيل', lines.join('\n'))] });
}
async function musicVolume(i) {
  const st = client.musicQueues.get(i.guildId);
  if (!st) return safeReply(i, { embeds: [errEmbed('خطأ', 'لا يوجد تشغيل حالي.')], ephemeral: true });
  const v = i.options.getInteger('قيمة');
  st.volume = v;
  // note: تطبيقه مباشرة يحتاج الوصول للمورد، نكتفي بحفظه للأغنية القادمة
  return safeReply(i, { embeds: [okEmbed('تم', `مستوى الصوت: **${v}%**`)] });
}

/* =========================================================
 * 12) الفعاليات / الجيف أواي
 * ========================================================= */
async function createGiveaway(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const prize = interaction.options.getString('جائزة');
  const minutes = interaction.options.getInteger('دقائق');
  const winners = interaction.options.getInteger('فائزين');
  const ch = interaction.options.getChannel('روم') || interaction.channel;
  const endsAt = Date.now() + minutes * 60_000;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_join_placeholder').setLabel('المشاركة في الفعالية 🎉').setStyle(ButtonStyle.Primary)
  );

  const msg = await ch.send({
    embeds: [
      infoEmbed(`🎉 فعالية: ${prize}`,
        `**الجائزة:** ${prize}\n**عدد الفائزين:** ${winners}\n**ينتهي:** <t:${Math.floor(endsAt / 1000)}:R>\n\nاضغط زر المشاركة!`)
    ],
    components: [row]
  });

  // نحدّث الـ customId ليكون فيه ID الرسالة
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_join_${msg.id}`).setLabel('المشاركة في الفعالية 🎉').setStyle(ButtonStyle.Primary)
  );
  await msg.edit({ components: [row2] }).catch(() => {});

  const all = DB.get(interaction.guildId, 'giveaways', {});
  all[msg.id] = { prize, winners, endsAt, participants: [], ended: false, channelId: ch.id };
  DB.set(interaction.guildId, 'giveaways', all);

  setTimeout(() => endGiveaway(interaction.guildId, msg.id).catch(() => {}), minutes * 60_000);

  return safeReply(interaction, { embeds: [okEmbed('تم', `تم إنشاء الفعالية في <#${ch.id}>`)] });
}

async function endGiveaway(guildId, msgId) {
  const all = DB.get(guildId, 'giveaways', {});
  const gw = all[msgId];
  if (!gw || gw.ended) return;
  gw.ended = true;
  DB.set(guildId, 'giveaways', all);

  const guild = client.guilds.cache.get(guildId);
  const ch = guild?.channels.cache.get(gw.channelId);
  if (!ch) return;
  const msg = await ch.messages.fetch(msgId).catch(() => null);
  if (!msg) return;

  let winners = [];
  if (gw.participants.length) {
    const pool = [...gw.participants];
    for (let i = 0; i < gw.winners && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      winners.push(pool.splice(idx, 1)[0]);
    }
  }

  const desc = winners.length
    ? `**الجائزة:** ${gw.prize}\n**الفائزون:** ${winners.map(w => `<@${w}>`).join(', ')}`
    : `**الجائزة:** ${gw.prize}\nلا يوجد فائزون (لا مشاركات).`;

  await msg.edit({
    embeds: [okEmbed('🎉 انتهت الفعالية', desc)],
    components: []
  }).catch(() => {});
  if (winners.length) await ch.send({ content: `🎊 مبروك ${winners.map(w => `<@${w}>`).join(', ')}! فزتم بـ **${gw.prize}**` }).catch(() => {});
}

async function rerollGiveaway(interaction) {
  const msgId = interaction.options.getString('معرف_الرسالة');
  const all = DB.get(interaction.guildId, 'giveaways', {});
  const gw = all[msgId];
  if (!gw) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'لم يتم العثور على الفعالية.')], ephemeral: true });
  if (!gw.participants.length) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'لا يوجد مشاركون.')], ephemeral: true });

  const pool = [...gw.participants];
  const winners = [];
  for (let i = 0; i < gw.winners && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  return safeReply(interaction, { embeds: [okEmbed('إعادة سحب', `الفائزون الجدد: ${winners.map(w => `<@${w}>`).join(', ')}`)] });
}

/* =========================================================
 * 13) الإدارة
 * ========================================================= */
async function modBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers))
    return safeReply(interaction, { embeds: [errEmbed('صلاحيات', 'لا تملك صلاحية الحظر.')], ephemeral: true });
  const user = interaction.options.getUser('عضو');
  const reason = interaction.options.getString('سبب') || 'بدون سبب';
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (target && !canModerate(interaction.member, target))
    return safeReply(interaction, { embeds: [errEmbed('تسلسل الرتب', 'لا يمكنك حظر عضو برتبة أعلى أو مساوية.')], ephemeral: true });
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers))
    return safeReply(interaction, { embeds: [errEmbed('صلاحيات البوت', 'البوت لا يملك صلاحية الحظر.')], ephemeral: true });

  await interaction.guild.members.ban(user.id, { reason }).catch(e => {
    return safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true });
  });
  await sendLog(interaction.guild, errEmbed('حظر عضو', `**العضو:** ${user.tag}\n**بواسطة:** ${interaction.user.tag}\n**السبب:** ${reason}`));
  return safeReply(interaction, { embeds: [okEmbed('تم الحظر', `${user.tag} تم حظره.\nالسبب: ${reason}`)] });
}

async function modKick(interaction) {
  const user = interaction.options.getUser('عضو');
  const reason = interaction.options.getString('سبب') || 'بدون سبب';
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'العضو غير موجود.')], ephemeral: true });
  if (!canModerate(interaction.member, target))
    return safeReply(interaction, { embeds: [errEmbed('تسلسل الرتب', 'لا يمكنك طرد عضو برتبة أعلى أو مساوية.')], ephemeral: true });
  if (!target.kickable)
    return safeReply(interaction, { embeds: [errEmbed('خطأ', 'لا يمكن طرد هذا العضو.')], ephemeral: true });

  await target.kick(reason).catch(e => safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true }));
  await sendLog(interaction.guild, errEmbed('طرد عضو', `**العضو:** ${user.tag}\n**بواسطة:** ${interaction.user.tag}\n**السبب:** ${reason}`));
  return safeReply(interaction, { embeds: [okEmbed('تم الطرد', `${user.tag} تم طرده.`)] });
}

async function modMute(interaction) {
  const user = interaction.options.getUser('عضو');
  const minutes = interaction.options.getInteger('دقائق');
  const reason = interaction.options.getString('سبب') || 'بدون سبب';
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'العضو غير موجود.')], ephemeral: true });
  if (!canModerate(interaction.member, target))
    return safeReply(interaction, { embeds: [errEmbed('تسلسل الرتب', 'لا يمكنك إسكات عضو برتبة أعلى.')], ephemeral: true });
  if (!target.moderatable)
    return safeReply(interaction, { embeds: [errEmbed('خطأ', 'لا يمكن إسكات هذا العضو.')], ephemeral: true });

  await target.timeout(minutes * 60_000, reason).catch(e => safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true }));
  await sendLog(interaction.guild, warnEmbed('إسكات عضو', `**العضو:** ${user.tag}\n**المدة:** ${minutes} دقيقة\n**بواسطة:** ${interaction.user.tag}\n**السبب:** ${reason}`));
  return safeReply(interaction, { embeds: [okEmbed('تم الإسكات', `${user.tag} تم إسكاته لمدة ${minutes} دقيقة.`)] });
}

async function modUnmute(interaction) {
  const user = interaction.options.getUser('عضو');
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'العضو غير موجود.')], ephemeral: true });
  await target.timeout(null).catch(() => {});
  return safeReply(interaction, { embeds: [okEmbed('تم', `${user.tag} تم فك الإسكات عنه.`)] });
}

async function modClear(interaction) {
  const count = interaction.options.getInteger('عدد');
  await interaction.channel.bulkDelete(count, true).catch(e =>
    safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true })
  );
  return safeReply(interaction, { embeds: [okEmbed('تم', `تم حذف ${count} رسالة.`)] });
}

async function modLock(interaction) {
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }).catch(() => {});
  return safeReply(interaction, { embeds: [okEmbed('تم القفل', 'تم قفل الروم.')] });
}
async function modUnlock(interaction) {
  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }).catch(() => {});
  return safeReply(interaction, { embeds: [okEmbed('تم الفتح', 'تم فتح الروم.')] });
}

async function modAddRole(interaction) {
  const user = interaction.options.getUser('عضو');
  const role = interaction.options.getRole('رتبة');
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'العضو غير موجود.')], ephemeral: true });
  if (role.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId)
    return safeReply(interaction, { embeds: [errEmbed('تسلسل الرتب', 'لا يمكنك إعطاء رتبة أعلى أو مساوية لرتبتك.')], ephemeral: true });
  if (role.position >= interaction.guild.members.me.roles.highest.position)
    return safeReply(interaction, { embeds: [errEmbed('تسلسل البوت', 'رتبة البوت أقل من هذه الرتبة.')], ephemeral: true });

  await target.roles.add(role).catch(e => safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true }));
  await sendLog(interaction.guild, infoEmbed('إعطاء رتبة', `**العضو:** ${user.tag}\n**الرتبة:** ${role.name}\n**بواسطة:** ${interaction.user.tag}`));
  return safeReply(interaction, { embeds: [okEmbed('تم', `تم إعطاء ${role.name} إلى ${user.tag}.`)] });
}

async function modRemoveRole(interaction) {
  const user = interaction.options.getUser('عضو');
  const role = interaction.options.getRole('رتبة');
  const target = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!target) return safeReply(interaction, { embeds: [errEmbed('خطأ', 'العضو غير موجود.')], ephemeral: true });
  if (role.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId)
    return safeReply(interaction, { embeds: [errEmbed('تسلسل الرتب', 'لا يمكنك سحب رتبة أعلى أو مساوية لرتبتك.')], ephemeral: true });

  await target.roles.remove(role).catch(e => safeReply(interaction, { embeds: [errEmbed('فشل', e.message)], ephemeral: true }));
  await sendLog(interaction.guild, infoEmbed('سحب رتبة', `**العضو:** ${user.tag}\n**الرتبة:** ${role.name}\n**بواسطة:** ${interaction.user.tag}`));
  return safeReply(interaction, { embeds: [okEmbed('تم', `تم سحب ${role.name} من ${user.tag}.`)] });
}

/* =========================================================
 * 14) الإذاعة في الخاص
 * ========================================================= */
async function broadcastDM(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const message = interaction.options.getString('رسالة');
  await interaction.guild.members.fetch();
  const members = interaction.guild.members.cache.filter(m => !m.user.bot);
  let sent = 0, failed = 0;

  for (const [, m] of members) {
    try {
      await m.send({ embeds: [infoEmbed('📢 رسالة من ' + interaction.guild.name, message)] });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 1200)); // rate limit
  }
  return safeReply(interaction, { embeds: [okEmbed('تمت الإذاعة', `تم الإرسال: **${sent}**\nفشل: **${failed}**`)] });
}

/* =========================================================
 * 15) التذاكر
 * ========================================================= */
async function setupTickets(interaction) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select')
    .setPlaceholder('اختر نوع التذكرة...')
    .addOptions([
      { label: 'دعم عام', value: 'دعم-عام', emoji: '🛠️' },
      { label: 'شكوى', value: 'شكوى', emoji: '⚠️' },
      { label: 'مبيعات', value: 'مبيعات', emoji: '💰' }
    ]);
  const row = new ActionRowBuilder().addComponents(menu);
  await interaction.channel.send({
    embeds: [infoEmbed('نظام التذاكر', 'اختر نوع التذكرة من القائمة أدناه لفتح تذكرة جديدة.')],
    components: [row]
  });
  return safeReply(interaction, { embeds: [okEmbed('تم', 'تم إرسال لوحة التذاكر.')], ephemeral: true });
}

/* =========================================================
 * 16) الروم الصوتي المؤقت
 * ========================================================= */
async function setupTempVoice(interaction) {
  const guild = interaction.guild;
  const catName = CONFIG.tempVoice.categoryName;
  let category = guild.channels.cache.find(c => c.name === catName && c.type === ChannelType.GuildCategory);
  if (!category) category = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory }).catch(() => null);

  const ch = await guild.channels.create({
    name: CONFIG.tempVoice.channelName,
    type: ChannelType.GuildVoice,
    parent: category?.id
  }).catch(() => null);

  if (!ch) return safeReply(interaction, { embeds: [errEmbed('فشل', 'تعذّر إنشاء الروم.')], ephemeral: true });

  DB.set(guild.id, 'tempVoiceRoot', ch.id);
  return safeReply(interaction, { embeds: [okEmbed('تم', `تم إنشاء روم: <#${ch.id}>`)] });
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild = newState.guild;
    const rootId = DB.get(guild.id, 'tempVoiceRoot');
    if (!rootId) return;

    // دخول روم الإنشاء
    if (newState.channelId === rootId) {
      const member = newState.member;
      const parent = newState.channel.parentId;
      const newCh = await guild.channels.create({
        name: `🔊 ${member.user.username}`.slice(0, 90),
        type: ChannelType.GuildVoice,
        parent
      }).catch(() => null);
      if (!newCh) return;
      client.tempVoice.set(newCh.id, member.id);
      await member.voice.setChannel(newCh).catch(() => {});

      // لوحة تحكم بسيطة
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tv_lock').setLabel('قفل 🔒').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tv_unlock').setLabel('فتح 🔓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tv_hide').setLabel('إخفاء 🙈').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tv_delete').setLabel('حذف 🗑️').setStyle(ButtonStyle.Danger)
      );
      await newCh.send({ embeds: [infoEmbed('رومك الخاص', `مرحباً <@${member.id}>، هذا رومك الخاص.`)], components: [row] }).catch(() => {});
    }

    // حذف الروم عند الفراغ
    if (oldState.channelId && client.tempVoice.has(oldState.channelId)) {
      const ch = guild.channels.cache.get(oldState.channelId);
      if (ch && ch.members.size === 0) {
        client.tempVoice.delete(ch.id);
        await ch.delete().catch(() => {});
      }
    }
  } catch (e) { console.error('[VoiceStateUpdate]', e.message); }
});

// أزرار الروم المؤقت
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  const id = interaction.customId;
  if (!id.startsWith('tv_')) return;
  const ch = interaction.channel;
  const owner = client.tempVoice.get(ch?.id);
  if (!owner) return;
  if (interaction.user.id !== owner)
    return interaction.reply({ embeds: [errEmbed('خطأ', 'هذا الروم ليس لك.')], ephemeral: true });

  try {
    if (id === 'tv_lock') {
      await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
      return interaction.reply({ embeds: [okEmbed('تم', 'تم قفل الروم.')], ephemeral: true });
    }
    if (id === 'tv_unlock') {
      await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: null });
      return interaction.reply({ embeds: [okEmbed('تم', 'تم فتح الروم.')], ephemeral: true });
    }
    if (id === 'tv_hide') {
      await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false });
      return interaction.reply({ embeds: [okEmbed('تم', 'تم إخفاء الروم.')], ephemeral: true });
    }
    if (id === 'tv_delete') {
      client.tempVoice.delete(ch.id);
      await interaction.reply({ embeds: [okEmbed('تم', 'سيتم حذف الروم.')], ephemeral: true });
      setTimeout(() => ch.delete().catch(() => {}), 1000);
    }
  } catch (e) {
    return interaction.reply({ embeds: [errEmbed('فشل', e.message)], ephemeral: true }).catch(() => {});
  }
});

/* =========================================================
 * 17) الرد التلقائي + الحماية من السبام
 * ========================================================= */
client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const content = message.content;

    // ---- الردود التلقائية ----
    const ars = DB.get(message.guild.id, 'autoResponders', []);
    for (const ar of ars) {
      if (content.toLowerCase().includes(ar.keyword.toLowerCase())) {
        await message.reply({ content: ar.response }).catch(() => {});
        break;
      }
    }

    // ---- Automod ----
    const member = message.member;
    if (!member) return;
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    // ممنوع روابط / دعوات
    const inviteRegex = /(discord\.gg\/|discord\.com\/invite\/)/i;
    const linkRegex = /https?:\/\/\S+/i;
    if ((CONFIG.automod.antiInvites && inviteRegex.test(content)) ||
        (CONFIG.automod.antiLinks && linkRegex.test(content))) {
      await message.delete().catch(() => {});
      const warn = await message.channel.send({ embeds: [warnEmbed('تحذير', `${message.author}, يُمنع نشر الروابط هنا.`)] }).catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }

    // كلمات محظورة
    if (CONFIG.automod.blockedWords.some(w => content.toLowerCase().includes(w.toLowerCase()))) {
      await message.delete().catch(() => {});
      return;
    }

    // ---- Anti-Spam ----
    if (CONFIG.antiSpam.enabled) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const arr = (client.spamMap.get(key) || []).filter(t => now - t < CONFIG.antiSpam.timeWindow);
      arr.push(now);
      client.spamMap.set(key, arr);
      if (arr.length >= CONFIG.antiSpam.maxMessages) {
        client.spamMap.set(key, []);
        if (member.moderatable) {
          await member.timeout(CONFIG.antiSpam.muteDuration, 'سبام').catch(() => {});
          const warn = await message.channel.send({ embeds: [warnEmbed('سبام', `${message.author} تم إسكاته لمدة دقيقة بسبب السبام.`)] }).catch(() => null);
          if (warn) setTimeout(() => warn.delete().catch(() => {}), 7000);
        }
      }
    }
  } catch (e) { console.error('[MessageCreate]', e.message); }
});

async function autoResponderManage(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const ars = DB.get(guildId, 'autoResponders', []);

  if (sub === 'إضافة') {
    const k = interaction.options.getString('كلمة');
    const r = interaction.options.getString('رد');
    if (ars.some(a => a.keyword.toLowerCase() === k.toLowerCase()))
      return safeReply(interaction, { embeds: [errEmbed('موجود', 'هذه الكلمة مضافة مسبقاً.')], ephemeral: true });
    ars.push({ keyword: k, response: r });
    DB.set(guildId, 'autoResponders', ars);
    return safeReply(interaction, { embeds: [okEmbed('تم', `تم إضافة الرد التلقائي لـ \`${k}\``)], ephemeral: true });
  }
  if (sub === 'حذف') {
    const k = interaction.options.getString('كلمة');
    const filtered = ars.filter(a => a.keyword.toLowerCase() !== k.toLowerCase());
    DB.set(guildId, 'autoResponders', filtered);
    return safeReply(interaction, { embeds: [okEmbed('تم', `تم حذف الرد المرتبط بـ \`${k}\``)], ephemeral: true });
  }
  if (sub === 'قائمة') {
    if (!ars.length) return safeReply(interaction, { embeds: [infoEmbed('قائمة الردود', 'لا يوجد ردود.')] });
    const lines = ars.map((a, i) => `**${i + 1}.** \`${a.keyword}\` → ${a.response}`);
    return safeReply(interaction, { embeds: [infoEmbed('قائمة الردود التلقائية', lines.join('\n'))] });
  }
}

/* =========================================================
 * 18) نظام الحماية Anti-Nuke + السجلات
 * ========================================================= */
function trackNuke(guildId, userId, action) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const rec = client.antiNuke.get(key) || { channelDelete: [], roleDelete: [], ban: [], kick: [], channelCreate: [] };
  rec[action] = (rec[action] || []).filter(t => now - t < CONFIG.antiNuke.timeWindow);
  rec[action].push(now);
  client.antiNuke.set(key, rec);
  return rec[action].length;
}

async function punishNuke(guild, userId, action, count) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    if (member.id === guild.ownerId) return;

    await sendLog(guild, errEmbed('🚨 Anti-Nuke',
      `**العضو:** ${member.user.tag}\n**العملية:** ${action}\n**العدد:** ${count}\n**الإجراء:** سحب جميع الرتب`));

    // سحب كل الرتب القابلة للسحب
    const removable = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id && r.editable && r.position < guild.members.me.roles.highest.position);
    await member.roles.remove(removable).catch(() => {});

    // Timeout احتياطي
    if (member.moderatable) await member.timeout(24 * 60 * 60_000, 'Anti-Nuke').catch(() => {});
  } catch (e) { console.error('[punishNuke]', e.message); }
}

client.on(Events.ChannelDelete, async channel => {
  try {
    const guild = channel.guild;
    if (!CONFIG.antiNuke.enabled) return;
    const entry = await guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
    const exec = entry?.entries.first()?.executor;
    if (!exec || exec.bot) return;
    if (exec.id === guild.ownerId) return;
    const count = trackNuke(guild.id, exec.id, 'channelDelete');
    if (count >= CONFIG.antiNuke.limits.channelDelete) await punishNuke(guild, exec.id, 'حذف قنوات', count);
    await sendLog(guild, warnEmbed('حذف قناة', `**القناة:** ${channel.name}\n**بواسطة:** ${exec.tag}`));
  } catch (e) { console.error('[ChannelDelete]', e.message); }
});

client.on(Events.ChannelCreate, async channel => {
  try {
    const guild = channel.guild;
    if (!CONFIG.antiNuke.enabled) return;
    const entry = await guild.fetchAuditLogs({ type: 10, limit: 1 }).catch(() => null);
    const exec = entry?.entries.first()?.executor;
    if (!exec || exec.bot || exec.id === guild.ownerId) return;
    const count = trackNuke(guild.id, exec.id, 'channelCreate');
    if (count >= CONFIG.antiNuke.limits.channelCreate) await punishNuke(guild, exec.id, 'إنشاء قنوات', count);
  } catch (e) { console.error('[ChannelCreate]', e.message); }
});

client.on(Events.GuildRoleDelete, async role => {
  try {
    const guild = role.guild;
    if (!CONFIG.antiNuke.enabled) return;
    const entry = await guild.fetchAuditLogs({ type: 32, limit: 1 }).catch(() => null);
    const exec = entry?.entries.first()?.executor;
    if (!exec || exec.bot || exec.id === guild.ownerId) return;
    const count = trackNuke(guild.id, exec.id, 'roleDelete');
    if (count >= CONFIG.antiNuke.limits.roleDelete) await punishNuke(guild, exec.id, 'حذف رتب', count);
    await sendLog(guild, warnEmbed('حذف رتبة', `**الرتبة:** ${role.name}\n**بواسطة:** ${exec.tag}`));
  } catch (e) { console.error('[GuildRoleDelete]', e.message); }
});

client.on(Events.GuildBanAdd, async ban => {
  try {
    const guild = ban.guild;
    if (!CONFIG.antiNuke.enabled) return;
    const entry = await guild.fetchAuditLogs({ type: 22, limit: 1 }).catch(() => null);
    const exec = entry?.entries.first()?.executor;
    if (!exec || exec.bot || exec.id === guild.ownerId) return;
    const count = trackNuke(guild.id, exec.id, 'ban');
    if (count >= CONFIG.antiNuke.limits.ban) await punishNuke(guild, exec.id, 'حظر أعضاء', count);
  } catch (e) { console.error('[GuildBanAdd]', e.message); }
});

/* =========================================================
 * 19) سجلات إضافية: الرسائل والرتب والصوت
 * ========================================================= */
client.on(Events.MessageDelete, async msg => {
  try {
    if (!msg.guild || msg.author?.bot) return;
    await sendLog(msg.guild, errEmbed('حذف رسالة',
      `**صاحب الرسالة:** ${msg.author?.tag || 'غير معروف'}\n**الروم:** <#${msg.channel.id}>\n**المحتوى:** ${(msg.content || '—').slice(0, 1000)}`));
  } catch (e) { /* ignore */ }
});

client.on(Events.MessageUpdate, async (oldM, newM) => {
  try {
    if (!newM.guild || newM.author?.bot) return;
    if (oldM.content === newM.content) return;
    await sendLog(newM.guild, warnEmbed('تعديل رسالة',
      `**صاحب الرسالة:** ${newM.author?.tag}\n**الروم:** <#${newM.channel.id}>\n**قبل:** ${(oldM.content || '—').slice(0, 500)}\n**بعد:** ${(newM.content || '—').slice(0, 500)}`));
  } catch (e) { /* ignore */ }
});

client.on(Events.GuildMemberUpdate, async (oldM, newM) => {
  try {
    if (oldM.roles.cache.size !== newM.roles.cache.size) {
      const added = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id));
      const removed = oldM.roles.cache.filter(r => !newM.roles.cache.has(r.id));
      const parts = [];
      if (added.size) parts.push(`**أُضيفت:** ${added.map(r => r.name).join(', ')}`);
      if (removed.size) parts.push(`**أُزيلت:** ${removed.map(r => r.name).join(', ')}`);
      if (parts.length) await sendLog(newM.guild, infoEmbed('تحديث رتب', `**العضو:** ${newM.user.tag}\n${parts.join('\n')}`));
    }
  } catch (e) { /* ignore */ }
});

/* =========================================================
 * 20) معالجة الأخطاء العامة
 * ========================================================= */
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
process.on('uncaughtException', err => console.error('[uncaughtException]', err));
client.on(Events.Error, err => console.error('[Client Error]', err));
client.on(Events.Warn, info => console.warn('[Client Warn]', info));

/* =========================================================
 * 21) تسجيل الدخول
 * ========================================================= */
client.login(CONFIG.token).catch(err => {
  console.error('❌ فشل تسجيل الدخول:', err.message);
  process.exit(1);
});
