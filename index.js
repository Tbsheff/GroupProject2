let express = require("express");
let session = require('express-session');
let app = express();

app.use(session({
    secret: 'asd;lfkja;ldfkjlk123389akjdhla987897akjh78111ih',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

let flash = require('connect-flash');
app.use(flash());



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
                    res.redirect('/account');

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

app.get("/newRide", isAuthenticated, (req, res) => {
    res.render("addRide", { user: req.session.user, userId: req.session.user.id });
});

app.get("/rides", isAuthenticated, (req, res) => {
    let studentId = req.session.user.id;

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
        knex.raw('(r.max_students - COUNT(sr.student_id) - 1) AS spots_remaining'),
        //determines if user has joined the ride or not
        knex.raw('CASE WHEN EXISTS (SELECT 1 FROM student_ride WHERE student_id = ? AND ride_id = r.ride_id) THEN true ELSE false END as hasjoined', [studentId]),
        //determines if the user is the ride host or not
        knex.raw('CASE WHEN r.student_driver = ? THEN true ELSE false END as isDriver', [studentId])
    )
        .from('ride as r')
        .leftJoin('student_ride as sr', 'r.ride_id', 'sr.ride_id')
        .groupBy('r.ride_id')
        .having('r.max_students', '>', knex.raw('COUNT(sr.student_id)'))
        .andHaving(knex.raw('(r.max_students - COUNT(sr.student_id) - 1)'), '>', 0)
        .then(rides => {
            const formattedRides = rides.map(ride => {

                //setting isDriver to ensure both are string
                const isDriver = String(ride.student_driver) === String(studentId);

                return {
                    ...ride,
                    formattedDateLeaving: formatDate(ride.date_leaving),
                    formattedTimeLeaving: formatTime(ride.time_leaving),
                    isDriver: isDriver
                };
            });
            res.render("rideDetails", { allRides: formattedRides, user: req.session.user });
        });
});

app.post("/newRide", (req, res) => {
    knex("ride").insert(req.body).then(rides => {
        res.redirect("/account");
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

                res.redirect("/account"); // Redirect if the transaction is successful
            })
            .catch(error => {
                res.status(500).json({ error }); // Handle errors
            });
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

//creates route for page to display account info + joined/hosted rides
app.get('/account', isAuthenticated, async (req, res) => {
    try {
        // grab the student_id
        let studentId = req.session.user.id;

        let accountResults = await knex
            .select(
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
            .where('s.student_id', studentId);

        let joinedRides = await knex('student_ride')
            .join('ride', 'student_ride.ride_id', '=', 'ride.ride_id')
            .where('student_ride.student_id', studentId)
            .select('ride.*', knex.raw("'joined' as rideType"));

        let hostedRides = await knex('ride')
            .where({ student_driver: studentId })
            .select('*', knex.raw("'hosted' as rideType"));

        // Modify joined rides
        let modifiedJoinedRides = joinedRides.map(ride => ({
            ...ride,
            formattedDateLeaving: formatDate(ride.date_leaving),
            formattedTimeLeaving: formatTime(ride.time_leaving),
            isDriver: ride.student_driver === studentId,
        }));

        //get information of students who joined your ride
        for (let ride of hostedRides) {
            let joiningStudents = await knex('student_ride')
                .join('student', 'student_ride.student_id', 'student.student_id')
                .where('student_ride.ride_id', ride.ride_id)
                .select('student.first_name', 'student.last_name', 'student.phone_number', 'student.email');
        
            //stick joined students into an array for easy access
            ride.joiningStudents = joiningStudents || [];
        }
        
        let modifiedHostedRides = hostedRides.map(ride => ({
            ...ride,
            formattedDateLeaving: formatDate(ride.date_leaving),
            formattedTimeLeaving: formatTime(ride.time_leaving),
            isDriver: ride.student_driver === studentId,
        }));

        res.render('account', {
            allAccounts: accountResults,
            rides: modifiedJoinedRides,
            hostedRides: modifiedHostedRides,
            user: req.session.user,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


//creating get for the ridereceipt page
app.get('/ride-Receipt', isAuthenticated, (req, res) => {
    let rideId = req.query.rideId;

    //joining to grab driver information
    knex('ride')
        .join('student', 'ride.student_driver', 'student.student_id')
        .where('ride.ride_id', rideId)
        .first('ride.*', 'student.first_name', 'student.last_name', 'student.phone_number', 'student.email')
        .then(ride => {

            //format date/time
            const formattedRide = {
                ...ride,
                formattedDateLeaving: formatDate(ride.date_leaving),
                formattedTimeLeaving: formatTime(ride.time_leaving)
            };

            //render the receipt page
            res.render('rideReceipt', { ride: formattedRide, user: req.session.user });
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
                .then(() => {
                    // Redirect to a new page after the transaction is successful
                    res.redirect('/account');
                })
                .catch((error) => {
                    // Handle any errors that occur during the transaction
                    console.error(error);
                    // Optionally, redirect to an error page or send an error response
                    req.flash('alert', 'There was an error updating your account. Please try again.');
                    res.redirect('/account');
                });

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
            .then(() => {
                // Redirect to a new page after the transaction is successful
                res.redirect('/account');
            })
            .catch((error) => {
                // Handle any errors that occur during the transaction
                console.error(error);
                // Optionally, redirect to an error page or send an error response
                req.flash('alert', 'There was an error updating your account. Please try again.');

                res.redirect('/account');
            });

    }
});

app.post('/modify-ride-info/:rideId', isAuthenticated, (req, res) => {
    console.log(req.body);
    const rideId = req.params.rideId; 

    knex.transaction(trx => {
        return trx('ride')
            .where({
                'student_driver': req.session.user.id, 
                'ride_id': rideId 
            })
            .update({
                // Update the ride details based on the request body
                start_state: req.body.start_state,
                start_city: req.body.start_city,
                end_state: req.body.end_state,
                end_city: req.body.end_city,
                formattedDateLeaving: req.body.leave_date, 
                formattedTimeLeaving: req.body.leave_time 
            });
    })
    .then(() => {
        res.redirect('/account-driving');
    })
    .catch((error) => {
        console.error(error);
        req.flash('alert', 'There was an error updating the ride information. Please try again.');
        res.redirect('/modify-ride-info/' + rideId); 
    });
});


//logic for passing user information to the database when they join a ride
app.post('/join-ride', isAuthenticated, (req, res) => {
    let studentId = req.session.user.id;
    let rideId = req.body.ride_id;

    knex('student_ride')
        .insert({ student_id: studentId, ride_id: rideId })
        .then(() => {
            res.redirect(`/ride-Receipt?rideId=${rideId}`);
        })
});

//leave ride logic specifically to redirect back onto the account page
app.post('/leave-rideAccount', isAuthenticated, (req, res) => {
    let studentId = req.session.user.id;
    let rideId = req.body.ride_id;

    knex('student_ride')
        .where({ student_id: studentId, ride_id: rideId })
        .del()
        .then(() => {
            res.redirect(`/account#rides`);
        })
});

//logic to allow users to delete a ride they hosted
app.post('/delete-ride', isAuthenticated, (req, res) => {
    let studentId = req.session.user.id;
    let rideId = req.body.ride_id;

    knex.transaction(async trx => {
        try {
            //delete all in student_ride table
            await trx('student_ride').where('ride_id', rideId).del();

            //delete ride
            await trx('ride').where({ 'ride_id': rideId, 'student_driver': studentId }).del();

            res.redirect('/account#rides-hosted');
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting the ride.");
        }
    });
});




app.listen(port, () => console.log("Server is running"));