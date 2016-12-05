"use strict";
const express = require('express');
const router = express.Router();
const UserClient = require('../models/users');
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
                console.error("Failed to serve calendar file: " + err);
                res.status(404).send("Error, we couldn't find this calendar");
            }

        });
    }).catch((err) => {
        console.error("Failed to serve calendar file: " + err);
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

// render `edit calendar` page
// GET /calendars/:id/edit
router.get('/:id/edit', (req, res) => {
    if (req.session && req.session.user) {
        let id = req.params.id;
        CalendarClient.getCalendarById(id)
            .then((calendar) => {
                let users = calendar.users_subscribed;
                let subscribed = users.includes(req.session.user.username);
                res.render("editCalendar", {
                    username: req.session.user.username,
                    subscribed: subscribed
                });
            });
    } else {
        res.redirect('/');
    }
});

router.get('/import', (req, res) => {
    //TODO: implement
    res.render('calendars/import');
});

//Get index of calendars
//GET /calendars/
router.get('/', (req, res) => {

    res.send('GET list of calendars');
});

//Send calendar data to create a new calendar
//POST /calendars/new
router.post('/new', (req, res) => {
    //check if calendar was sent to us
    if (!("calendar" in req.body)) {
        console.error("no calendar found");
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
            // Set created_by
            calendar.created_by = req.session.user.username;
            //Construct list of subscribed users
            calendar.users_subscribed = [];
            //Add creator as a subscriber
            calendar.users_subscribed.push(calendar.created_by);
            //Add filePath generated by Helper
            calendar.filepath = filePath;
            CalendarClient.addCalendar(calendar)
                .then((result) => {
                    if (result.result.ok == 1) {
                        UserClient.subscribe(calendar.created_by, result.insertedId)
                            .then((result2) => {
                                res.json({"status": "success", "id": result.insertedId});        
                            });
                        
                    } else {
                        console.error("Failed inserting new calendar into db");
                        res.json({"status": "failed", "userid": req.session.username});
                    }
                });
        });
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
        calendar.created_by = oldCalendar.created_by;
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
                            console.error("Promise returned a different filepath than expected");
                            res.json({"status": "failed"});
                        }
                    }).catch((err) => {
                        console.error("Failed on promise to update file: " + err);
                        res.json({"status": "failed"});
                    });
                } else {
                    //We didn't find any documents with such id in the database
                    console.error("Failed to update calendar in database");
                    res.json({"status": "failed"});
                }
            });
    });

});

//Get particular by id
//Get /calendars/:id
router.get('/:id', (req, res) => {
    if (req.session && req.session.user) {
        let id = req.params.id;
        CalendarClient.getCalendarById(id)
            .then((calendar) => {
                let users = calendar.users_subscribed;
                let subscribed = users.includes(req.session.user.username);
                res.render("calendar", {
                    username: req.session.user.username,
                    subscribed: subscribed,
                    email: req.session.user.email
                });

                
            });
    } else {
        res.redirect('/');
    }
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
                            console.error("Failed to remove calendar file: " + err);
                            res.json({"status": "failed"});
                        });
                } else {
                    console.error("Failed to delete calendar from database");
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
