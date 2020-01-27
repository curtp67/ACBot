/*
* Libraries
*/
const Telegraf = require('telegraf');
const restify = require('restify');
const fs = require('fs');
const mongoose = require('mongoose');
const TelegrafInlineMenu = require('telegraf-inline-menu');
const NodeCache = require( "node-cache" );
const vCardsJS = require('vcards-js');
const CookieParser = require('restify-cookies');

/*
* Config / Internal Imports
*/
const config = require('./config.json');
const GraphMain = require('./Graph/GraphMain.js');
const SharePoint = require('./Graph/SharePoint.js');
const Calendar = require('./Graph/Calendar.js');
const Delve = require('./Graph/Delve.js');
const Outlook = require('./Graph/Outlook.js');
const Vorstand = require('./Bot/Vorstand.js');
const Unifi = require('./Bot/Unifi.js');

const bot = new Telegraf(config.bot.token);

const httpServer = restify.createServer({
    name: config.name,
    version: config.version,
    certificate: fs.readFileSync(config.restify.certificate),
    key: fs.readFileSync(config.restify.key)
});

const graphMain = new GraphMain(sendMessage);
const sharePoint = new SharePoint("root", graphMain);
const calendar = new Calendar(graphMain);
const delve = new Delve(graphMain);
const outlook = new Outlook(graphMain);
const botCache = new NodeCache();
const vorstand = new Vorstand(sharePoint, delve);
const unifi = new Unifi();

process.env.TZ = config.calendar.timezone;
/*
* Init Routes
*/
unifi.init();

mongoose.connect(config.mongodb.uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).catch(err => console.error(err));

mongoose.connection.on('connected', () => console.info('Connected Mongodb'));
//TODO: Add Webhook for Bot instead of polling

httpServer.use(restify.plugins.bodyParser());
httpServer.use(CookieParser.parse);

httpServer.get('/api', async function(req, res, next) {
    try {
        await graphMain.authCallback(req, res, next);
    } catch(err) {
        console.error("Login Error: "+ err);
    }
});

httpServer.post('/apiCallback', async function(req, res, next) {
    try {
        await graphMain.authFormCallback(req, res, next);
    } catch(err) {
        console.error("Login Error: "+ err);
    }
});

httpServer.get('/', async function(req, res, next) {
    res.send("OK.");
    next();
});

const dateRegex = new RegExp('([12]\\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01]))');
const timeRegex = new RegExp('([0-9]{2}:[0-9]{2})');

/*
* Body
*/
async function login(ctx) {
    ctx.reply("Herzlich Willkommen beim ACBot 2.0! Um den Bot verwenden zu können, musst du dich mit dem folgenden Link authentifizieren: " + graphMain.login(ctx.chat.id)
        + "\nDu wirst nach erfolgreicher Authentifizierung benachrichtigt.\n\nDeine Telegram-ID ist " + ctx.chat.id);
}

async function getOwnProfile(ctx) {
    ctx.reply(await delve.getOwnProfile(ctx.chat.id));
}

async function getUserDetails(ctx) {
    await graphMain.checkPerm(ctx.chat.id);
    ctx.reply(await unifi.getClientDevicesString());
}

async function sendMessage(chatID, message) {
    if (chatID) {
        await bot.telegram.sendMessage(chatID, message);
    } else {
        throw "No Chat ID";
    }
}

bot.on('inline_query', searchMembers); // For some reason here?

