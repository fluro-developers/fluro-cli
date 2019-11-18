var _ = require('lodash');
var async = require('async');
var Papa = require('papaparse');
var Fluro = require('fluro');
var fs = require('fs');
var path = require('path');
var util = require('util');
var moment = require('moment');
var inquirer = require('inquirer');
const chalk = require('chalk');

var cache = {};

///////////////////////////////////////////////////

var fluro = new Fluro({
    apiURL: 'staging',
    // apiURL: 'http://api.fluro.localhost:3000',
    // apiURL: 'https://api.fluro.io',
});



return async.waterfall([
    login,
    selectAccount,
    selectRealm,
    selectDeployment,
    askQuestions,

], done)

///////////////////////////////////////////////////

function login(next) {

    inquirer.prompt([{
                type: 'input',
                message: 'Type your Fluro user email address',
                name: 'username',
            },
            {
                type: 'password',
                message: 'Enter your password',
                name: 'password',
            },
        ])
        .then(answers => {

            //Login to Fluro
            fluro.auth.login(answers)
                .then(function(res) {
                    console.log('Logged in as', res.data.firstName, res.data.lastName)
                    return next();
                })
                .catch(next);
        })
}

///////////////////////////////////////////////////

function selectAccount(next) {


    console.log('Loading accounts...')
    fluro.api.get('/user/accounts').then(accountListLoaded, next)

    /////////////////////////////

    function accountListLoaded(res) {

        var choices = _.chain(res.data)
            .map(function(account) {
                return {
                    name: `${account.title}`,
                    value: account._id,
                }
            })
            .orderBy('name')
            .value();


        /////////////////////////////

        var userSession = fluro.auth.getCurrentUser();
        var currentAccount = userSession.account;

        /////////////////////////////

        choices = [{
                name: `${currentAccount.title}`,
                value: currentAccount._id,
            },
            new inquirer.Separator(),
        ].concat(choices)

        /////////////////////////////

        inquirer.prompt([{
                type: 'list',
                name: 'account',
                message: 'Please select your account',
                choices,
            }])
            .then(function(answers) {
                fluro.auth.changeAccount(answers.account).then(function(res) {
                    console.log(`Signed in to ${res.data.account.title}`)
                    return next();
                }, next)

            }, next);
    }
}
///////////////////////////////////////////////////

function selectRealm(next) {

    console.log('Loading Realms...');

    fluro.api.get('/realm/selectable', {
            params: {
                flat: true
            }
        })
        .then(function(res) {


            ///////////////////////////////////////

            var choices = _.chain(res.data)
                .map('realms')
                .flatten()
                .filter(function(realm) {
                    return realm.status != 'archived' && !realm._discriminator && !realm._discriminatorType;
                })
                .map(function(realm) {
                    // var pieces = file.split('/');
                    return {
                        name: realm.title,
                        value: realm,
                    }
                })
                .orderBy(function(realm) {
                    return String(realm.name).toLowerCase();
                })
                .value();

            ///////////////////////////////////////

            if (choices.length == 1) {
                return next(null, choices[0].value)
            }
            ///////////////////////////////////////

            inquirer.prompt([{
                    type: 'list',
                    name: 'realm',
                    message: 'Select a realm',
                    choices,
                }])
                .then(function(answers) {
                    return next(null, answers.realm);

                }, next);

        }, next);
}

//////////////////////////////////////////


