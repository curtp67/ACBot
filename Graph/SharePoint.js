/*
* Config / Internal Imports
*/
const config = require('./../config.json');

module.exports = class SharePoint {
    constructor(site, graphMain) {
        this.site = site;
        this.graphMain = graphMain;
        this.baseURL = this.graphMain.baseURL + "sites/" + this.site + "/";
    }

    async getList(listID, chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "lists/" + config.sharepoint.lists[listID]
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }
    
    async getListItems(listID, chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "lists/" + config.sharepoint.lists[listID] + "/Items" + this.graphMain.getParameters(parameters)
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        if(parameters.getAll === true) {
            return result;
        } else {
            return result.data.value;
        }
    }

    async getAllListItems(listID, chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "lists/" + config.sharepoint.lists[listID] + "/Items" + this.graphMain.getParameters(parameters)
        };
        let result = await this.graphMain.sendReqComb(chatID, req);
        return result;
    }

    async getUserInfoByID(LookupID, chatID, parameters) {
        const req = {
            method: "get",
            url: this.baseURL + "lists/" + config.sharepoint.lists["Benutzerinformationsliste"] + "/Items/" + LookupID + "/" + this.graphMain.getParameters(parameters)
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }
};