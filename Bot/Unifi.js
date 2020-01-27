const unifi = require('node-unifi');
const NodeCache = require( "node-cache" );
const util = require('util');

const config = require('./../config.json');

module.exports = class Unifi {
    constructor() {
        this.connected = false;
        this.controller = new unifi.Controller(config.unifi.uri, config.unifi.port);
        this.login = util.promisify(this.controller.login);
        this.getClients = util.promisify(this.controller.getClientDevices);
        this.cache = new NodeCache();
    }

    async init() {
        try {
            await this.login(config.unifi.user, config.unifi.password);
            if(!this.connected) {
                console.log("Connection to Unifi Controller Established.");
            }
            this.connected = true;
            return true;
        } catch (err) {
            console.log("Connection to Unifi Controller Failed: " + err);
            this.connected = false;
            return false;
        }
    }

    async getClientDevicesUnifi() {
        try {
            await this.init();
            if (this.connected) {
                let results = await this.getClients(config.unifi.site);
                let parsedresults = [];
                let devCount = 0;
                for (let i = 0; i < results[0].length; i++) {
                    if (!config.unifi.excludeSSIDS.includes(results[0][i].essid)) {
                        if (results[0][i].name) {
                            parsedresults.push(results[0][i].name);
                        }
                        devCount++;
                    }
                }
                let data = {};
                data.devCount = devCount;
                data.devices = parsedresults;
                return data;
            }
        } catch(err) {
            console.log("Unifi Controller Failure : " + err);
            this.connected = false;
        }
        return false;
    }

    async getClientDevices() {
        let data = this.cache.get(config.unifi.site);

        if (data === undefined) {
            data = await this.getClientDevicesUnifi();
            if (data) {
                this.cache.set(config.unifi.site, data, 90);
                this.expired = true;
                return data;
            }
        }
        if (data) {
            return data;
        }
        return false;
    }

    async getClientDevicesString() {
        let data = await this.getClientDevices();

        let resultString = "";

        if(!this.connected) {
            resultString = resultString + "Die Verbindung zum Controller wurde unterbrochen. Versuche es bitte später nochmal. "
        }

        if (data) {
            resultString = "Geräte Online: " + data.devCount + "\n";
            resultString = resultString + data.devices.join(", ") + "\n";
        } else {
            resultString = resultString + "Es sind keine Daten vorhanden. \n";
        }
        return resultString;
    }

};