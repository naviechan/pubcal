const express = require('express');
const router = express.Router();
const CalendarClient = require('../models/calendars');
const helper = require('../libs/icalGeneratorHelper');

//Get index of calendars
//GET /calendars/
router.get('/', (req, res) => {
    res.send('GET list of calendars');
});

//Get form for creating a calendar
//GET /calendars/new
router.get('/new', (req, res) => {
    res.send('form for a new calendar');
});

//Send calendar data to create a new calendar
//POST /calendars/new
router.post('/new', (req, res) => {
    // TODO: check if calendar is in the body
    let calendar = req.body.calendar;

    //TODO: check return value
    let filepath = helper.createCalendar(calendar);

    //Construct list of subscribed users
    calendar.users_subscribed = [];
    //Add creator as a subscriber
    calendar.users_subscribed.push(calendar.created_by);
    //Add filepath generated by helper
    calendar.filepath = filepath;

    CalendarClient.addCalendar(calendar)
        .then((result) => {
            if (result.result.ok == 1) {
                res.json({"status": "success", "id": result.insertedId});
            } else {
                console.error("Failed inserting new calendar into db");
                res.json({"status": "failed"});
            }
        })
});

//POST /calendars/search
router.post('/search', (req, res) => {
    let tag = req.body.tag;
    CalendarClient.searchForCalendars(tag, (result) => {
        if (!result.length) { // not found
            res.render('index_sample', {
                errors: 'no calendar matches your request'
            });
        } else {
            res.render('calendar_result_sample', {
                calendarResult: JSON.stringify(result)
            });
        }
    })
});

//Update a calendar by id
//POST /calendars/:id
router.put('/:id', (req, res) => {
    // TODO: ASSUME NOW WE HAVE THE FILTER AND UPDATE
    let filter = req.body.filter;
    let update = req.body.update;
    CalendarClient.updateCalendar(filter, update)
        .then((result) => {
            if (result) {
                // TODO: RENDER SUCCESS MESSAGE
                res.render();
            }
        });
});

//DELETE /calendars/:id
router.delete('/:id', (req, res) => {
    // TODO: ASSUME NOW WE HAVE THE FILTER
    let filter = req.body.filter;
    CalendarClient.removeCalendar(filter)
        .then((result) => {
            if (result) {
                // TODO: RENDER SUCCESS MESSAGE
                res.render();
            }
        });
});

// GET a calendar with id
//GET /calendars/:id
router.get('/:id', (req, res) => {
    res.send('GET calendar with id' + req.params.id);
});

module.exports = router;
