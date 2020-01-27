const GraphToken = require('./../Data/GraphToken.js');

module.exports = class Assembly {
    constructor(sharePoint, delve, chatID) {
        this.sharePoint = sharePoint;
        this.delve = delve;
        this.initiatorID = chatID;
        this.members = [];
        this.membersWithout = [];
        this.openPolls = false;
        this.pollTitle = "";
        this.pollVoteNum = 1;
        this.pollVotes = [];
        this.memberVoteStatus = [];
        this.pollOptions = ["Ja", "Nein", "Enthaltung"];
        this.welcomeMessage = false;
        this.activityLog = [];
    }

    async initAssembly() {
        let curDate = new Date();
        let nextDate = new Date();
        curDate.setHours(0,0,0);
        curDate.setMilliseconds(0);
        nextDate.setDate(nextDate.getDate() + 1);
        nextDate.setHours(6,0,0);
        nextDate.setMilliseconds(0);

        let parameters = {};
        parameters.selection = ["id", "PersonLookupId", "Status"];
        parameters.expand = ["PersonLookupId", "Status"];
        parameters.topNum = 999; // Set Top to 999 (Highest) as upper bound
        parameters.filter = "fields/Status eq 'Anwesend' and fields/MVDatum ge '" + curDate.toISOString() + "' and fields/MVDatum le '" + nextDate.toISOString() + "'";//Change to Anwesend
        let dataPromise = this.sharePoint.getAllListItems("MVCheckIn", this.initiatorID, parameters);

        parameters.selection = ["id", "AccountLookupId", "Title", "Status", "mail"];
        parameters.expand = ["AccountLookupId", "Title", "Status", "mail"];
        parameters.filter = "fields/Status eq 'aktives Mitglied'";
        let memberDataPromise = this.sharePoint.getAllListItems("Mitglieder", this.initiatorID, parameters);

        parameters.selection = ["id", "mail"];
        parameters.expand = false;
        parameters.filter = "";
        let memberDataProfilesPromise = this.delve.getAllProfiles(this.initiatorID, parameters);

        let results = await Promise.all([dataPromise, memberDataPromise, memberDataProfilesPromise]);
        let data = results[0];
        let memberData = results[1];
        let memberDataProfiles = results[2];

        //Consolidate / Parse Data
        for (let i = 0; i < data.length; i++) {//Loop through CheckIn List, Implicit Check for Attendance Status
            for (let j = 0; j < memberData.length; j++) { //Loop through list of active members to match
                if (memberData[j].fields.AccountLookupId === data[i].fields.PersonLookupId) { //Match with AccountLookupID, Implicit Check for Member Status
                    let userDataJSON = {
                        userName: memberData[j].fields.Title,
                        mail: memberData[j].fields.mail
                    };
                    for (let k = 0; k < memberDataProfiles.length; k++) { //Loop through profiles
                        if (memberDataProfiles[k].mail === userDataJSON.mail) { //Match with E-Mail
                            userDataJSON.id = memberDataProfiles[k].id; //Get Azure ID
                            let chatID = await GraphToken.getChatID(userDataJSON.id); //Query for ChatID from GraphToken
                            if (chatID) { //If entry found, add to members array
                                userDataJSON.chatID = chatID;
                                this.members.push(userDataJSON);
                            } else {
                                this.membersWithout.push(userDataJSON); //If not, add to membersWithout array
                            }
                            break; //Break on Match
                        }
                    }
                    break; //Break on Match
                }
            }
        }

        this.addActivityLog("Die JHV wurde eröffnet. Folgende Mitglieder sind anwesend:\n" + this.getMembersString(true));

        return true;
    }

    closeAssembly() {
        this.addActivityLog("Die JHV wurde geschlossen.");
    }

    getMembersString(withChat) {
        let resultString = "";
        if(withChat) {
            for (let i = 0; i < this.members.length; i++) {
                resultString = resultString + (i+1) +  ": " + this.members[i].userName + "\n";
            }
        } else {
            for (let i = 0; i < this.membersWithout.length; i++) {
                resultString = resultString + this.membersWithout[i].userName + "\n";
            }
        }
        return resultString
    }

    removeMemberChatID(chatID) {
        for (let i = 0; i < this.members.length; i++) {
            if(this.members[i].chatID === chatID) {
                let userName = this.members[i].userName;
                if(this.openPolls) {
                    let memberVoteIndex = this.getMemberVoteIndex(chatID);
                    if(this.memberVoteStatus[memberVoteIndex].voteNum === this.pollVoteNum) { //Delete Only if Did Not Vote
                        this.memberVoteStatus.splice(memberVoteIndex, 1);
                    } else {
                        return false;
                    }
                }
                this.members.splice(i, 1);
                this.addActivityLog(userName + " hat sich von der JHV abgemeldet.");
                return userName;
            }
        }
        return false;
    }

    removeMember(memberID) {
        if(this.openPolls) {
            let memberVoteIndex = this.getMemberVoteIndex(this.members[memberID].chatID);
            if(this.memberVoteStatus[memberVoteIndex].voteNum === this.pollVoteNum) { //Delete Only if Did Not Vote
                this.memberVoteStatus.splice(memberVoteIndex, 1);
            } else {
                return false;
            }
        }
        this.addActivityLog(this.members[memberID].userName + " wurde von der JHV entfernt.");
        this.members.splice(memberID, 1);
        return true;
    }

    async addMember(memberID) {
        let parameters = {};
        let userData = {};
        parameters.selection = ["id", "mail", "displayName"];
        parameters.expand = false;
        parameters.filter = "id eq '" + (await GraphToken.getUserID(memberID)) + "'";
        let memberData = await this.delve.getProfiles(memberID, parameters);
        userData.chatID = memberID;
        userData.id = memberData[0].id;
        userData.userName = memberData[0].displayName;
        userData.mail = memberData[0].mail;
        parameters.selection = ["id", "mail", "Status"];
        parameters.expand = ["Status","mail"];
        parameters.filter = "fields/mail eq '" + userData.mail + "'";
        memberData = await this.sharePoint.getListItems("Mitglieder", memberID, parameters);
        if(memberData[0].fields.Status === "aktives Mitglied") {
            if(!this.isPart(memberID)) {
                this.members.push(userData);
                if(this.openPolls) {
                    userData.options = [...this.pollOptions];
                    userData.voteNum = this.pollVoteNum;
                    this.memberVoteStatus.push(userData);
                }
                this.addActivityLog(userData.userName + " hat sich zur JHV angemeldet.");
                return {result: true, userName: userData.userName};
            } else {
                return {result: false, status: "bereits angemeldet"};
            }
        } else {
            return {result: false, status: memberData[0].fields.Status};
        }
    }

    getChatID(memberID) {
        return this.members[memberID].chatID;
    }

    isPart(chatID) {
        for (let i = 0; i < this.members.length; i++) {
            if (this.members[i].chatID === chatID){
                return true;
            }
        }
        return false;
    }

    setOptions(options) {
        this.pollOptions = options;
        this.pollOptions.push("Enthaltung");
    }

    setTitle(title) {
        this.pollTitle = title;
    }

    setVoteNum(voteNum) {
        this.pollVoteNum = voteNum;
    }

    startVote() {
        this.memberVoteStatus = [...this.members];
        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            this.memberVoteStatus[i].options = [...this.pollOptions];
            this.memberVoteStatus[i].voteNum = this.pollVoteNum;
        }
        this.openPolls = true;
        this.addActivityLog("Eine Abstimmung wurde gestartet: " + this.pollTitle);
        return true;
    }

    getMemberOptions(memberID) {
        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            if (this.memberVoteStatus[i].chatID === memberID) {
                return this.memberVoteStatus[i].options;
            }
        }
        return false;
    }

    getMemberVoteNum(memberID) {
        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            if (this.memberVoteStatus[i].chatID === memberID) {
                return this.memberVoteStatus[i].voteNum;
            }
        }
        return false;
    }

    endVote() {
        this.addActivityLog( "Eine Abstimmung wurde beendet: " + this.pollTitle + "\nErgebnisse:\n" + this.getVoteResultString());
        this.openPolls = false;
        this.pollOptions = ["Ja", "Nein", "Enthaltung"];
        this.pollTitle = "";
        this.pollVoteNum = 1;
        this.pollVotes = [];
        this.memberVoteStatus = [];
        return true;
    }

    submitBallot(memberID, voteID) {
        if(this.openPolls) {
            let memberIndex = this.getMemberVoteIndex(memberID);
            if (this.memberVoteStatus[memberIndex].voteNum > 0) {
                this.pollVotes.push(this.memberVoteStatus[memberIndex].options[voteID]);
                this.memberVoteStatus[memberIndex].voteNum--;
                if (this.memberVoteStatus[memberIndex].options[voteID] !== "Enthaltung") { //Remove option if not Abstention
                    this.memberVoteStatus[memberIndex].options.splice(voteID, 1);
                }
            }
        }
    }

    getMemberVoteIndex(memberID) {
        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            if (this.memberVoteStatus[i].chatID === memberID) {
                return i;
            }
        }
        return false;
    }

    getVoteOverviewString() {
        let resultString = "";
        let memberWoVote = [];
        let countVoted = 0;
        let countNotVoted = 0;

        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            if(this.memberVoteStatus[i].voteNum > 0) {
                memberWoVote.push(this.memberVoteStatus[i].userName);
                countNotVoted++;
            } else {
                countVoted++;
            }
        }
        resultString = resultString + countVoted + " Mitglieder haben ihre Stimmen bereits abgegeben. \n"
        resultString = resultString + countNotVoted + " Mitglieder haben ihre Stimmen noch nicht abgegeben. \n";
        resultString = resultString + "Namentlich: " + memberWoVote.join();
        return resultString;
    }

    getVoteResultString() {
        let resultString = "";
        let memberWoVote = [];
        let countVoted = 0;
        let countNotVoted = 0;

        for (let i = 0; i < this.memberVoteStatus.length; i++) {
            if(this.memberVoteStatus[i].voteNum > 0) {
                memberWoVote.push(this.memberVoteStatus[i].userName);
                countNotVoted++; //Vllt. als nicht gültig markieren
            } else {
                countVoted++;
            }
        }
        resultString = resultString + countVoted + " Mitglieder haben abgestimmt. \n";
        if(countNotVoted > 0) {
            resultString = resultString + countNotVoted + " Mitglieder haben ihre Stimmen noch nicht abgegeben. \n";
            resultString = resultString + "Namentlich: " + memberWoVote.join() + "\n";
        }

        let voteResult = [];
        for (let i = 0; i < this.pollOptions.length; i++) {
            voteResult.push({option: this.pollOptions[i], count: 0});
        }

        for (let i = 0; i < this.pollVotes.length; i++) {
            for (let j = 0; j < voteResult.length ; j++) {
                if(voteResult[j].option === this.pollVotes[i]) {
                    voteResult[j].count++;
                }
            }
        }

        resultString = resultString + "Stimmverteilung:\n";
        for (let i = 0; i < voteResult.length; i++) {
            resultString = resultString + "Es entfielen " + voteResult[i].count + " Stimme(n) auf " + voteResult[i].option + ".\n";
        }

        return resultString;
    }

    getActivityLog() {
        let resultString = "";
        for (let i = 0; i < this.activityLog.length; i++) {
            resultString = resultString + this.activityLog[i] + "\n";
        }
        return resultString;
    }

    addActivityLog(activity) {
        let today = new Date();
        let timeString = today.toTimeString();
        this.activityLog.push("Um " + timeString + " wurde folgendes Ereignis gemeldet: " +  activity);
    }
};