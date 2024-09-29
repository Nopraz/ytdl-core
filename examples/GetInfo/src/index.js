const { YtdlCore } = require('@ybd-project/ytdl-core'),
    ytdl = new YtdlCore({
        hl: 'en',
        gl: 'US',
    });

// Video: Never Gonna give you up
const VIDEO_ID = 'dQw4w9WgXcQ';

/* Normal usage (Basic Info) */
ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
    .then((results) => {
        // ...
    })
    .catch((error) => {
        // ...
    });

/* Normal usage (Full Info) */
ytdl.getFullInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`);

/* Specify the client (player) to use */
ytdl.getFullInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    clients: ['web', 'mweb', 'webCreator', 'android', 'ios', 'tv', 'tvEmbedded'], // <- All available clients
});

/* Specify PoToken and VisitorData */
ytdl.getFullInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    poToken: 'PO_TOKEN',
    visitorData: 'VISITOR_DATA',
});

/* Specify OAuth2 Access Token */

//TIP: When using OAuth2, be sure to assign it to a variable before specifying it as an argument.
const OAUTH2 = new YtdlCore.OAuth2({
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    expiryDate: 'EXPIRY_DATE',
});

ytdl.getFullInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    oauth2: OAUTH2,
});

/* Specify OAuth2 Access Token with your own client */
const YOUR_OWN_OAUTH2 = new YtdlCore.OAuth2({
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    expiryDate: 'EXPIRY_DATE',
    clientData: {
        clientId: 'CLIENT_ID',
        clientSecret: 'CLIENT_SECRET',
    },
});

ytdl.getFullInfo(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    oauth2: YOUR_OWN_OAUTH2,
});