async function searchMembers(ctx) {
    //TODO: Cache searches (Telegram does automatically?)
    try {
        let parameters = {};
        let resultTop = 5;
        let resultContacts = [];
        let requestString = ctx.inlineQuery.query;
        let offset = ctx.inlineQuery.offset;

        requestString = encodeURI(requestString); // Encode for Umlauts
        parameters.selection = ["Nachname","Vorname","Handynummer","id","mail"];
        parameters.filter = "(fields/Status ne 'ehemaliges Mitglied' and fields/Status ne 'ehemaliger Anw%C3%A4rter') and (startswith(fields/Nachname,'" + requestString +"') or startswith(fields/Title,'" + requestString + "'))";
        parameters.expand = ["Nachname","Vorname","Handynummer","mail"];
        parameters.topNum = resultTop; //Limit number of results
        parameters.orderby = ["fields/Status"];
        parameters.getAll = true;

        if (offset) {
            parameters.skiptoken = offset;
        }
        let result = await sharePoint.getListItems("Mitglieder", ctx.inlineQuery.from.id, parameters);
        if(result.data["@odata.nextLink"]) {
            offset = result.data["@odata.nextLink"].split("skiptoken=")[1]; //Set offset to next token if found
        } else {
            offset = "";
        }

        let contacts = result.data.value;

        for(let i = 0; i < contacts.length; i++) {
            if(contacts[i].fields.Handynummer) {
                let vcard = new vCardsJS();
                vcard.firstName = contacts[i].fields.Vorname;
                vcard.lastName = contacts[i].fields.Nachname;
                vcard.workEmail = contacts[i].fields.mail;
                vcard.cellPhone = contacts[i].fields.Handynummer;
                vcard.organization = "Academy Consult";
                resultContacts.push({
                    type: "contact",
                    id: contacts[i].id, //TODO: Is this info redundant?
                    first_name: contacts[i].fields.Vorname,
                    last_name: contacts[i].fields.Nachname,
                    phone_number: contacts[i].fields.Handynummer,
                    vcard: vcard.getFormattedString()
                });
            }
        }

        // Using context shortcut
        await ctx.answerInlineQuery(resultContacts, {is_personal: true, next_offset: offset});
    } catch (err) {
        handleInlineError(err,ctx);
    }
}

function getCalCache(chatID) {
    var data = botCache.get(chatID);
    if(!data) {
        data = {
            rooms: [...config.calendar.rooms],
            startTime: "12:00",
            endTime: "17:00",
            subject: "Freedom",
            schedToggle: false,
            dayOffset: 0,
            eventDayOffset: 0,
            suggestions: []
        };
        botCache.set(chatID, data, 900);
    }
    return data;
}

function handleError(err,ctx) {
    switch (err) {
        case "No token":
            ctx.reply("Leider ist für diesen Chat noch keinen Token vorhanden. Verwende bitte diesen Link, um dich zu authentifizieren: " + graphMain.login(ctx.chat.id));
            break;
        case "Refresh Token Failed":
            ctx.reply("Leider ist der Token für diesen Chat nicht mehr gültig. Die erneute Authentifizierung ist alle 6 Monate notwendig; dies dient deiner eigenen Sicherheit. Verwende bitte diesen Link, um dich zu authentifizieren: " + graphMain.login(ctx.chat.id));
            break;
        case "Calendar1":
            ctx.reply("Fehler: Weder End- noch Startzeit darf in der Vergangheit liegen!");
            break;
        case "Assembly1":
            ctx.reply("Fehler: Es wurde noch keine JHV gestartet.");
            break;
        default:
            console.error(err);
            ctx.reply("Leider ist ein Fehler aufgetreten: " + err);
    }
}

function handleInlineError(err,ctx) {
    //Not returned due to frequent and (relatively) irrelevant 400 Telegram errors
    //ChatID for error message cannot be resovled
    console.error("Inline Query Error" + err);
}

//Menu Reservation

const resMenu = new TelegrafInlineMenu(async function(ctx) {
    try {
        const data = getCalCache(ctx.chat.id);
        if (data.rooms.length === 0) (data.rooms = config.calendar.rooms);
        let roomList = data.rooms.join(",");
        const startDate = new Date();
        startDate.setHours(0, 0, 0);
        startDate.setDate(startDate.getDate() + data.dayOffset);
        const endDate = new Date();
        endDate.setHours(0, 0, 0);
        endDate.setDate(endDate.getDate() + data.dayOffset + 1);

        const sugData = await calendar.getOptAvalSchedule(ctx.chat.id, startDate, endDate, data.rooms);
        data.suggestions = sugData;
        botCache.set(ctx.chat.id, data, 900);
        let sugString = "\n";

        for (let i = 0; i < sugData.length; i++) {
            sugString = sugString + (i + 1) + ": " + calendar.dateToString(sugData[i].resultStartDate) + " - " + calendar.dateToString(sugData[i].resultEndDate) + "\n";
        }

        return " Räume: " + roomList + "\nVorschläge:" + sugString;
    } catch (err) {
        handleError(err,ctx);
    }
});

