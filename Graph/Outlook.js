/*
* Config / Internal Imports
*/
const config = require('./../config.json');

module.exports = class Outlook {
    constructor(graphMain) {
        this.graphMain = graphMain;
        this.baseURL = this.graphMain.baseURL;
    }

    async sendEMail(chatID, subject, message, recepients) {
        let recpArr = [];

        for(let i = 0; i < recepients.length; i++) {
            recpArr.push({
                    "emailAddress": {
                        "address": recepients[i] + "@academyconsult.de",
                    }
                }
            );
        }

        const req = {
            method: "post",
            url: this.baseURL + "me/sendMail",
            data: {
            "message": {
                "subject": subject,
                    "body": {
                    "contentType": "Text",
                        "content": message
                },
                "toRecipients": recpArr
            },
            "saveToSentItems": "true"
        }
        };
        await this.graphMain.sendReqSingle(chatID, req);
        return true;
    }
};