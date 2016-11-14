"use strict";
const express = require('express');
const router = express.Router();
const CalendarClient = require('../models/calendars');
const Helper = require('../libs/icalGeneratorHelper');


//Download iCal file for a calendar with id = :id
//GET /calendars/:id/download
router.get('/:id/download', (req, res) => {
    let id = req.params.id;
    let filePath = null;
    let filename = null;
    CalendarClient.getCalendarById(id).then((calendar) => {
        filePath = calendar.filepath;

        //filename is the last element of split array
        filename = filePath.split("/").slice(-1)[0];

        //added manual headers only to make downloading files have a proper filename,
        //without them it downloads as 'download' file.
        let options = {
            headers: {
                'x-timestamp': Date.now(),
                'x-sent': true,
                'content-disposition': "attachment; filename=" + filename
            }
        };

        res.sendFile(filePath, options, (err) => {
            if (err) {
                console.log("ERROR: failed to serve calendar file: " + err);
                res.status(404).send("Error, we couldn't find this calendar");
            }

        });
    }).catch((err) => {
        console.log("ERROR: failed to serve calendar file: " + err);
        res.send("Error, no such calendar");
    });
});

//Return json object for calendar with this id
// GET /calendars/:id/json
router.get('/:id/json', (req, res) => {
    let id = req.params.id;
    CalendarClient.getCalendarById(id)
        .then((calendar) => {
            res.json(calendar);
        })
        .catch((err) => {
            if (err)
                res.json({"status": "failed"});
        });
});

router.get('/import', (req, res) => {
    //TODO: implement
    res.render('calendars/import');
});

router.get('/search', (req, res) => {
    res.render('calendars/search', {results: {}});
});


//Get index of calendars
//GET /calendars/
router.get('/', (req, res) => {
    res.send('GET list of calendars');
});

//Get form for creating a calendar
//GET /calendars/new
router.get('/new', (req, res) => {
    res.render('createCalendar');
});

//Send calendar data to create a new calendar
//POST /calendars/new
router.post('/new', (req, res) => {
    //check if calendar was sent to us
    if (!("calendar" in req.body)) {
        console.log("no calendar found");
        res.json({"status": "failed"});
        return;
    }
    let calendar = req.body.calendar;
    let createCalendarFile = new Promise((resolve) => {
        let filePath = Helper.createCalendar(calendar);
        resolve(filePath);
    });
    createCalendarFile
        .then((filePath) => {
            //Construct list of subscribed users
            calendar.users_subscribed = [];
            //Add creator as a subscriber
            calendar.users_subscribed.push(calendar.created_by);
            //Add filePath generated by Helper
            calendar.filepath = filePath;
            CalendarClient.addCalendar(calendar)
                .then((result) => {
                    if (result.result.ok == 1) {
                        res.json({"status": "success", "id": result.insertedId});
                    } else {
                        console.error("Failed inserting new calendar into db");
                        res.json({"status": "failed"});
                    }
                });
        });
});

//POST /calendars/search
router.post('/search', (req, res) => {
    console.log(req.body);
    let query = "";
    let skip = 0;
    if ("query" in req.body)
        query = req.body.query;
    if ("skip" in req.body)
        skip = req.body.skip;

    CalendarClient.searchForCalendars(query, skip, (result) => {
        if (result != null) {
            console.log(result);
            res.send(result);
        } else {
            res.render('index_sample', {
                errors: 'no calendar matches your request'
            });
        }
    })
});

//Update a calendar by id
//PUT /calendars/:id
router.put('/:id', (req, res) => {
    if (!("calendar" in req.body)) {
        res.json({status: "failed"});
        return;
    }
    let id = req.params.id;
    let calendar = req.body.calendar;

    CalendarClient.getCalendarById(id).then((oldCalendar) => {
        //Get old calendar, copy its users and filePath, since we want to preserve this information
        //and frontend doesn't send this to us(for security)
        calendar.users_subscribed = oldCalendar.users_subscribed.slice();
        calendar.filepath = oldCalendar.filepath;
        return calendar;
    }).then((newCalendar) => {
        //Replace calendar object in the database first, newCalendar contains copied users and filePath
        CalendarClient.replaceCalendar(id, newCalendar)
            .then((result) => {
                if (result.modifiedCount == 1) {
                    //We are NOT doing upsert, so if modifiedCount >0, means that there was an actual record
                    //that we modified which is good
                    new Promise((resolve) => {
                        //We want to create a new iCal file on the disk with the same filePath(filename) as
                        let filePath = Helper.createCalendar(newCalendar, newCalendar.filepath);
                        resolve(filePath);
                    }).then((filePath) => {
                        if (filePath === newCalendar.filepath)
                            res.json({"status": "success", "id": id});
                        else {
                            //Something went horribly wrong
                            console.log("ERROR: Promise returned a different filePath than expected");
                            res.json({"status": "failed"});
                        }
                    }).catch((err) => {
                        console.log("ERROR: Failed on promise to update file: " + err);
                        res.json({"status": "failed"});
                    });
                } else {
                    //We didn't find any documents with such id in the database
                    console.log("ERROR: failed to update calendar in database");
                    res.json({"status": "failed"});
                }
            });
    });

});

//Get particular by id
//Get /calendars/:id
router.get('/:id', (req, res) => {
    let id = req.params.id;

    //TODO: WE don't want to return ALL fields of calendar object(ie user doesn't need to know filePath, user_subscribed etc...)
    CalendarClient.getCalendarById(id).then((calendar) => {
        console.log(calendar);
        res.render('calendar', calendar);
    });
});

//DELETE /calendars/:id
router.delete('/:id', (req, res) => {
    let id = req.params.id;

    //Keep old copy of calendar in case we need to restore it
    //For example: we removed database object, but disk file failed to get removed and we want to revert everything back
    let tmpCalendar;
    CalendarClient.getCalendarById(id)
        .then((calendar) => {
            tmpCalendar = calendar;
        }).then(() => {
        //Remove database object
        CalendarClient.removeCalendarById(id)
            .then((response) => {
                if (response.result.ok == 1 && response.result.n == 1) {
                    //Successful delete inside db
                    //Do file delete
                    Helper.deleteCalendar(tmpCalendar.filepath)
                        .then(() => {
                            //Successfully removed file
                            res.json({"status": "success"});
                        })
                        .catch((err) => {
                            console.log("ERROR: failed to remove calendar file: " + err);
                            res.json({"status": "failed"});
                        });
                } else {
                    console.log("ERROR: Failed to delete calendar from database");
                    res.json({"status": "failed"});
                }
            });
    });
});

//Import iCal file
//POST /calendars/import
router.post('/import', (req, res) => {
    //TODO: implement
    res.send("not implemented");
});

module.exports = router;