resMenu.question(
    function(ctx) {
        const startTime = (getCalCache(ctx.chat.id).startTime);
        return `Startzeit: ${startTime}`;
    },
    "startTimeQues", {setFunc: async (ctx, ans) => {
    if (timeRegex.test(ans)) {
        var data = getCalCache(ctx.chat.id);
        data.startTime = ans;
        botCache.set(ctx.chat.id, data, 900);
    } else {
        ctx.reply("Invalid Input!");
    }
  },
  questionText: "Startzeit? (Format HH:MM)",
  uniqueIdentifier: "startTimeQues"
});


resMenu.question(
    function(ctx) {
        const endTime = (getCalCache(ctx.chat.id).endTime);
        return `Endzeit: ${endTime}`;
    },
    "endTimeQues", {setFunc: async (ctx, ans) => {
    if (timeRegex.test(ans)) {
        var data = getCalCache(ctx.chat.id);
        data.endTime = ans;
        botCache.set(ctx.chat.id, data, 900);
    } else {
        ctx.reply("Invalid Input!");
    }
  },
  questionText: "Endzeit? (Format HH:MM)",
  uniqueIdentifier: "endTimeQues"
});

resMenu.question(
    function(ctx) {
        const dayOffset = (getCalCache(ctx.chat.id).dayOffset);
        const date = new Date();
        date.setDate(date.getDate() + dayOffset);
        const dateString = date.getFullYear() + "-" + (date.getMonth()+ 1) + "-" + date.getDate();
        return `Datum: ${dateString}`;
    },
    "dateQues", {setFunc: async (ctx, ans) => {
    if (dateRegex.test(ans)) {
        var data = getCalCache(ctx.chat.id);
        const today = new Date();
        const newDateData = ans.split("-");
        const newDate = new Date();
        newDate.setFullYear(newDateData[0], (newDateData[1] - 1), newDateData[2]);
        const diffDays = Math.round((newDate - today) / (1000 * 60 * 60 * 24));
        data.dayOffset = diffDays;
        botCache.set(ctx.chat.id, data, 900);
    } else {
        ctx.reply("Invalid Input!");
    }
  },
  questionText: "Datum? (Format: YYYY-MM-DD)",
  uniqueIdentifier: "dateQues"
});

resMenu.question(
    function(ctx) {
        const subject = (getCalCache(ctx.chat.id).subject);
        return `Titel: ${subject}`;
    },
    "subjectQues", {setFunc: async (ctx, ans) => {
    var data = getCalCache(ctx.chat.id);
    data.subject = ans;
    botCache.set(ctx.chat.id, data, 900);
  },
  questionText: "Titel?",
  uniqueIdentifier: "subjectQues"
});


resMenu.simpleButton('Reservierung Abschicken', 'resButton2', {
  doFunc: async function(ctx) {
      const data = getCalCache(ctx.chat.id);
      try {
            const today = new Date();
            const startDateData = data.startTime.split(":");
            const startDate = new Date();
            startDate.setDate(startDate.getDate() + data.dayOffset);
            startDate.setHours(startDateData[0], startDateData[1], 0);

            const endDateData = data.endTime.split(":");
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + data.dayOffset);
            endDate.setHours(endDateData[0], endDateData[1], 0);

            if(startDate <= today || endDate <= today) {
                throw "Calendar1";
            }
            if(startDate >= endDate) {
                throw "Calendar2";
            }

            const resp = await calendar.createEvent(ctx.chat.id, startDate, endDate, data.rooms, data.subject);
            await ctx.reply("Reservierung versandt! Die Reservierung gilt erst nach Erhalt einer Bestätigung der jeweiligen Räume als final.");
      } catch (err) {
        handleError(err,ctx);
      }
      return true;
  }, setParentMenuAfter: true
});

resMenu.select('sugSelect',
    (ctx) => {
    const data = getCalCache(ctx.chat.id);
    var options = [];
    for (var i = 0; i < data.suggestions.length; i++) {
        options.push(i + 1);
    }
    return options;
    },
    {
    setFunc: async (ctx, key) => {
        const data = getCalCache(ctx.chat.id);
        const startDate = data.suggestions[key - 1].resultStartDate;
        const endDate = data.suggestions[key - 1].resultEndDate;
        data.startTime = calendar.dateToTimeString(startDate);
        data.endTime = calendar.dateToTimeString(endDate);

        botCache.set(ctx.chat.id, data, 900);

        await ctx.answerCbQuery(`Vorschlag ${key} Ausgewählt`);
    },
    hide: ctx => {
        const data = getCalCache(ctx.chat.id);
        if (data.suggestions.length === 0) {
            return true;
        }
        return false;
    }
});

