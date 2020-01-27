const NodeCache = require( "node-cache" );

/*
* Config / Internal Imports
*/
const config = require('./../config.json');

module.exports = class Calendar {
    constructor(graphMain) {
        this.graphMain = graphMain;
        this.baseURL = this.graphMain.baseURL;
        this.cache = new NodeCache();
    }
    
    async getCalendars(chatID) {
        const req = {
            method: "get",
            url: this.baseURL + "me/calendars"
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        return result.data;
    }
    
    async createEvent(chatID, start, end, rooms, subject) {
        let attendees = [];
        const startString = this.dateToSharePointString(start);
        const endString = this.dateToSharePointString(end);

        for(let i = 0; i < rooms.length; i++) {
            attendees.push({
                  "emailAddress": {
                    "address": rooms[i] + "@academyconsult.de",
                    "name": rooms[i]
                  },
                  "type": "required"
                }
            );
        }
        const req = {
            method: "post",
            url: this.baseURL + "me/events",
            data: {
              "subject": subject,
              "body": {
                "contentType": "HTML",
                "content": subject
              },
              "start": {
                  "dateTime": startString,
                  "timeZone": config.calendar.timezone
              },
              "end": {
                  "dateTime": endString,
                  "timeZone": config.calendar.timezone
              },
              "location":{
                  "displayName": rooms.join
              },
              "attendees": attendees
            }
        };
        let result = await this.graphMain.sendReqSingle(chatID, req);
        this.cacheFlush();
        return result.data;
    }
    
    async getSchedule(chatID, start, end, rooms) {
        let roomsArr = [...rooms];
        const startString = this.dateToSharePointString(start);
        const endString = this.dateToSharePointString(end);
        let data = [];

        for(let i = 0; i < roomsArr.length; i++) {
            roomsArr[i] = roomsArr[i] + "@academyconsult.de";
            let roomData = this.cache.get(roomsArr[i] + startString + endString);
            if(roomData !== undefined) {
                roomsArr.splice(i,1);
                data.push(roomData);
                i--;
            }
        }
        if(roomsArr.length > 0) {
            const req = {
                method: "post",
                url: this.baseURL + "me/calendar/getSchedule",
                data: {
                    "schedules": roomsArr,
                    "startTime": {
                        "dateTime": startString,
                        "timeZone": config.calendar.timezone
                    },
                    "endTime": {
                        "dateTime": endString,
                        "timeZone": config.calendar.timezone
                    },
                    "availabilityViewInterval": config.calendar.availabilityViewInterval
                },
                headers: {
                    "Prefer": 'outlook.timezone="' + config.calendar.timezone + '"'
                }
            };

            let result = await this.graphMain.sendReqSingle(chatID, req);
            const newData = result.data.value;
            for (let i = 0; i < newData.length; i++) {
                data.push(newData[i]);
                this.cache.set(newData[i].scheduleId + startString + endString, newData[i], 300);
            }
        }
        return data;
    }
    
    async getStringSchedule(chatID, start, end, rooms, dispTitle) {
        const data = await this.getSchedule(chatID, start, end, rooms);
        
        const offset = (new Date().getTimezoneOffset() / 60) * -1;
        let resString = "";
        for(let i = 0; i < data.length; i++) {
            if(dispTitle) {
                resString = resString + "\n" + this.parseCalTitle(data[i].scheduleId) + ":";
            }
            const roomData = data[i].scheduleItems;
            for(let j = 0; j < roomData.length; j++) {
                const startTime = new Date(roomData[j].start.dateTime);
                //startTime.setHours(startTime.getHours() + offset);
                const endTime = new Date(roomData[j].end.dateTime);
                //endTime.setHours(endTime.getHours() + offset);
                resString = resString + "\n" + this.dateToString(startTime) + " - " +  this.dateToString(endTime) + " " + roomData[j].subject;
            }
            if (roomData.length === 0) {
                resString = resString + "\nKeine Reservierungen im ausgewählten Zeitraum."
            }
        }
        
        return resString;
    }
    
    async getAvalSchedule(chatID, start, end, rooms) {
        const data = await this.getSchedule(chatID, start, end, rooms);
        const curTime = new Date();

        let resString = "";
        for(let i = 0; i < data.length; i++) {
            resString = resString + "\n" + this.parseCalTitle(data[i].scheduleId) + ": ";
            let roomData = data[i].scheduleItems;
            
            let free;
            let lastEnd;
            let reservedBy = [];

            for(let j = 0; j < roomData.length; j++) {
                let startTime = new Date(roomData[j].start.dateTime);
                let endTime = new Date(roomData[j].end.dateTime);

                if((startTime < curTime && endTime > curTime) || free === false) {
                    if (lastEnd !== undefined) {
                        if (lastEnd !== false) {
                            if (roomData[lastEnd].end.dateTime === roomData[j].start.dateTime) {
                                let resSubject = roomData[j].subject.trim();
                                if(!reservedBy.includes(resSubject)) {
                                    reservedBy.push(resSubject);
                                }
                                lastEnd = j;
                            } else {
                                let lastEndDate = new Date(roomData[lastEnd].end.dateTime);
                                resString = resString + "Belegt bis: " + this.dateToString(lastEndDate) + " " + reservedBy.join(", ");
                                lastEnd = false;
                            }
                        }
                    } else {
                        lastEnd = j;
                        reservedBy.push(roomData[j].subject.trim());
                    }
                    free = false;
                } else {
                    if(free) {
                        if(free > startTime && startTime > curTime) {
                            free = startTime;
                        }
                    } else if((startTime > curTime)){
                        free = startTime;
                    }
                }
            }

            if(free) {
                if(free > curTime) {
                    resString = resString + "Frei bis: " +  this.dateToString(free);
                }
            } else if(lastEnd !== undefined) {
                if (lastEnd !== false) {
                    resString = resString + "Belegt bis: " + this.dateToString(new Date(roomData[lastEnd].end.dateTime)) + " " + reservedBy.join(", ");
                }
            } else {
                resString = resString + "Frei bis mindestens: " + this.dateToString(end);
            }
        }
        
        return resString;
    }
    
    async getOptAvalSchedule(chatID, start, end, rooms) {
        const data = await this.getSchedule(chatID, start, end, rooms);

        let availabilityViews = [];

        for(let i = 0; i < data.length; i++) {
            const roomData = data[i].scheduleItems;
            availabilityViews.push(data[i].availabilityView.split(""));
        }
        let slots = [];
        let slotStart = -1;
        for(let i = 0; i < availabilityViews[0].length; i++) {
            let avail = true;
            for(let j = 0; j < availabilityViews.length; j++) {
                if (availabilityViews[j][i] !== "0") {
                    avail = false;
                }
            }
            if(slotStart < 0 && avail) {
                slotStart = i * config.calendar.availabilityViewInterval;
            }else if(slotStart >= 0 && !avail) {
                const slotEnd = (i * config.calendar.availabilityViewInterval);
                slots.push({slotStart, slotEnd});
                slotStart = -1;
            }
        }
        if(slotStart >= 0) { //Push last time
            const slotEnd = (availabilityViews[0].length * config.calendar.availabilityViewInterval);
            slots.push({slotStart, slotEnd});
        }
        const dateSlots = [];

        for (let i = 0; i < slots.length; i++) {
            var startHour = Math.floor(slots[i].slotStart / 60);
            var startMinutes = slots[i].slotStart % 60;
            var endHour = Math.floor(slots[i].slotEnd / 60);
            var endMinutes = slots[i].slotEnd % 60;

            if(endHour === 24 && endMinutes === 0) { //Prevent from hitting tomorrow
                endHour = 23;
                endMinutes = 59;
            }

            var resultStartDate = new Date(start.getTime());
            resultStartDate.setHours(startHour, startMinutes);

            var resultEndDate = new Date(start.getTime());
            resultEndDate.setHours(endHour, endMinutes);

            dateSlots.push({resultStartDate,resultEndDate});
        }

        return dateSlots;
    }
    
    dateToString(date) {
        const res = date.getDate() + "." + (date.getMonth()+1) + ". " + date.getHours() + ":" + (date.getMinutes()<10?'0':'') + date.getMinutes();
        return res;
    }

    dateToDateString(date) {
        const res = date.getDate() + "." + (date.getMonth()+1) + ".";
        return res;
    }

    dateToSharePointString(date) {
        var hrVal = date.getHours().toString();
        var minVal = date.getMinutes().toString();
        var secVal = date.getSeconds().toString();
        if (hrVal.length < 2) {hrVal = "0" + hrVal};
        if (minVal.length < 2) {minVal = "0" + minVal};
        if (secVal.length < 2) {secVal = "0" + secVal};
        return date.getFullYear() + '-' + (date.getMonth()+1) + '-' + date.getDate() + "T" + hrVal + ":" + minVal + ":" + secVal; // Format T00:00:00
    }

    dateToTimeString(date) {
        var hrVal = date.getHours().toString();
        var minVal = date.getMinutes().toString();
        if (hrVal.length < 2) {hrVal = "0" + hrVal;}
        if (minVal.length < 2) {minVal = "0" + minVal;}
        return hrVal + ":" + minVal; // Format 00:00
    }
    
    parseCalTitle(title) {
        return title.split("@")[0];
    }

    async cacheFlush() {
        await this.sleep(10000); //TODO: Find Correct Interval
        this.cache.flushAll();
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};