function selectDeployment(defaultRealm, next) {

    console.log('Loading existing deployments');


    fluro.api.get('/content/deployment', {
            params: {
                allDefinitions: true
            }
        })
        .then(function(res) {
            var choices = _.chain(res.data)
                .map(function(deployment) {
                    return {
                        name: deployment.title,
                        value: deployment,
                    }
                })
                .orderBy(function(deployment) {
                    return String(deployment.name).toLowerCase();
                })
                .value();

            /////////////////////////

            if (!choices.length) {
                //there is no current deployment
                return createNewDeployment();
            }

            /////////////////////////

            choices = [{
                    name: 'Create a new deployment',
                    value: '',
                },
                new inquirer.Separator(),
            ].concat(choices);

            ///////////////////////////////////////

            inquirer.prompt([{
                    type: 'list',
                    name: 'deployment',
                    message: 'Deployment',
                    choices,
                }])
                .then(function(answers) {

                    if (!answers.deployment) {
                        return createNewDeployment();
                    }

                    return next(null, defaultRealm, answers.deployment);
                }, next);

        }, next);

    //////////////////////////////////////////////
    //////////////////////////////////////////////
    //////////////////////////////////////////////

    function createNewDeployment() {


        var currentUser = fluro.auth.getCurrentUser();

        inquirer.prompt([

                {
                    type: 'input',
                    message: 'Deployment Title',
                    default: `My New Deployment`,
                    name: 'title',
                },
                {
                    type: 'list',
                    message: 'Choose your framework',
                    name: 'framework',
                    choices: [{
                            name: 'Vue.js',
                            value: 'vue',
                        },
                        {
                            name: 'React',
                            value: 'react',
                        },
                        {
                            name: 'Angular',
                            value: 'angular',
                        },
                        {
                            name: 'Other / Static HTML',
                            value: 'application',
                        },
                    ]
                },
                {
                    type: 'input',
                    message: 'Create a unique deployment ID',
                    name: 'deployment',
                    default (answers) {

                        var accountName = currentUser.account.title;
                        var defaultDeploymentID = String(`com.${accountName.replace(/[^\w.]+/g, "")}.${answers.title.replace(/[^\w.]+/g, "")}.${answers.framework}`).toLowerCase();
                        return defaultDeploymentID;
                    }
                },
            ])
            .then(function(answers) {

                var deployment = {
                    title: `${answers.title}`,
                    _type: 'deployment',
                    realms: [defaultRealm],
                    distributionKey: `${answers.deployment}`,
                }

                console.log('Creating Deployment...');
                return create(deployment)
                    .then(function(deployment) {
                        console.log('Deployment created')

                        deployment._new = true;
                        return next(null, defaultRealm, deployment);
                    }, next);




            })
            .catch(next);
    }
}

//////////////////////////////////////////

function askQuestions(defaultRealm, deployment, next) {

    if (!defaultRealm) {
        return next('Invalid Realm');
    }

    //////////////////////////////////////////

    console.log(`Creating in ${defaultRealm.title}`);


    //////////////////////////////////////////


    inquirer.prompt([{
                type: 'input',
                message: 'Application Title',
                default(answers) {
                    return deployment._new ? deployment.title : null;
                },
                name: 'title',
            },
            {
                type: 'list',
                message: 'Require users to login to this app',
                name: 'requireLogin',
                default: false,
                choices: [{
                        name: 'Yes',
                        value: true,
                    },
                    {
                        name: 'No',
                        value: false,
                    },
                ]
            },
        ])
        .then(answers => {
            async.waterfall([
                createApplication,
                downloadBoilerplate,
            ], function(err, application, boilerplate) {

                if(err) {
                    return next(err);
                }

                console.log('CREATED', application.boilerplate);
                return next(null, {
                    deployment,
                    application,
                    boilerplate,
                })
            });

            ///////////////////////////////////////

            function createApplication(next) {

                var authenticationStyle = 'application';
                var permissionSets = [];
                var origins = [
                    'http://localhost:8080',
                    'http://localhost:8081',
                    'http://localhost:8082',
                ]

                var application = {
                    title: `${answers.title}`,
                    _type: 'application',
                    realms: [defaultRealm],
                    deployment: `${deployment.distributionKey}`,
                    requireLogin: answers.requireLogin,
                    // domain:autogeneratedDomain,
                    lockAccount: true,
                    authenticationStyle,
                    permissionSets,
                    privateDetails:{
                        origins,
                    }

                }

                console.log('Creating Application instance...');

                return create(application)
                    .then(function(application) {
                        console.log('Application instance created')
                        return next(null, application);
                    }, next);
            }

            ///////////////////////////////////////

            function downloadBoilerplate(application, next) {
                console.log('Downloading Boilerplate')
                var boilerplate = null;
                return next(null, application, boilerplate);
            }
        })

}

///////////////////////////////////////////////////

function create(data) {

    return new Promise(function(resolve, reject) {

        var type = data.definition || data._type;

        /////////////////////////////////////////////

        fluro.api.post(`/content/${type}`, data)
            .then(function(res) {
                resolve(res.data);
            })
            .catch(reject);
    })
}