//Menu Calendar
async function getCalData(ctx) {
    try {
        await graphMain.checkPerm(ctx.chat.id);

        const data = getCalCache(ctx.chat.id);
        if (data.rooms.length <= 0) {
            data.rooms = config.calendar.rooms;
        }

        const today = new Date();
        const endDate = new Date();
        endDate.setHours(0,0,0);

        let result;
        if(data.schedToggle) {
            today.setDate(today.getDate() + data.dayOffset);
            today.setHours(0,0,0);
            endDate.setFullYear(today.getFullYear(), today.getMonth(), today.getDate() + 1);

            result = await calendar.getStringSchedule(ctx.chat.id, today, endDate, data.rooms, true);
        } else {
            today.setSeconds(0);
            endDate.setDate(today.getDate() + 3);
            result = await calendar.getAvalSchedule(ctx.chat.id, today, endDate, data.rooms);
        }
        return result;
    } catch (err) {
        handleError(err,ctx);
    }
    return "Error";
}

const calMenu = new TelegrafInlineMenu(getCalData);

calMenu.select('roomSelect2', config.calendar.rooms, {
  setFunc: async (ctx, key) => {
    const data = getCalCache(ctx.chat.id);
    const pos = data.rooms.findIndex(function(elem){ return elem === key});
    if(pos >= 0) {
        data.rooms.splice(pos,1);
        botCache.set(ctx.chat.id, data, 900);
        await ctx.answerCbQuery(`${key} Ausgewählt`);
    } else {
        data.rooms.push(key);
        botCache.set(ctx.chat.id, data, 900);
        await ctx.answerCbQuery(`${key} Ausgewählt`);
    }
  },
  prefixFunc: function(ctx, key) {
      const data = getCalCache(ctx.chat.id);
      let isSet =  (data.rooms.find(function(elem){ return elem === key})!==undefined);
      if (isSet) {
        return "✅";
      } else {
          return "☑️";
      }
  },
  multiselect: true
});

calMenu.select("schedToggle2",["Alle Res. Anzeigen"],{
    setFunc: async (ctx, key) => {
        const data = getCalCache(ctx.chat.id);
        if(data.schedToggle) {
            data.schedToggle = false;
            botCache.set(ctx.chat.id, data, 900);
            await ctx.answerCbQuery(`Verfügbarkeit anzeigen`);
        } else {
            data.schedToggle = true;
            botCache.set(ctx.chat.id, data, 900);
            await ctx.answerCbQuery(`Alle Res. anzeigen`);
        }
    },
    prefixFunc: function(ctx, key) {
        const data = getCalCache(ctx.chat.id);
        if (data.schedToggle) {
            return "✅";
        } else {
            return "☑️";
        }
    }
});

calMenu.button(async (ctx) => {
        const data = getCalCache(ctx.chat.id);
        const today = new Date();
        today.setDate(today.getDate() + data.dayOffset - 1);
        const todayString = (today.getDate()) + "." + (today.getMonth()+1) + "." +today.getFullYear();
        return "<< " + todayString;
    },
    "prevBut", {doFunc: async (ctx) =>{
            const data = getCalCache(ctx.chat.id);
            data.dayOffset = data.dayOffset - 1;
            botCache.set(ctx.chat.id, data, 900);
            await ctx.answerCbQuery(`-1 Tag`);
        },
        hide: async (ctx) => {
            const data = getCalCache(ctx.chat.id);
            return !data.schedToggle;
        }
    });

calMenu.button(async (ctx) => {
    const data = getCalCache(ctx.chat.id);
    const today = new Date();
    today.setDate(today.getDate() + data.dayOffset + 1);
    const todayString = (today.getDate()) + "." + (today.getMonth()+1) + "." +today.getFullYear();
    return todayString + " >>";
    },
    "nextBut", {doFunc: async (ctx) =>{
    const data = getCalCache(ctx.chat.id);
    data.dayOffset = data.dayOffset + 1;
    botCache.set(ctx.chat.id, data, 900);
    await ctx.answerCbQuery("+1 Tag");
  },
hide: async (ctx) => {
    const data = getCalCache(ctx.chat.id);
    return !data.schedToggle;
},  joinLastRow: true
});

