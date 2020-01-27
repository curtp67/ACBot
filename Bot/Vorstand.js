const NodeCache = require( "node-cache" );
const Assembly = require('./Assembly.js');

module.exports = class Vorstand {
    constructor(sharePoint, delve) {
        this.sharePoint = sharePoint;
        this.delve = delve;
        this.cache = new NodeCache();
        this.assembly = null;
    }

    async getHelp(chatID) {
        if(await this.getPermissions(chatID)) {
            return "Du bist berechtigt diese Funktion zu verwenden."
        } else {
            return "Du bist kein Vorstand. Werde Vorstand, um diese Funktion zu verwenden."
        }
    }

    async getPermissions(chatID) {
        let data = this.cache.get(chatID);
        if(!data) {
            data = {};
            if (await this.delve.isGroupMember(chatID, "Vorstand")) {
                data.isVorstand = true;
                this.cache.set(chatID, data, 900);
            } else {
                data.isVorstand = false;
                this.cache.set(chatID, data, 900);
            }
            this.cache.set(chatID, data, 900);
        }
        return data.isVorstand;
    }

    async startAssembly(chatID) {
        this.assembly = new Assembly(this.sharePoint, this.delve, chatID);
        await this.assembly.initAssembly();
        return true;
    }

    endAssembly() {
        this.assembly = null;
        return true;
    }

    getAssemblyStatus(chatID) {
        if (!this.assembly) {
            return 0;
        } else if (this.assembly.openPolls) {
            return 1;
        } else {
            return 2
        }
    }

    getAssembly() {
        if(this.assembly !== undefined) {
            return this.assembly;
        } else {
            throw "Assembly1";
        }
    }

};