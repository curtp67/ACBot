const mongoose = require('mongoose');
const mongooseStringQuery = require('mongoose-string-query');

const graphTokenSchema = new mongoose.Schema(
	{
		chatID: {
			type: Number,
			required: true
		},
        userID: {
			type: String,
			required: true
		},
		data: {
			accessToken: {type: String},
			refreshToken: {type: String},
			expiry: {type: String}
		},
	},
	{ minimize: false, timestamps: true},
);

graphTokenSchema.plugin(mongooseStringQuery);

const graphTokenModel = mongoose.model('graphTokenModel', graphTokenSchema);

exports.addToken = async function(chatID, accessToken, refreshToken, expiry, userID) {
    const curToken = await graphTokenModel.findOne({chatID: chatID});
    const tokenData = {
        chatID: chatID,
        userID: userID,
        data: {
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiry: expiry
        },
    }
    if(!curToken) {
        new graphTokenModel(tokenData).save();
    } else {
        graphTokenModel.updateOne({chatID: chatID}, tokenData).
        then((res) => {
            if (res.n !== 1) {
                throw("Error MongoDB: Entry Not Modified");
            }
        });
    }
};

exports.getToken = async function(chatID) {
    const token = await graphTokenModel.findOne({chatID: chatID});
    if (!token) {throw "No token";}
    return token;
};

exports.getChatID = async function(userID) {
    const token = await graphTokenModel.findOne({userID: userID});
    if(token) {
        return token.chatID;
    }
    return token;
};

exports.getUserID = async function(chatID) {
    const token = await graphTokenModel.findOne({chatID: chatID});
    if(token) {
        return token.userID;
    }
    return token;
};