calMenu.submenu("Reservieren", "resButton", resMenu);

//Event Menu
const eventMenu = new TelegrafInlineMenu(getEventData);

eventMenu.button(async (ctx) => {
    return "<<";
    },
    "prevEventBut", {doFunc: async (ctx) =>{
    const data = getCalCache(ctx.chat.id);
    data.eventDayOffset = data.eventDayOffset - 14;
    botCache.set(ctx.chat.id, data, 900);
    await ctx.answerCbQuery(`-2 Wochen`);
  }
});

eventMenu.button(async (ctx) => {
    return ">>";
    },
    "nextEventBut", {doFunc: async (ctx) =>{
    const data = getCalCache(ctx.chat.id);
    data.eventDayOffset = data.eventDayOffset + 14;
    botCache.set(ctx.chat.id, data, 900);
    await ctx.answerCbQuery(`+2 Wochen`);
  }, joinLastRow: true
});

async function getEventData(ctx) {
    const data = getCalCache(ctx.chat.id);
    try {
        var today = new Date();
        today.setDate(today.getDate() + data.eventDayOffset);
        today.setHours(0,0,0);
        var endDate = new Date();
        endDate.setDate(endDate.getDate() + data.eventDayOffset + 14);
        endDate.setHours(0,0,0);

        let result;

        result = "Events im Zeitraum " + calendar.dateToDateString(today) + " - " + calendar.dateToDateString(endDate) + ":";
        result = result + (await calendar.getStringSchedule(ctx.chat.id, today, endDate, [config.calendar.events], false));
        return result;
    } catch (err) {
        handleError(err,ctx);
    }
    return "Error";
}

//Vorstand Menu
var VorstandMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        let resultString = await vorstand.getHelp(ctx.chat.id) + "\n";
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet. Der Start einer JHV kann bis zu 60 Sek. dauern.";
                break;
            case 1:
                resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet.";
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung.";
                break;
            default:
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

VorstandMenu.button("JHV Iniitieren", 'Vorstand1', {
    doFunc: async function(ctx) {
        try {
            await vorstand.startAssembly(ctx.chat.id);
            await ctx.answerCbQuery(`JHV wurde iniitiert`);
        } catch (err) {
            handleError(err,ctx);
        }
        return true;
    }
    ,hide: async (ctx) => {
        return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()===0);
    }
});

var assemblyMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        let resultString = "";
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet. Der Start einer JHV kann bis zu 60 Sek. dauern. \n";
                break;
            case 1:
                resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet. \n";
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung. \n";
                break;
            default:
        }
        if (vorstand.getAssemblyStatus() > 0  && vorstand.getAssembly().welcomeMessage) {
            resultString = resultString + "Eine Willkommensnachricht an sämtliche Teilnehmer wurde versandt.";
        } else {
            resultString = resultString + "Eine Willkommensnachricht an sämtliche Teilnehmer wurde nicht versandt.";
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

assemblyMenu.button("Willkommensnachricht schicken", 'Assembly2', {
    doFunc: async function(ctx) {
        try {
            vorstand.getAssembly().welcomeMessage = true;
            sendAssemblyMessage("Es wurde eine JHV gestartet, auf der du als anwesend markiert bist. Um abzustimmen sowie dich abzumelden, verwende bitte die Funktion /jhv");
        } catch (err) {
            handleError(err,ctx);
        }
        return true;
    }
    ,hide: async (ctx) => {
        return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()!==0 && !vorstand.getAssembly().welcomeMessage);
    }
});