///////////////////////////////////////////////////

function splitString(source, splitBy) {
    var splitter = splitBy.split('');
    splitter.push([source]); //Push initial value

    return splitter.reduceRight(function(accumulator, curValue) {
        var k = [];
        accumulator.forEach(v => k = [...k, ...v.split(curValue)]);
        return k;
    });
}


///////////////////////////////////////////////////

function mapValue(input, output, from, to) {
    var value = _.get(input, from);

    if (!value) {
        return;
    }

    _.set(output, to, value);
}



// ///////////////////////////////////////////////////




// ///////////////////////////////////////////////////

// async.waterfall([
//     loginToFluro,
//     loadCSV,
//     formatAndSendRows,
// ], done);


// ///////////////////////////////////////////////////

// function loginToFluro(next) {
//     console.log('Login to Fluro')

//     fluro.auth.login({
//             username: answers.username,
//             password: answers.password,
//         })
//         .then(function(res) {
//             console.log('Logged in!', res.data.firstName, res.data.lastName)
//             return next();
//         }, next)
// }

// ///////////////////////////////////////////////////

// function loadCSV(next) {
//     return ('Failed on purpose');

//     console.log('Load the CSV');
//     var results = [];

//     /////////////////////////////////////////////

//     var readStream = fs.createReadStream('notes.csv');
//     Papa.parse(readStream, {
//         header: true,
//         complete: function() {

//             results = _.sortBy(results, function(row) {
//                 return _.get(row, 'Member ID');
//             })

//             return next(null, results);
//         },
//         step: function(result) {
//             result.data.index = results.length;
//             results.push(result.data);
//             // console.log('parsed', results.length);
//         },
//         error: next,
//     })
// }

// ///////////////////////////////////////////////////

// function formatAndSendRows(data, next) {

//     if (start) {
//         data = data.slice(start);
//     }

//     console.log('Importing', data.length);

//     //Do 5 at a time with a short break in between
//     async.mapLimit(data, CONCURRENCY, formatAndSend, function(err, formatted) {
//         if (err) {
//             return next(err);
//         }


//         // setTimeout(function() {
//         return next(null, formatted);
//         // }, 500);

//     });
// }




///////////////////////////////////////////////////

function done(err, pieces) {

    if (err) {
        console.log('FAILED', err.response.status, err.response.message);
    } else {


        var deployment = pieces.deployment;
        var application = pieces.application;
        var boilerplate = pieces.boilerplate;

        //console.log('Deployment', deployment);


        var domainName = chalk.green(`https://${application.domain}`); 
        var deploymentKey = chalk.green(deployment.distributionKey);
        var localDevURL = chalk.green(`http://localhost:8080/`);
        var publicKey = chalk.green(deployment.privateDetails.publicKey);
        var webhook = chalk.green(`${fluro.apiURL}/deployment/deploy/${deployment._id}?branch=master`);


        console.log('\n\n')
        console.log('/////////////////////////')
        console.log('\n')
        console.log(`- Application:     ${ domainName }`);
        console.log(`- Deployment:      ${ deploymentKey }`);
        console.log(`- App running at:  ${localDevURL}`);
        console.log('\n')

        console.log(`Public Access Key ${chalk.gray('(Add this to your Git repository)')}:\n${publicKey}`)
                // $scope.webhookURL = Fluro.apiURL + '/deployment/deploy/' + id + '?branch=master'
        console.log(`GIT Webhook URL ${chalk.gray('(Add this to your Git repository)')}:\n${webhook}`)
        console.log('\n\n')
        console.log('/////////////////////////')
        console.log('\n\n')


    }
}



// ///////////////////////////////////////////////////


// var created = 0;

// function formatAndSend(row, next) {

//     var createdDate = _.get(row, 'Note Date');
//     var output = {
//         _type: 'post',
//         created: new Date(createdDate),
//         data: {
//             imported: row,
//         },
//     }





//     async.parallel([
//         getParent,
//     ], function(err) {

//         if (err || !output.parent) {
//             console.log('ERROR -> COULD NOT FIND', row)
//             return next();
//         }



//         ///////////////

//         //Map the fields to the correct fluro field
//         mapValue(row, output, 'Notes', 'data.body');

//         //Find out if it's private
//         var isPrivate = _.get(row, 'Private') == 'Yes';

