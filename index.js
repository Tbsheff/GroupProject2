let express = require("express");
let session = require('express-session');
let app = express();

app.use(session({
    secret: 'asd;lfkja;ldfkjlk123389akjdhla987897akjh78111ih',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));



let path = require("path");

let knex = require("knex")({
    client: "pg",
    connection: {
        host: "cougar-cruiser.postgres.database.azure.com",
        user: "admin403",
        password: "nq4yML^boKwZQCwG",
        database: "cougar_cruiser",
        port: 5432
    },
    debug: true
});

let bcrypt = require('bcrypt');
let saltRounds = 10;

function formatDate(dateString) {
    // Parse the date string into a JavaScript Date object
    const date = new Date(dateString);

    // Check if the parsed date is valid
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }

    // Format the date
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
}

function formatTime(timeString) {
    try {
        const [hours, minutes, seconds] = timeString.split(':');
        const parsedHours = parseInt(hours, 10);
        const parsedMinutes = parseInt(minutes, 10);

        if (isNaN(parsedHours) || isNaN(parsedMinutes)) {
            throw new Error('Invalid Time');
        }

        const period = parsedHours >= 12 ? 'PM' : 'AM';
        const formattedHours = parsedHours % 12 || 12;
        const formattedMinutes = minutes.padStart(2, '0');

        console.log(`Parsed Hours: ${parsedHours}`);
        console.log(`Parsed Minutes: ${parsedMinutes}`);

        return `${formattedHours}:${formattedMinutes} ${period}`;
    } catch (error) {
        return `Invalid Time: ${timeString}`;
    }
}

function isAuthenticated(req, res, next) {
    console.log(req.session.user);
    if (req.session && req.session.user) {
        console.log(req.session.user);
        return next(); // User is authenticated, proceed to the next function

    }
    // User is not authenticated
    res.redirect('/login');
}





//Changed port to specify what environment our application will be running on
const port = process.env.PORT || 3001;

app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.render("index", { user: req.session.user }));

app.get("/login", (req, res) =>
    res.render("login", { user: req.session.user }));

app.post("/login", (req, res) => {
    // Extract the username and plain text password from the request
    const { username, password } = req.body;

    // Retrieve the user's hashed password from the database
    knex.select('*').from('security').where({ username })
        .then(users => {
            if (users.length === 0) {
                res.status(401).json({ error: 'Invalid username or password' });
                return;
            }

            let user = users[0];
            let hash = users[0].password;

            // Compare the provided password with the stored hash
            bcrypt.compare(password, hash, (err, result) => {
                if (err) {
                    res.status(500).json({ error: 'Error verifying password' });
                    return;
                }

                if (result) {
                    // Login successful
                    req.session.user = { username: user.username, id: user.student_id };
                    console.log(req.session.user)
                    res.redirect('/rides');

                } else {
                    // Passwords do not match
                    res.status(401).json({ error: 'Invalid username or password' });
                }
            });
        })
        .catch(error => {
            console.error('Error during login:', error);
            res.status(500).json({ error: error.message || error });
        });
});


app.get("/rides", isAuthenticated, (req, res) => {
    knex.select(
        'r.ride_id',
        'r.start_state',
        'r.start_city',
        'r.start_zip',
        'r.student_driver',
        'r.date_leaving',
        'r.time_leaving',
        'r.end_city',
        'r.end_state',
        'r.end_zip',
        'r.max_students',
        knex.raw('COUNT(sr.student_id) AS current_students'),
        knex.raw('(r.max_students - COUNT(sr.student_id) - 1) AS spots_remaining')
    )
        .from('ride as r')
        .leftJoin('student_ride as sr', 'r.ride_id', 'sr.ride_id')
        .groupBy('r.ride_id')
        .having('r.max_students', '>', knex.raw('COUNT(sr.student_id)'))
        .andHaving(knex.raw('(r.max_students - COUNT(sr.student_id) - 1)'), '>', 0)
        .then(rides => {
            const formattedRides = rides.map(ride => ({
                ...ride,
                formattedDateLeaving: formatDate(ride.date_leaving),
                formattedTimeLeaving: formatTime(ride.time_leaving)
            }));
            console.log(formattedRides);
            res.render("rideDetails", { allRides: formattedRides, user: req.session.user });
        })

}
);

app.get("/newRide", (req, res) =>
    res.render("addRide", { user: req.session.user }));

app.post("/newRide", (req, res) => {
    knex("ride").insert(req.body).then(rides => {
        res.redirect("/");
    })
}
);

app.get("/signup", (req, res) =>
    res.render("signUp", { user: req.session.user }));


app.post("/signup", (req, res) => {

    // Extract the plain text password from the request
    let plainTextPassword = req.body.password;

    // Hash the password
    bcrypt.hash(plainTextPassword, saltRounds, (err, hash) => {
        if (err) {
            res.status(500).json({ error: 'Error hashing password' });
            return;
        }

        // Start a transaction
        knex.transaction(trx => {
            // insert into the Student table
            return trx.insert({
                first_name: req.body.first_name,
                last_name: req.body.last_name,
                city: req.body.city,
                state: req.body.state,
                zip: req.body.zip,
                email: req.body.email,
                phone_number: req.body.phone_number
            })
                .into('student')
                .returning('student_id')
                .then(studentIds => {
                    // insert into the Security table
                    console.log('Inserted student ID:', studentIds[0]);

                    return trx('security').insert({
                        username: req.body.username,
                        password: hash,
                        student_id: studentIds[0].student_id  // Use the returned student_id
                    });
                })
        })
            .then(() => {

                res.redirect("/"); // Redirect if the transaction is successful
            })
            .catch(error => {
                res.status(500).json({ error }); // Handle errors
            });
    });
});