assemblyMenu.button("JHV Schließen", 'Assembly3', {
    doFunc: async function(ctx) {
        try {
            vorstand.getAssembly().closeAssembly();
            let logHeader = "Hallo lieber Vorstand,\n\nunten findet ihr das Protokoll von der heutigen JHV. Diese Mail wurde im Namen des Vorstands, der die JHV gestartet hat, verschickt. \n\nLiebe Grüße\nEuer AC-Bot\n\n";
            let log = vorstand.getAssembly().getActivityLog();
            let messagePromise = sendAssemblyMessage("Die JHV wurde geschlossen. Vielen Dank für deine Teilnahme!");
            let emailPromise = outlook.sendEMail(ctx.chat.id, "JHV Protokoll " + calendar.dateToDateString(new Date()), logHeader + log, ["vorstand"]);
            await Promise.all([messagePromise,emailPromise]);
        } catch (err) {
            handleError(err,ctx);
        } finally {
            vorstand.endAssembly();
        }
        return true;
    }
    ,hide: async (ctx) => {
        return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()!==0);
    },
    setParentMenuAfter: true
});

var assemblyPartMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        let resultString = "Folgende Mitglieder sind als anwesend markiert:\n";
        resultString = resultString + "Teilnehmer ID: Name \n";
        resultString = resultString + vorstand.getAssembly().getMembersString(true) + "\n";
        resultString = resultString + "Folgende Mitglieder sind leider nicht beim Bot registriert:\n" + vorstand.getAssembly().getMembersString(false);
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet. Der Start einer JHV kann bis zu 60 Sek. dauern.";
                break;
            case 1:
                resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet.";
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung.";
                break;
            default:
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

assemblyPartMenu.question("Teilnehmer entfernen", "assemblyPartMenu2", {setFunc: async (ctx, ans) => {
        if (parseInt(ans) <= vorstand.getAssembly().members.length) {
            let memberChatID = vorstand.getAssembly().getChatID(ans - 1 );
            let result = vorstand.getAssembly().removeMember(ans - 1);
            if(result) {
                await bot.telegram.sendMessage(memberChatID, "Du wurdest durch den Vorstand von der JHV-Teilnehmerliste entfernt. Du kannst dich mit der Funktion /jhv wieder anmelden.");
            } else {
                await ctx.reply("Du kannst keinen Teilnehmer entfernen, der bereits eine Stimme bei einer laufenden Abstimmung abgegeben hat. Versuche es nach der Abstimmung erneut.");
            }
        } else {
            await ctx.reply("Invalid Input");
        }
    },
    questionText: "Teilnehmer ID?",
    uniqueIdentifier: "partIDQues"
});

var assemblyVoteMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        let resultString = "";
        resultString = resultString + "Optionen: " + vorstand.getAssembly().pollOptions.join() + " (Enthaltung wird automatisch hinzugefügt)\n";
        resultString = resultString + "Titel: " + vorstand.getAssembly().pollTitle + "\n";
        resultString = resultString + "Anzahl von Stimmen p.P.: " + vorstand.getAssembly().pollVoteNum + "\n";
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet. Der Start einer JHV kann bis zu 60 Sek. dauern.";
                break;
            case 1:
                resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet. \n";
                let today = new Date();
                let timeString = today.toTimeString();
                resultString = resultString + "Stand " + timeString + "\n";
                resultString = resultString + vorstand.getAssembly().getVoteOverviewString();
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung.";
                break;
            default:
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

assemblyVoteMenu.question("Optionen", "assemblyVoteMenu2", {setFunc: async (ctx, ans) => {
    let options = ans.split(",");
    if(options.length >= 2) {
        vorstand.getAssembly().setOptions(options);
    } else {
        ctx.reply("Es müssen mindestens 2 Optionen gesetzt sein!");
    }
    },
    questionText: "Optionen? Format:1,2,3...",
    uniqueIdentifier: "optVoteQues",
    hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()===2);
    }
});

assemblyVoteMenu.question("Titel", "assemblyVoteMenu3", {setFunc: async (ctx, ans) => {
        vorstand.getAssembly().setTitle(ans);
    },
    questionText: "Titel?",
    uniqueIdentifier: "titleVoteQues",
    hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()===2);
    }
});

assemblyVoteMenu.question("Stimmenanzahl", "assemblyVoteMenu4", {setFunc: async (ctx, ans) => {
    if(!isNaN(ans)) {
        vorstand.getAssembly().setVoteNum(ans);
    } else {
        ctx.reply("Stimmenanzahl muss eine Zahl sein!");
    }
    },
    questionText: "Anzahl von Stimmen p.P.?",
    uniqueIdentifier: "numVoteQues",
    hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()===2);
    }
});

assemblyVoteMenu.button("Refresh", 'assemblyVoteMenu6', {
    doFunc: async function(ctx) {
        return true;
    },
    hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()===1);
    }
});

