const fs = require('fs');

/*
* Config / Internal Imports
*/
const config = require('./../config.json');

module.exports = class Delve {
    constructor(graphMain) {
        this.graphMain = graphMain;
        this.baseURL = this.graphMain.baseURL;
    }

    async getProfile(userID, chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "users/" + userID + "/" + this.graphMain.getParameters(parameters)
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }

    async getProfiles(chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "users" + this.graphMain.getParameters(parameters, true)
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data.value;
    }

    async getAllProfiles(chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "users" + this.graphMain.getParameters(parameters, true)
        };
        let result = await this.graphMain.sendReqComb(chatID, req);
        return result;
    }
    
    async getOwnProfile(chatID) {
        const req = {
            method: "get",
            url: this.baseURL + "me"
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }

    async getGroups(chatID) {
        const req = {
            method: "get",
            url: this.baseURL + "groups"
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }

    async isGroupMember(chatID, group) {
        const req = {
            method: "post",
            url: this.baseURL + "me/checkMemberGroups",
            data: {
                "groupIds": [
                    config.delve.groups[group]
                ]
            }
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data.value.length > 0;
    }

    async getOwnProfilePics(chatID) {
        const req = {
            method: "get",
            url: this.baseURL + "me/photos"
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }

    async getProfilePics(chatID, userID) {
        const req = {
            method: "get",
            url: this.baseURL + "/users/" + userID + "/photo/$value"
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        let resultBuffer = new Buffer(result.data);
        let wstream = await fs.createWriteStream('temp.jpg');
        wstream.write(resultBuffer);
        wstream.close();
        return "true";
    }
};