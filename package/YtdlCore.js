"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.YtdlCore = void 0;
const undici_1 = require("undici");
const stream_1 = require("stream");
const miniget_1 = __importDefault(require("miniget"));
const m3u8stream_1 = __importStar(require("m3u8stream"));
const Info_1 = require("./core/Info");
const Html5Player_1 = __importDefault(require("./core/Info/parser/Html5Player"));
const Agent_1 = require("./core/Agent");
const OAuth2_1 = require("./core/OAuth2");
const PoToken_1 = __importDefault(require("./core/PoToken"));
const Cache_1 = require("./core/Cache");
const Utils_1 = __importDefault(require("./utils/Utils"));
const Url_1 = __importDefault(require("./utils/Url"));
const DownloadOptions_1 = __importDefault(require("./utils/DownloadOptions"));
const Format_1 = require("./utils/Format");
const constants_1 = require("./utils/constants");
const Log_1 = require("./utils/Log");
const IP_1 = __importDefault(require("./utils/IP"));
/* Private Constants */
const STREAM_EVENTS = ['abort', 'request', 'response', 'error', 'redirect', 'retry', 'reconnect'];
/* Private Functions */
function isNodeVersionOk(version) {
    return parseInt(version.replace('v', '').split('.')[0]) >= 16;
}
async function isDownloadUrlValid(format) {
    return new Promise((resolve) => {
        const successResponseHandler = (res) => {
            if (res.status === 200) {
                Log_1.Logger.debug(`[ ${format.sourceClientName} ]: <success>Video URL is normal.</success> The response was received with status code <success>"${res.status}"</success>.`);
                resolve({ valid: true });
            }
            else {
                errorResponseHandler(new Error(`Status code: ${res.status}`));
            }
        }, errorResponseHandler = (reason) => {
            Log_1.Logger.debug(`[ ${format.sourceClientName} ]: The URL for the video <error>did not return a successful response</error>. Got another format.\nReason: ${reason.message}`);
            resolve({ valid: false, reason: reason.message });
        };
        try {
            (0, undici_1.fetch)(format.url, {
                method: 'HEAD',
            }).then((res) => successResponseHandler(res), (reason) => errorResponseHandler(reason));
        }
        catch (err) {
            errorResponseHandler(err);
        }
    });
}
function getValidDownloadUrl(stream, formats, options) {
    return new Promise(async (resolve, reject) => {
        let excludingClients = ['web'], format, isOk = false;
        try {
            format = (0, Format_1.chooseFormat)(formats, options);
        }
        catch (e) {
            stream.emit('error', e);
            return reject(e);
        }
        if (!format) {
            return reject(new Error('Failed to retrieve format data.'));
        }
        while (isOk === false) {
            if (!format) {
                reject(new Error('Failed to retrieve format data.'));
                break;
            }
            const { valid, reason } = await isDownloadUrlValid(format);
            if (valid) {
                isOk = true;
            }
            else {
                if (format.sourceClientName !== 'unknown') {
                    excludingClients.push(format.sourceClientName);
                }
                try {
                    format = (0, Format_1.chooseFormat)(formats, {
                        excludingClients,
                        includingClients: reason?.includes('403') ? ['ios', 'android'] : 'all',
                        quality: options.quality,
                        filter: options.filter,
                    });
                }
                catch (e) {
                    stream.emit('error', e);
                    return reject(e);
                }
            }
        }
        resolve(format);
    });
}
function createStream(options = {}) {
    const STREAM = new stream_1.PassThrough({
        highWaterMark: (options && options.highWaterMark) || 1024 * 512,
    });
    STREAM._destroy = () => {
        STREAM.destroyed = true;
    };
    return STREAM;
}
function pipeAndSetEvents(req, stream, end) {
    // Forward events from the request to the stream.
    STREAM_EVENTS.forEach((event) => {
        req.prependListener(event, stream.emit.bind(stream, event));
    });
    req.pipe(stream, { end });
}
async function downloadFromInfoCallback(stream, info, options) {
    options = options || {};
    options.requestOptions = options.requestOptions || {};
    if (!info.formats.length) {
        stream.emit('error', Error('This video is unavailable'));
        return;
    }
    let format;
    try {
        format = await getValidDownloadUrl(stream, info.formats, options);
    }
    catch {
        return;
    }
    if (info._metadata.clients.every((client) => client === 'web')) {
        Log_1.Logger.warning('<warning>The web client format is deprecated for downloads as it often returns 403.</warning> Include non-WEB clients in the `clients` option. (Example: webCreator, ios, android)');
    }
    stream.emit('info', info, format);
    if (stream.destroyed) {
        return;
    }
    let contentLength, downloaded = 0;
    const onData = (chunk) => {
        downloaded += chunk.length;
        stream.emit('progress', chunk.length, downloaded, contentLength);
    };
    DownloadOptions_1.default.applyDefaultHeaders(options);
    if (options.IPv6Block) {
        options.requestOptions = Object.assign({}, options.requestOptions, {
            localAddress: IP_1.default.getRandomIPv6(options.IPv6Block),
        });
    }
    if (options.agent) {
        if (options.agent.jar) {
            Utils_1.default.setPropInsensitive(options.requestOptions.headers, 'cookie', options.agent.jar.getCookieStringSync('https://www.youtube.com'));
        }
        if (options.agent.localAddress) {
            options.requestOptions.localAddress = options.agent.localAddress;
        }
    }
    // Download the file in chunks, in this case the default is 10MB,
    // anything over this will cause youtube to throttle the download
    const DL_CHUNK_SIZE = typeof options.dlChunkSize === 'number' ? options.dlChunkSize : 1024 * 1024 * 10;
    let req;
    let shouldEnd = true;
    /* Request Setup */
    if (options.rewriteRequest) {
        const { url, options: reqOptions } = options.rewriteRequest(format.url, options.requestOptions, {
            isDownloadUrl: true,
        });
        format.url = url;
        options.requestOptions = reqOptions;
    }
    if (options.originalProxyUrl) {
        const PARSED = new URL(options.originalProxyUrl);
        if (!format.url.includes(PARSED.host)) {
            format.url = `${PARSED.protocol}//${PARSED.host}/download/?url=${encodeURIComponent(format.url)}`;
        }
    }
    if (format.isHLS || format.isDashMPD) {
        req = (0, m3u8stream_1.default)(format.url, {
            chunkReadahead: info.live_chunk_readahead ? +info.live_chunk_readahead : undefined,
            begin: options.begin || (format.isLive ? Date.now() : undefined),
            liveBuffer: options.liveBuffer,
            requestOptions: options.requestOptions,
            parser: format.isDashMPD ? 'dash-mpd' : 'm3u8',
            id: format.itag.toString(),
        });
        req.on('progress', (segment, totalSegments) => {
            stream.emit('progress', segment.size, segment.num, totalSegments);
        });
        pipeAndSetEvents(req, stream, shouldEnd);
    }
    else {
        const requestOptions = Object.assign({}, options.requestOptions, {
            maxReconnects: 6,
            maxRetries: 3,
            backoff: { inc: 500, max: 10000 },
        });
        let shouldBeChunked = DL_CHUNK_SIZE !== 0 && (!format.hasAudio || !format.hasVideo);
        if (shouldBeChunked) {
            let start = (options.range && options.range.start) || 0;
            let end = start + DL_CHUNK_SIZE;
            const rangeEnd = options.range && options.range.end;
            contentLength = options.range ? (rangeEnd ? rangeEnd + 1 : parseInt(format.contentLength)) - start : parseInt(format.contentLength);
            const getNextChunk = () => {
                if (stream.destroyed)
                    return;
                if (!rangeEnd && end >= contentLength)
                    end = 0;
                if (rangeEnd && end > rangeEnd)
                    end = rangeEnd;
                shouldEnd = !end || end === rangeEnd;
                requestOptions.headers = Object.assign({}, requestOptions.headers, {
                    Range: `bytes=${start}-${end || ''}`,
                });
                req = (0, miniget_1.default)(format.url, requestOptions);
                req.on('data', onData);
                req.on('end', () => {
                    if (stream.destroyed)
                        return;
                    if (end && end !== rangeEnd) {
                        start = end + 1;
                        end += DL_CHUNK_SIZE;
                        getNextChunk();
                    }
                });
                pipeAndSetEvents(req, stream, shouldEnd);
            };
            getNextChunk();
        }
        else {
            // Audio only and video only formats don't support begin
            if (options.begin) {
                format.url += `&begin=${(0, m3u8stream_1.parseTimestamp)(options.begin)}`;
            }
            if (options.range && (options.range.start || options.range.end)) {
                requestOptions.headers = Object.assign({}, requestOptions.headers, {
                    Range: `bytes=${options.range.start || '0'}-${options.range.end || ''}`,
                });
            }
            req = (0, miniget_1.default)(format.url, requestOptions);
            req.on('response', (res) => {
                if (stream.destroyed)
                    return;
                contentLength = contentLength || parseInt(res.headers['content-length']);
            });
            req.on('data', onData);
            pipeAndSetEvents(req, stream, shouldEnd);
        }
    }
    stream._destroy = () => {
        stream.destroyed = true;
        if (req) {
            req.destroy();
            req.end();
        }
    };
}
function downloadFromInfo(info, options = {}) {
    const STREAM = createStream(options);
    if (!info.full) {
        throw new Error('Cannot use `ytdl.downloadFromInfo()` when called with info from `ytdl.getBasicInfo()`');
    }
    setImmediate(() => {
        downloadFromInfoCallback(STREAM, info, options);
    });
    return STREAM;
}
function download(link, options = {}) {
    const STREAM = createStream(options);
    (0, Info_1.getFullInfo)(link, options).then((info) => {
        downloadFromInfoCallback(STREAM, info, options);
    }, STREAM.emit.bind(STREAM, 'error'));
    return STREAM;
}
/* Public CLass */
class YtdlCore {
    /* Setup */
    setPoToken(poToken) {
        const PO_TOKEN_CACHE = Cache_1.FileCache.get('poToken');
        if (poToken) {
            this.poToken = poToken;
        }
        else if (PO_TOKEN_CACHE) {
            Log_1.Logger.debug('PoToken loaded from cache.');
            this.poToken = PO_TOKEN_CACHE || undefined;
        }
        Cache_1.FileCache.set('poToken', this.poToken || '', { ttl: 60 * 60 * 24 * 365 });
    }
    setVisitorData(visitorData) {
        const VISITOR_DATA_CACHE = Cache_1.FileCache.get('visitorData');
        if (visitorData) {
            this.visitorData = visitorData;
        }
        else if (VISITOR_DATA_CACHE) {
            Log_1.Logger.debug('VisitorData loaded from cache.');
            this.visitorData = VISITOR_DATA_CACHE || undefined;
        }
        Cache_1.FileCache.set('visitorData', this.visitorData || '', { ttl: 60 * 60 * 24 * 365 });
    }
    setOAuth2(oauth2) {
        const OAUTH2_CACHE = Cache_1.FileCache.get('oauth2') || undefined;
        try {
            this.oauth2 = oauth2 || new OAuth2_1.OAuth2(OAUTH2_CACHE) || undefined;
        }
        catch {
            this.oauth2 = undefined;
        }
    }
    automaticallyGeneratePoToken() {
        if (!this.poToken && !this.visitorData) {
            Log_1.Logger.info('Since PoToken and VisitorData are not specified, they are generated automatically.');
            PoToken_1.default.generatePoToken()
                .then(({ poToken, visitorData }) => {
                this.poToken = poToken;
                this.visitorData = visitorData;
                Cache_1.FileCache.set('poToken', this.poToken || '', { ttl: 60 * 60 * 24 * 365 });
                Cache_1.FileCache.set('visitorData', this.visitorData || '', { ttl: 60 * 60 * 24 * 365 });
            })
                .catch(() => { });
        }
    }
    initializeHtml5PlayerCache() {
        const HTML5_PLAYER = Cache_1.FileCache.get('html5Player');
        if (!HTML5_PLAYER && !process.env._YTDL_DISABLE_HTML5_PLAYER_CACHE) {
            Log_1.Logger.debug('To speed up processing, html5Player and signatureTimestamp are pre-fetched and cached.');
            (0, Html5Player_1.default)('dQw4w9WgXcQ', {});
        }
    }
    constructor({ lang, requestOptions, rewriteRequest, agent, poToken, disablePoTokenAutoGeneration, visitorData, includesPlayerAPIResponse, includesNextAPIResponse, includesOriginalFormatData, includesRelatedVideo, clients, disableDefaultClients, oauth2, parsesHLSFormat, originalProxyUrl, originalProxy, quality, filter, excludingClients, includingClients, range, begin, liveBuffer, highWaterMark, IPv6Block, dlChunkSize, debug, disableFileCache } = {}) {
        /* Get Info Options */
        this.lang = 'en';
        this.requestOptions = {};
        this.disablePoTokenAutoGeneration = false;
        this.includesPlayerAPIResponse = false;
        this.includesNextAPIResponse = false;
        this.includesOriginalFormatData = false;
        this.includesRelatedVideo = true;
        this.disableDefaultClients = false;
        this.parsesHLSFormat = false;
        this.excludingClients = [];
        this.includingClients = 'all';
        /* Metadata */
        this.version = constants_1.VERSION;
        /* Other Options */
        process.env.YTDL_DEBUG = (debug ?? false).toString();
        process.env._YTDL_DISABLE_FILE_CACHE = (disableFileCache ?? false).toString();
        /* Get Info Options */
        this.lang = lang || 'en';
        this.requestOptions = requestOptions || {};
        this.rewriteRequest = rewriteRequest || undefined;
        this.agent = agent || undefined;
        this.disablePoTokenAutoGeneration = disablePoTokenAutoGeneration ?? false;
        this.includesPlayerAPIResponse = includesPlayerAPIResponse ?? false;
        this.includesNextAPIResponse = includesNextAPIResponse ?? false;
        this.includesOriginalFormatData = includesOriginalFormatData ?? false;
        this.includesRelatedVideo = includesRelatedVideo ?? true;
        this.clients = clients || undefined;
        this.disableDefaultClients = disableDefaultClients ?? false;
        this.parsesHLSFormat = parsesHLSFormat ?? false;
        this.originalProxy = originalProxy || undefined;
        if (originalProxyUrl && !originalProxy) {
            Log_1.Logger.info('<warning>`originalProxyUrl` is deprecated.</warning> Use `originalProxy` instead.');
            if (!this.originalProxy) {
                try {
                    this.originalProxy = {
                        base: originalProxyUrl,
                        download: new URL(originalProxyUrl).origin + '/download',
                        urlQueryName: 'url',
                    };
                }
                catch { }
            }
        }
        if (this.originalProxy) {
            Log_1.Logger.debug(`<debug>"${this.originalProxy.base}"</debug> is used for <blue>API requests</blue>.`);
            Log_1.Logger.debug(`<debug>"${this.originalProxy.download}"</debug> is used for <blue>video downloads</blue>.`);
            Log_1.Logger.debug(`The query name <debug>"${this.originalProxy.urlQueryName || 'url'}"</debug> is used to specify the URL in the request. <blue>(?url=...)</blue>`);
        }
        this.setPoToken(poToken);
        this.setVisitorData(visitorData);
        this.setOAuth2(oauth2);
        /* Format Selection Options */
        this.quality = quality || undefined;
        this.filter = filter || undefined;
        this.excludingClients = excludingClients || [];
        this.includingClients = includingClients || 'all';
        /* Download Options */
        this.range = range || undefined;
        this.begin = begin || undefined;
        this.liveBuffer = liveBuffer || undefined;
        this.highWaterMark = highWaterMark || undefined;
        this.IPv6Block = IPv6Block || undefined;
        this.dlChunkSize = dlChunkSize || undefined;
        if (!this.disablePoTokenAutoGeneration) {
            this.automaticallyGeneratePoToken();
        }
        this.initializeHtml5PlayerCache();
        /* Version Check */
        if (!isNodeVersionOk(process.version)) {
            throw new Error(`You are using Node.js ${process.version} which is not supported. Minimum version required is v16.`);
        }
    }
    setupOptions(options) {
        options.lang = options.lang || this.lang;
        options.requestOptions = options.requestOptions || this.requestOptions;
        options.rewriteRequest = options.rewriteRequest || this.rewriteRequest;
        options.agent = options.agent || this.agent;
        options.poToken = options.poToken || this.poToken;
        options.disablePoTokenAutoGeneration = options.disablePoTokenAutoGeneration || this.disablePoTokenAutoGeneration;
        options.visitorData = options.visitorData || this.visitorData;
        options.includesPlayerAPIResponse = options.includesPlayerAPIResponse || this.includesPlayerAPIResponse;
        options.includesNextAPIResponse = options.includesNextAPIResponse || this.includesNextAPIResponse;
        options.includesOriginalFormatData = options.includesOriginalFormatData || this.includesOriginalFormatData;
        options.includesRelatedVideo = options.includesRelatedVideo || this.includesRelatedVideo;
        options.clients = options.clients || this.clients;
        options.disableDefaultClients = options.disableDefaultClients || this.disableDefaultClients;
        options.oauth2 = options.oauth2 || this.oauth2;
        options.parsesHLSFormat = options.parsesHLSFormat || this.parsesHLSFormat;
        options.originalProxy = options.originalProxy || this.originalProxy || undefined;
        if (options.originalProxyUrl && !options.originalProxy) {
            Log_1.Logger.info('<warning>originalProxyUrl is deprecated.</warning> Use `originalProxy` instead.');
            try {
                options.originalProxy = {
                    base: options.originalProxyUrl,
                    download: new URL(options.originalProxyUrl).origin + '/download',
                    urlQueryName: 'url',
                };
            }
            catch { }
        }
        /* Format Selection Options */
        options.quality = options.quality || this.quality || undefined;
        options.filter = options.filter || this.filter || undefined;
        options.excludingClients = options.excludingClients || this.excludingClients || [];
        options.includingClients = options.includingClients || this.includingClients || 'all';
        /* Download Options */
        options.range = options.range || this.range || undefined;
        options.begin = options.begin || this.begin || undefined;
        options.liveBuffer = options.liveBuffer || this.liveBuffer || undefined;
        options.highWaterMark = options.highWaterMark || this.highWaterMark || undefined;
        options.IPv6Block = options.IPv6Block || this.IPv6Block || undefined;
        options.dlChunkSize = options.dlChunkSize || this.dlChunkSize || undefined;
        if (!this.oauth2 && options.oauth2) {
            Log_1.Logger.warning('The OAuth2 token should be specified when instantiating the YtdlCore class, not as a function argument.');
        }
        return options;
    }
    download(link, options = {}) {
        return download(link, this.setupOptions(options));
    }
    downloadFromInfo(info, options = {}) {
        return downloadFromInfo(info, this.setupOptions(options));
    }
    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    getBasicInfo(link, options = {}) {
        return (0, Info_1.getBasicInfo)(link, this.setupOptions(options));
    }
    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.)
     * @deprecated
     */
    getInfo(link, options = {}) {
        return (0, Info_1.getInfo)(link, this.setupOptions(options));
    }
    /** TIP: The options specified in new YtdlCore() are applied by default. (The function arguments specified will take precedence.) */
    getFullInfo(link, options = {}) {
        return (0, Info_1.getFullInfo)(link, this.setupOptions(options));
    }
}
exports.YtdlCore = YtdlCore;
YtdlCore.download = download;
YtdlCore.downloadFromInfo = downloadFromInfo;
YtdlCore.getBasicInfo = Info_1.getBasicInfo;
/** @deprecated */
YtdlCore.getInfo = Info_1.getInfo;
YtdlCore.getFullInfo = Info_1.getFullInfo;
YtdlCore.chooseFormat = Format_1.chooseFormat;
YtdlCore.filterFormats = Format_1.filterFormats;
YtdlCore.validateID = Url_1.default.validateID;
YtdlCore.validateURL = Url_1.default.validateURL;
YtdlCore.getURLVideoID = Url_1.default.getURLVideoID;
YtdlCore.getVideoID = Url_1.default.getVideoID;
YtdlCore.createAgent = Agent_1.createAgent;
YtdlCore.createProxyAgent = Agent_1.createProxyAgent;
YtdlCore.OAuth2 = OAuth2_1.OAuth2;
module.exports.YtdlCore = YtdlCore;
//# sourceMappingURL=YtdlCore.js.map