assemblyVoteMenu.button((ctx) => {
    if(vorstand.getAssembly().openPolls) {
        return "Abstimmung Beenden";
    } else {
        return "Abstimmung Starten";
    }
}, 'assemblyVoteMenu5', {
    doFunc: async function(ctx) {
        try {
            if(vorstand.getAssembly().openPolls) {
                let resultString = "Eine Abstimmung wurde soeben beendet. Hier die Ergebnisse: \n";
                resultString = resultString + vorstand.getAssembly().pollTitle + "\n";
                resultString = resultString + vorstand.getAssembly().getVoteResultString();
                vorstand.getAssembly().endVote();
                await sendAssemblyMessage(resultString);
            } else {
                vorstand.getAssembly().startVote();
                await sendAssemblyMessage("Eine Abstimmung wurde soeben freigeschaltet. Verwende bitte die Funktion /jhv, um abzustimmen oder dich abzumelden, falls du nicht anwesend bist.");
            }
        } catch (err) {
            handleError(err,ctx);
        }
        return true;
    }
});

assemblyMenu.submenu("Teilnehmer Verwalten", "assemblyPartMenu", assemblyPartMenu, {
    hide: async (ctx) => {
        return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()!==0);
    }});

assemblyMenu.submenu("Abstimmung Verwalten", "assemblyVoteMenu", assemblyVoteMenu, {
    hide: async (ctx) => {
        return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()!==0);
    }});

VorstandMenu.submenu("JHV Verwalten", "assemblyMenu", assemblyMenu, {
    hide: async (ctx) => {
    return !(await vorstand.getPermissions(ctx.chat.id) && vorstand.getAssemblyStatus()!==0);
}});


//JHV Menu for Participants

var jhvMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        await graphMain.checkPerm(ctx.chat.id);
        let resultString = "";
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet.";
                break;
            case 1:
                resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet. Verwende den Knopf 'Abstimmung', um abzustimmen.";
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung. Du wirst benachrichtigt, wenn eine Abstimmung freigeschaltet wird.";
                break;
            default:
        }
        if(vorstand.getAssemblyStatus()>0) {
            if (vorstand.getAssembly().isPart(ctx.chat.id)) {
                return "Du nimmst an der JHV teil und wirst bei allen Wahlen berücksichtigt. Falls du vorzeitig gehen musst, melde dich bitte hier ab. ";
            } else {
                return "Du nimmst nicht an der JHV teil. Falls du aktives Mitglied bist, kannst du dich hier zur JHV anmelden, um abstimmen zu können. ";
            }
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

jhvMenu.button((ctx) => {
    if(vorstand.getAssembly().isPart(ctx.chat.id)) {
        return "Abmelden";
    } else {
        return "Anmelden";
    }
}, 'Vote1', {
    doFunc: async function(ctx) {
        try {
            let today = new Date();
            let timeString = today.getHours() + "." + today.getMinutes();
            if(vorstand.getAssembly().isPart(ctx.chat.id)) {
                let result = vorstand.getAssembly().removeMemberChatID(ctx.chat.id);
                if(result) {
                    await bot.telegram.sendMessage(vorstand.getAssembly().initiatorID, result + " hat sich um " + timeString + " von der JHV abgemeldet!");
                } else {
                    await ctx.reply("Du kannst dich nicht von einer JHV abmelden, auf der du bereits eine Stimme bei einer laufenden Abstimmung abgegeben hast.");
                }
            } else {
                let result = await vorstand.getAssembly().addMember(ctx.chat.id);
                if(result.result === true) {
                    await bot.telegram.sendMessage(vorstand.getAssembly().initiatorID, result.userName + " hat sich um " + timeString + " zur JHV angemeldet!");
                } else {
                    ctx.reply("Die Anmeldung zur JHV hat nicht funktioniert. Du hast den Status " + result.status + ". Nur aktive Mitglieder, die noch nicht zur JHV angemeldet wurden, sind laut Satzung stimmberechtigt. Falls du glaubst, dass dein Status ein Fehler sei, wende dich bitte an den Vorstand F&R.");
                }
            }
        } catch (err) {
            handleError(err,ctx);
        }
        return true;
    }
    ,hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()!==0);
    }
});