//         //////////////////////////////////////////////////

//         //Find out what category it is in
//         switch (_.get(row, 'Categories')) {
//             case 'Prayer Request':
//                 _.set(output, 'data.type', 'Prayer Request');
//                 output.definition = 'prayerPraiseReport';
//                 mapValue(row, output, 'Notes', 'data.details');
//                 break;
//             case 'Praise Report':
//                 _.set(output, 'data.type', 'Praise Report');
//                 output.definition = 'prayerPraiseReport';
//                 mapValue(row, output, 'Notes', 'data.details');
//                 break;
//                 // case 'Pastoral Care':
//                 // case 'Invitation to Connect':
//                 // case 'General':
//             default:
//                 output.definition = 'comment';
//                 break;
//         }

//         output.title = `${_.get(row, 'Created By')} - ${createdDate}`;

//         //////////////////////////////////////////////////

//         //If it's private then map to a private note
//         if (isPrivate) {
//             output.definition = 'note';
//             output.realms = ['5c747ff79914f817612057e4'];
//         } else {
//             //otherwise put it in the church life realm
//             output.realms = ['5b72415ca9f54b1854a18a16'];
//         }

//         //////////////////////////////////////////////////

//         //Create a Unique ID
//         var start = `elvanto-import-${output.parent}-${_.kebabCase(createdDate)}`;
//         var firstThreeCharacters = _.kebabCase((_.get(output, 'data.details') || _.get(output, 'data.body')).slice(0, 50));
//         var externalID = `${start}-${firstThreeCharacters}`;

//         output._external = externalID;

//         var matched = _.find(checks, function(row) {
//             return row._external == externalID;
//         })

//         if (!matched) {
//             console.log('>>>>>> NO MATCH', externalID);
//             return next();
//         } else {
//             // console.log(created++, 'already matched');
//             return next();
//         }
//         // console.log('EXTERNAL', externalID);
//         // return;
//         // console.log('OUTPUT', output);

//         ///////////////

//         // console.time(`${row.index} ${output.parent} -                      imported in`)
//         //Post the content!
//         fluro.api.post('/content/_import', output, {
//                 params: {
//                     noMerge: true,
//                     title: output.title,
//                 }
//             })
//             .then(function(response) {

//                 // console.log('__________________________');
//                 console.log('imported', created++, response.data._id);
//                 // console.timeEnd(`${row.index} ${output.parent} -                      imported in`)
//                 return next(null, output);
//             })
//             .catch(function(err) {
//                 console.log('error', err);
//                 return next(err);
//                 // console.timeEnd('imported in')
//             });



//         // return next(null, output);
//     })

//     ///////////////

//     //Find the parent in Fluro so we can connect the note
//     function getParent(parentMatched) {

//         //Find the parent by it's attached member ID
//         var externalParentID = _.get(row, 'Member ID')


//         //We already know the ID
//         if (cache[externalParentID]) {
//             // console.log('SKIPPED', externalParentID)
//             output.parent = cache[externalParentID]
//             return parentMatched();
//         }

//         // console.log('check external id', externalParentID);
//         // We need to talk to Fluro to find out the ID
//         fluro.api(`/check/external/${externalParentID}`)
//             .then(function(res) {

//                 // console.log('checked external id', res.data._id);
//                 cache[externalParentID] = res.data._id;
//                 output.parent = cache[externalParentID];
//                 // console.log('Matched', externalParentID, cache[externalParentID])
//                 return parentMatched();
//             }, function(err) {
//                 return next();
//             });


//         // //We need to talk to Fluro to find out the ID
//         // fluro.content.external(externalParentID, { select: 'title' })
//         // .then(function(res) {
//         //     cache[externalParentID] = res._id;
//         //     output.parent = cache[externalParentID];
//         //     // console.log('Matched', externalParentID, cache[externalParentID])
//         //     return next();
//         // },function(err) {
//         //     // console.log('ERROR LOADING EXTERNAL', err);
//         //     return next();
//         // });
//     }


// }

// ///////////////////////////////////////////////////
// ///////////////////////////////////////////////////

// function mapValue(input, output, from, to) {
//     var value = _.get(input, from);

//     if (!value) {
//         return;
//     }

//     _.set(output, to, value);
// }