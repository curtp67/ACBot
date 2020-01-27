/*
* Libraries
*/
const ClientOAuth2 = require('client-oauth2');
const axios = require('axios');
const crypto = require('crypto');
const url = require('url');
const NodeCache = require( "node-cache" );

/*
* Config / Internal Imports
*/
const config = require('./../config.json');
const GraphToken = require('./../Data/GraphToken.js');

module.exports = class GraphMain {
    constructor(messageFunc) { // TODO: Accept Arguments for Constructor
         this.graphAuth = new ClientOAuth2({
            clientId: config.graph.clientId,
            clientSecret: config.graph.clientSecret,
            accessTokenUri: config.graph.accessTokenUri,
            authorizationUri: config.graph.authorizationUri,
            redirectUri: config.graph.redirectUri,
            scopes: config.graph.scopes
        });
        this.baseURL = "https://graph.microsoft.com/" + config.graph.version + "/";
        this.cache = new NodeCache();
        this.loginCache = new NodeCache();
        this.messageFunc = messageFunc;
    }

    async authCallback(req, res, next) {
        const urlParts = url.parse(req.url, true);
        const chatID = urlParts.query.state;
        const err = urlParts.query.error;
        const err_dsc = urlParts.query.error_description;
        let body = "";
        let expiry = new Date();
        expiry.setMinutes(expiry.getMinutes() + 7);

        try {
            if(!chatID) {
                throw "No Chat ID!";
            }
            if(err !== undefined) {
                throw err;
            }
            let tempToken = crypto.randomBytes(64).toString('hex');
            let cookieToken = crypto.randomBytes(64).toString('hex');

            let cacheData = {
                chatID : chatID,
                cookieToken: cookieToken,
                url: req.url
            };
            this.loginCache.set(tempToken, cacheData, 420);
            res.setCookie('botToken', cookieToken, {
                path: '/',
                maxAge: 420,
                secure: true,
                httpOnly: true,
                sameSite: true
            });

            body = `
            <html>
            <head>
            <style>
            input[type=submit]  {
              background-color: #4CAF50; /* Green */
              border: none;
              color: white;
              padding: 15px 32px;
              text-align: center;
              text-decoration: none;
              display: inline-block;
              font-size: 32px;
              margin: 4px 2px;
              cursor: pointer;
            }
            </style>
            </head>
            <body>
            Um Missbrauch vorzubeugen, best&auml;tige bitte, dass du dein Academy Consult SharePoint-Konto mit dem Telegram-Konto (ID ${chatID}) verkn&uuml;pfen willst. <br>
            Dies ist immer der Fall, wenn du den Link direkt vom Telegram-Bot bekommen hast. Diese Seite ist aus Sicherheitsgr&uuml;nden nur 5 Minuten lang g&uuml;ltig. <br>
            <form action="/apiCallback" method="post">
            <input type="hidden"
            name="TempToken"
            value="${tempToken}"/>
            <input type="submit" value="Best&auml;tigen">
            </form>
            </body>
            </html>`;

            res.writeHead(200, {
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'text/html'
            });
        } catch (err) {
            console.error("Login Error: " + err + ":" + err_dsc);
            body = "Das hat leider nicht geklappt!";
            res.writeHead(400, {
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'text/html'
            });
        } finally {
            res.write(body);
            res.end();
            next();
        }
    }

    async authFormCallback(req, res, next) {
        let body;
        try {
            let tempToken = req.body.TempToken;
            let data = this.loginCache.get(tempToken);
            let chatID;
            let referer = req.headers.referer;
            let cookieToken = req.cookies["botToken"];

            if (referer) {
                let urlParts = url.parse(referer, true);
                chatID = urlParts.query.state;
            }
            if (data === undefined) {
                throw "Token Invalid";
            }
            if (referer !== undefined) {
                if (chatID !== data.chatID) {
                    throw "Token Invalid";
                }
                if (!referer.includes(config.graph.redirectUri) || !referer.includes(data.url)) {
                    throw "Invalid Referer";
                }
            } else {
                chatID = data.chatID;
            }
            if(data.cookieToken !== cookieToken){
                throw "Token Invalid";
            }
            res.clearCookie('botToken');
            this.loginCache.del(tempToken);

            const token = await this.graphAuth.code.getToken(data.url);
            const userID = (await this.getOwnProfileID(token)).id;

            await GraphToken.addToken(
                chatID,
                token.accessToken,
                token.refreshToken,
                token.expires,
                userID
            );

            this.cache.set(chatID, true, 3600);
            body = "Vielen Dank! Das Fenster kann nun geschlossen werden.";
            res.writeHead(200, {
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'text/html'
            });
            await this.messageFunc(chatID, "Vielen Dank für die Verifizierung deines Kontos sowie die Erteilung der notwendigen Berechtigungen! Du kannst den Bot ab sofort verwenden.");
        } catch (err) {
            body = "Das hat leider nicht geklappt! Verwende bitte erneut den Link vom Bot; diesen kannst du mit /start anfordern.<br>"
                + "Stelle ebenfalls sicher, dass Cookies erlaubt sind.<br>"
                + err;
            console.error("Login Error: " + err);
            res.writeHead(400, {
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'text/html'
            });
        } finally {
            res.write(body);
            res.end();
            next();
        }
    }

    /*
    * Return Oauthv2 Code Link
    */
    login(chatID){
        return this.graphAuth.code.getUri({state : chatID});
    }

    async signReq(chatID, req) {
        const token = await this.getToken(chatID);
        return token.sign(req);
    }

    getParameters(parameters, selectwa) {
        if(parameters) {
            let paramString = "?";
            if (parameters.selection) {
                if(paramString.length > 1) {
                    paramString = paramString + "&";
                }
                if(selectwa) {
                    paramString = paramString + "$";
                }
                paramString = paramString+ "select=" + parameters.selection.join(); //$select causes Problems
            }
            if (parameters.expand) {
                if(paramString.length > 1) {
                    paramString = paramString + "&";
                }
                paramString = paramString + "$expand=fields($select=" + parameters.expand.join() + ")";
            }
            if (parameters.filter) {
                if(paramString.length > 1) {
                    paramString = paramString + "&";
                }
                paramString = paramString + "$filter=" + parameters.filter;
            }
            if (parameters.orderby) {
                if (paramString.length > 1) {
                    paramString = paramString + "&";
                }
                paramString = paramString + "orderby=" + parameters.orderby.join();
            }
            if (parameters.topNum) {
                if(paramString.length > 1) {
                    paramString = paramString + "&";
                }
                paramString = paramString + "$top=" + parameters.topNum;
            }
            if (parameters.skiptoken) {
                if(paramString.length > 1) {
                    paramString = paramString + "&";
                }
                paramString = paramString + "$skiptoken=" + parameters.skiptoken;
            }
            return paramString;
        } else {
            return "";
        }
    }

    async checkPerm(chatID) {
        let data = this.cache.get(chatID);
        if (data !== undefined) {
            if (data === true) {
                return true;
            }
            throw "No token";
        }
        if(await this.getToken(chatID)) {
            this.cache.set(chatID, true, 3600);
        }
        return true;
    }

    async getToken(chatID) {
        const tokenData = await GraphToken.getToken(chatID);
        const expiry = new Date(tokenData.data.expiry);

        const tokenPrimer = {
            access_token: tokenData.data.accessToken,
            refresh_token: tokenData.data.refreshToken,
            token_type: "bearer"
        };
        const currentDate = new Date();
        const token = this.graphAuth.createToken(tokenPrimer);
        if(currentDate > expiry) {
            let tokenRefresh;
            try {
                tokenRefresh = await token.refresh();
            } catch(err) {
                this.cache.set(chatID, false, 3600);
                throw "Refresh Token Failed";
            }
            await GraphToken.addToken(
                chatID,
                tokenRefresh.accessToken,
                tokenRefresh.refreshToken,
                tokenRefresh.expires,
                tokenData.userID
            );
            return tokenRefresh;
        }
        return token;
    }

    async sendReqComb(chatID, req) {
        let signedReq = await this.signReq(chatID, req);
        let res = await axios.request(signedReq);
        let nextLink = false;
        if (res.data["@odata.nextLink"]) {
            nextLink = res.data["@odata.nextLink"];
        }
        let values = [];
        values = values.concat(res.data.value);

        while(nextLink !== false) {
            let nextReq = {
                method: req.method,
                url: nextLink
            };
            signedReq = await this.signReq(chatID, nextReq);
            res = await axios.request(signedReq);
            values = values.concat(res.data.value);
            if (res.data["@odata.nextLink"]) {
                nextLink = res.data["@odata.nextLink"];
            } else {
                nextLink = false;
            }
        }
        return values;
    }

    async sendReqSingle(chatID, req) {
        let signedReq = await this.signReq(chatID, req);
        return await axios.request(signedReq);
    }

    /*
    * Get Profile (For userID)
    */
    async getOwnProfileID(token) {
        const req = {
            method: "get",
            url: this.baseURL + "me/?$select=id"
        };
        const signedReq = await token.sign(req);
        const res = await axios.request(signedReq);
        return res.data;
    }
};