var voteMenu = new TelegrafInlineMenu(async function (ctx) {
    try {
        let resultString = "";
        switch (vorstand.getAssemblyStatus()) {
            case 0:
                resultString = resultString + "Es wurde noch keine JHV gestartet. \n";
                break;
            case 1:
                let curVoteNum = vorstand.getAssembly().getMemberVoteNum(ctx.chat.id);
                if(curVoteNum > 0) {
                    resultString = resultString + "Eine Abstimmung ist gerade freigeschaltet: \n";
                    resultString = resultString + vorstand.getAssembly().pollTitle + "\n";
                    resultString = resultString + "Du hast noch " + curVoteNum + " Stimme(n).\n";
                    resultString = resultString + "Optionen: \n"
                    let options = vorstand.getAssembly().getMemberOptions(ctx.chat.id);
                    for (let i = 0; i < options.length; i++) {
                        resultString = resultString + (i + 1) + ": " + options[i] + "\n";
                    }
                } else {
                    resultString = resultString = "Du hast bereits alle dir zur Verfügung stehenden Stimmen abgegeben. \n";
                }
                resultString = resultString + "Hinweis zur elektronischen Abstimmung: \nAlle Stimmen werden anonym gespeichert. Dies führt dazu, dass die Möglichkeit zur Rücknahme einer Stimme nicht besteht.";
                break;
            case 2:
                resultString = resultString + "Es läuft gerade keine Abstimmung. \n";
                break;
            default:
        }
        return resultString;
    }  catch (err) {
        handleError(err,ctx);
    }
    return "Error";
});

voteMenu.select('voteMember1', ((ctx) => {
    let options = vorstand.getAssembly().getMemberOptions(ctx.chat.id);
    let dispOptions = [];
    for (let i = 0; i < options.length; i++) {
        dispOptions.push(i+1);
    }
    return dispOptions;
}), {
    setFunc: async (ctx, key) => {
        vorstand.getAssembly().submitBallot(ctx.chat.id, key-1);
    },
    hide: ctx => {
        return (vorstand.getAssembly().getMemberVoteNum(ctx.chat.id) < 1);
    }
});

jhvMenu.submenu("Abstimmung", "voteMenu", voteMenu, {
    hide: async (ctx) => {
        return !(vorstand.getAssemblyStatus()===1 && vorstand.getAssembly().isPart(ctx.chat.id));
    }});

async function sendAssemblyMessage(message) {
    try {
        let members = vorstand.getAssembly().members;
        for (let i = 0; i < members.length; i++) {
            await bot.telegram.sendMessage(members[i].chatID, message);
        }
    } catch(err) {
        console.error(err);
    }
};

var contactMenu = new TelegrafInlineMenu("Du kannst in jedem Chat nach Telefonnummern von AClern suchen und sie direkt mit deinem Gegenüber teilen.\n" +
    "Dazu musst du nur in deine Eingabezeile \"" + config.name + "\" gefolgt von einem Namen eingeben. Es werden dabei nur Kontakte angezeigt, für die eine Handynummer im SharePoint hinterlegt wurde!\n" +
    "Für ein Beispiel drücke den untenstehenden Button:");

contactMenu.switchToCurrentChatButton("Direkt Hier","c");

VorstandMenu.setCommand('vorstand');

eventMenu.setCommand('events');

calMenu.setCommand('buero');

jhvMenu.setCommand('jhv');

contactMenu.setCommand('kontakte');

bot.use(calMenu.init({
  backButtonText: 'Zurück',
  actionCode: 'upperMenu'
}));

bot.use(eventMenu.init({
  backButtonText: 'Zurück',
  actionCode: 'upperMenu2'
}));

bot.use(VorstandMenu.init(  {
    backButtonText: 'Zurück',
    actionCode: 'upperMenu3'
}));

bot.use(jhvMenu.init(  {
    backButtonText: 'Zurück',
    actionCode: 'upperMenu4'
}));

bot.use(contactMenu.init());

bot.command('profile', getOwnProfile);
//Don't block thread
bot.command('details', async function(ctx) {
    getUserDetails(ctx).catch(handleError);
});
bot.start(login);
bot.catch(handleError);

httpServer.listen(config.restify.port, () => {});

bot.launch().catch((err) => {
    console.error(err);
});