app.get("/joinride/:ride_id", (req, res) => {
    let rideId = req.params.ride_id;

    knex.select(
        'r.ride_id',
        'r.start_state',
        'r.start_city',
        'r.start_zip',
        'r.student_driver',
        'r.date_leaving',
        'r.time_leaving',
        'r.end_city',
        'r.end_state',
        'r.end_zip',
        'r.max_students',
        knex.raw('COUNT(sr.student_id) AS current_students'),
        knex.raw('(r.max_students - COUNT(sr.student_id) - 1) AS spots_remaining')
    )
        .from('ride as r')
        .leftJoin('student_ride as sr', 'r.ride_id', 'sr.ride_id')
        .where('r.ride_id', '=', rideId)  // Use the variable instead of req.params
        .groupBy('r.ride_id')
        .having('r.max_students', '>', knex.raw('COUNT(sr.student_id)'))
        .andHaving(knex.raw('(r.max_students - COUNT(sr.student_id) - 1)'), '>', 0)
        .then(rides => {
            const formattedRides = rides.map(ride => ({
                ...ride,
                formattedDateLeaving: formatDate(ride.date_leaving),
                formattedTimeLeaving: formatTime(ride.time_leaving)
            }));

            console.log(formattedRides);
            res.render("joinRide", { ride: formattedRides, user: req.session.user });
        });
});

// log out of session
app.get('/logout', (req, res) => {
    // Clears session to log the user out
    req.session.destroy((err) => {
        if (err) {
            console.error(err);
        }
        res.redirect('/');
    });
});


app.get('/account', isAuthenticated, (req, res) => {
    //grab the student_id
    let studentId = req.session.user.id;

    knex.select(
        's.student_id',
        's.first_name',
        's.last_name',
        's.city',
        's.state',
        's.zip',
        's.email',
        's.phone_number',
        'sec.username'
    )
    .from('student as s')
    .join('security as sec', 'sec.student_id', 's.student_id')
    .where('s.student_id', studentId)
    .then(accountResults => {
        //grabbing the "joined ride" info for the account
        return knex('student_ride')
            .join('ride', 'student_ride.ride_id', '=', 'ride.ride_id')
            .where('student_ride.student_id', studentId)
            .select('ride.*')
            .then(ridesResults => {
                //formatting the time/date aspects
                const formattedRides = ridesResults.map(ride => ({
                    ...ride,
                    formattedDateLeaving: formatDate(ride.date_leaving),
                    formattedTimeLeaving: formatTime(ride.time_leaving)
                }));

                res.render('account', { allAccounts: accountResults, rides: formattedRides, user: req.session.user });
            });
    })
});


app.post('/modify-user', isAuthenticated, (req, res) => {
    console.log(req.body);
    if (req.body.password != "") {
        let plainTextPassword = req.body.password;

        // Hash the password
        bcrypt.hash(plainTextPassword, saltRounds, (err, hash) => {
            if (err) {
                res.status(500).json({ error: 'Error hashing password' });
                return;
            }

            knex.transaction(trx => {
                return trx('security')
                    .where('student_id', req.session.user.id)
                    .update({
                        username: req.body.username,
                        password: hash
                    })
                    .then(() => {
                        return trx('student')
                            .where('student_id', req.session.user.id)
                            .update({
                                first_name: req.body.first_name,
                                last_name: req.body.last_name,
                                city: req.body.city,
                                state: req.body.state,
                                zip: req.body.zip,
                                email: req.body.email,
                                phone_number: req.body.phone_number
                            });
                    });
            })

        });
    }
    else {
        knex.transaction(trx => {
            return trx('security')
                .where('student_id', req.session.user.id)
                .update({
                    username: req.body.username
                })
                .then(() => {
                    return trx('student')
                        .where('student_id', req.session.user.id)
                        .update({
                            first_name: req.body.first_name,
                            last_name: req.body.last_name,
                            city: req.body.city,
                            state: req.body.state,
                            zip: req.body.zip,
                            email: req.body.email,
                            phone_number: req.body.phone_number
                        });
                });
        })

    }
});

//logic for passing user information to the database when they join a ride
app.post('/join-ride', isAuthenticated, (req, res) => {
    let studentId = req.session.user.id;
    let rideId = req.body.ride_id; 

    //check if the student has already joined the ride
    knex('student_ride')
        .where({ student_id: studentId, ride_id: rideId })
        .first()
        .then(existingRecord => {
            if (existingRecord) {
                return res.status(400).send('You have already joined this ride.');
            }

            //if not already joined, insert the new record
            return knex('student_ride')
                .insert({ student_id: studentId, ride_id: rideId });
        })
        //redirect back to ride view page 
        .then(() => {
            res.redirect('/rides'); 
        })
});



app.listen(port, () => console.log("Server is running"));